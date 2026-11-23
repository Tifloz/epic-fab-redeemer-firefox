import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAmoClient } from './amo-client.mjs';
import { assertPublishableAmoVersion, validateManifest, verifySha256, versionFromTag } from './release-contract.mjs';
import { createGitHubReleaseClient } from './github-client.mjs';

const STATE_ASSET_NAME = 'amo-upload-state.json';

export async function pollDraftRelease({
  release,
  manifest,
  amoClient,
  fetchImpl = fetch,
  githubApi,
  verifyDigest = verifySha256,
}) {
  if (!release?.draft) return { status: 'published', tag: release?.tag_name };
  if (typeof release.tag_name !== 'string') throw new Error('GitHub draft has no version tag.');

  const assets = await githubApi.listAssets(release.id);
  const stateAsset = assets.find((asset) => asset.name === STATE_ASSET_NAME);
  if (!stateAsset) return { status: 'skipped', tag: release.tag_name };

  const state = parseState(await githubApi.downloadAsset(stateAsset));
  if (state?.schemaVersion !== 1 || state.tag !== release.tag_name) {
    throw new Error(`Draft ${release.tag_name} has incompatible AMO state.`);
  }
  const recoveringSubmission = state.status === 'submitting' && state.uploadUuid === null;
  if (!recoveringSubmission && (state.status !== 'submitted' || !isUuid(state.uploadUuid))) {
    throw new Error(`Draft ${release.tag_name} has invalid AMO state.`);
  }

  validateManifest(manifest);
  const addonId = manifest.browser_specific_settings.gecko.id;
  if (state.addonId !== addonId) throw new Error(`Draft ${release.tag_name} has a different Firefox add-on ID.`);
  const version = versionFromTag(release.tag_name, release.tag_name.slice(1));
  if (!recoveringSubmission) {
    const upload = await amoClient.getUpload(state.uploadUuid);
    if (upload?.processed === false) return { status: 'pending', tag: release.tag_name };
    if (upload?.valid === false) throw new Error(`AMO rejected the uploaded version for ${release.tag_name}.`);
    if (upload?.submitted === false) return { status: 'pending', tag: release.tag_name };
    if (upload?.processed !== true || upload?.valid !== true) {
      throw new Error(`AMO upload status is incomplete for ${release.tag_name}.`);
    }
    if (upload.channel !== 'listed') throw new Error(`AMO upload is not a listed AMO upload for ${release.tag_name}.`);
    if (upload.version !== version) throw new Error(`AMO upload version does not match tag ${release.tag_name}.`);
  }

  const amoVersion = await amoClient.getVersion(addonId, version);
  if (!amoVersion) return { status: 'pending', tag: release.tag_name };
  const file = amoVersion?.file;
  if (amoVersion?.version !== version) throw new Error(`AMO version does not match tag ${release.tag_name}.`);
  if (recoveringSubmission && amoVersion.channel !== 'listed') {
    throw new Error(`AMO version is not a listed submission for ${release.tag_name}.`);
  }
  if (file?.status === 'unreviewed') return { status: 'pending', tag: release.tag_name };

  const sha256 = normalizeSha256(file?.hash);
  assertPublishableAmoVersion({
    tag: release.tag_name,
    manifestVersion: version,
    version: amoVersion.version,
    fileStatus: file?.status,
    fileUrl: file?.url,
    sha256,
  });

  const xpiName = `epic-fab-redeemer-v${version}.xpi`;
  const existingXpi = assets.find((asset) => asset.name === xpiName);
  if (existingXpi) {
    const existingBytes = await githubApi.downloadAsset(existingXpi);
    verifyDigest(existingBytes, sha256);
  } else {
    const signedBytes = await downloadSignedFile(file.url, fetchImpl);
    verifyDigest(signedBytes, sha256);
    await githubApi.uploadAsset(release, xpiName, signedBytes, 'application/x-xpinstall');
  }

  await githubApi.deleteAsset(stateAsset.id);
  await githubApi.updateRelease(release.id, { draft: false });
  return { status: 'published', tag: release.tag_name };
}

async function downloadSignedFile(fileUrl, fetchImpl) {
  let url;
  try {
    url = new URL(fileUrl);
  } catch {
    throw new Error('AMO signed XPI URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'addons.mozilla.org' || url.port !== '') {
    throw new Error('AMO signed XPI download must use the Mozilla Add-ons HTTPS host.');
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/x-xpinstall' },
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error('AMO signed XPI download failed.');
  }
  if (!response.ok) throw new Error(`AMO signed XPI download returned HTTP ${response.status}.`);
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error('AMO signed XPI download did not return bytes.');
  }
}

function normalizeSha256(value) {
  const hash = typeof value === 'string' && value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
  if (typeof hash !== 'string' || !/^[a-f\d]{64}$/i.test(hash)) {
    throw new Error('AMO version has no valid SHA-256 file hash.');
  }
  return hash;
}

function parseState(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('Draft AMO state asset is not valid JSON.');
  }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function runPoller(env = process.env) {
  const githubApi = createGitHubReleaseClient({
    token: requiredString(env.GITHUB_TOKEN, 'GITHUB_TOKEN'),
    repository: requiredString(env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY'),
  });
  const releases = await githubApi.listDraftReleases();
  if (releases.length === 0) {
    console.log('No AMO draft releases to poll.');
    return;
  }
  const amoClient = createAmoClient({
    apiKey: requiredString(env.AMO_API_KEY, 'AMO_API_KEY'),
    apiSecret: requiredString(env.AMO_API_SECRET, 'AMO_API_SECRET'),
  });
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  let failed = false;

  for (const release of releases) {
    try {
      const result = await pollDraftRelease({ release, manifest, amoClient, githubApi });
      console.log(`${result.tag}: ${result.status}`);
    } catch (error) {
      failed = true;
      console.error(`${release.tag_name}: ${error.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required.`);
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runPoller().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
