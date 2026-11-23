import { execFile } from 'node:child_process';
import { readFile as readFileFromDisk, writeFile as writeFileToDisk } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createAmoClient } from './amo-client.mjs';
import { createGitHubReleaseClient } from './github-client.mjs';
import {
  validateAmoLicense,
  validateManifest,
  versionFromTag,
} from './release-contract.mjs';

const STATE_ASSET_NAME = 'amo-upload-state.json';
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const WEB_EXT_CLI = resolve(SCRIPT_DIRECTORY, '../node_modules/web-ext/bin/web-ext.js');

export async function prepareRelease({
  env = process.env,
  execFile,
  readFile,
  writeFile,
  githubApi,
  amoClient,
  now = new Date(),
  cwd = process.cwd(),
}) {
  requireFunction(execFile, 'execFile');
  requireFunction(readFile, 'readFile');
  requireFunction(writeFile, 'writeFile');
  requireFunction(githubApi?.getReleaseByTag, 'githubApi.getReleaseByTag');
  requireFunction(githubApi?.createDraftRelease, 'githubApi.createDraftRelease');
  requireFunction(githubApi?.listAssets, 'githubApi.listAssets');
  requireFunction(githubApi?.uploadAsset, 'githubApi.uploadAsset');
  requireFunction(githubApi?.downloadAsset, 'githubApi.downloadAsset');
  requireFunction(githubApi?.deleteAsset, 'githubApi.deleteAsset');
  requireFunction(amoClient?.getAddon, 'amoClient.getAddon');

  const tag = requiredString(env.GITHUB_REF_NAME, 'GITHUB_REF_NAME');
  const apiKey = requiredString(env.AMO_API_KEY, 'AMO_API_KEY');
  const apiSecret = requiredString(env.AMO_API_SECRET, 'AMO_API_SECRET');
  requiredString(env.GITHUB_TOKEN, 'GITHUB_TOKEN');
  requiredString(env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY');
  const manifest = JSON.parse((await readFile('manifest.json')).toString('utf8'));
  validateManifest(manifest);
  const version = versionFromTag(tag, manifest.version);
  const sourceZipName = `epic-fab-redeemer-v${version}.zip`;
  const sourceZip = await readFile(`dist/${sourceZipName}`);
  let release = await githubApi.getReleaseByTag(tag);
  let stateAsset;
  let state;

  if (release) {
    if (release.tag_name !== tag) {
      throw new Error(`GitHub release for ${tag} has an unrelated tag.`);
    }
    if (!release.draft) {
      throw new Error(`GitHub release ${tag} must remain a draft before AMO approval.`);
    }

    const assets = await githubApi.listAssets(release.id);
    stateAsset = assets.find((asset) => asset.name === STATE_ASSET_NAME);
    if (!stateAsset) {
      throw new Error(`Draft ${tag} has no AMO state asset; refusing to submit again.`);
    }
    state = parseState(await githubApi.downloadAsset(stateAsset));
    validateState(state, tag, manifest.browser_specific_settings.gecko.id);
    if (state.status === 'submitting') {
      throw new Error(`Draft ${tag} has an interrupted submission; manual AMO reconciliation is required.`);
    }

    if (!assets.some((asset) => asset.name === sourceZipName)) {
      await githubApi.uploadAsset(release, sourceZipName, sourceZip, 'application/zip');
    }
    return { releaseId: release.id, tag, uploadUuid: state.uploadUuid, resumed: true };
  }

  const listing = await amoClient.getAddon(manifest.browser_specific_settings.gecko.id);
  let metadataPath;
  if (!listing) {
    const license = validateAmoLicense(env.AMO_LICENSE);
    const metadata = JSON.parse((await readFile('.amo-metadata.json')).toString('utf8'));
    validateAmoMetadata(metadata);
    metadata.version = { ...metadata.version, license };
    metadataPath = 'dist/amo-metadata.json';
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  release = await githubApi.createDraftRelease({
    tag,
    name: `${manifest.name} ${version}`,
    body: `AMO submission started ${now.toISOString()}. This release remains a draft until Mozilla approves and signs the matching version.`,
  });

  try {
    await githubApi.uploadAsset(release, sourceZipName, sourceZip, 'application/zip');
    state = {
      schemaVersion: 1,
      tag,
      status: 'submitting',
      uploadUuid: null,
      addonId: manifest.browser_specific_settings.gecko.id,
    };
    stateAsset = await githubApi.uploadAsset(
      release,
      STATE_ASSET_NAME,
      Buffer.from(JSON.stringify(state)),
      'application/json',
    );

    const execEnvironment = { ...process.env, ...env };
    delete execEnvironment.AMO_API_KEY;
    delete execEnvironment.AMO_API_SECRET;
    delete execEnvironment.GITHUB_TOKEN;
    execEnvironment.WEB_EXT_API_KEY = apiKey;
    execEnvironment.WEB_EXT_API_SECRET = apiSecret;
    const signArgs = [
      WEB_EXT_CLI,
      'sign',
      '--channel=listed',
      '--approval-timeout=0',
      '--source-dir=.',
      '--artifacts-dir=dist',
      ...(metadataPath ? [`--amo-metadata=${metadataPath}`] : []),
      '--no-input',
    ];
    await execFile(process.execPath, signArgs, {
      cwd,
      env: execEnvironment,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 1_048_576,
    });

    let uploadRecord;
    try {
      uploadRecord = JSON.parse((await readFile('.amo-upload-uuid')).toString('utf8'));
    } catch {
      throw new Error('web-ext did not produce a valid AMO upload state file.');
    }
    const uploadUuid = uploadRecord?.uploadUuid;
    if (uploadRecord?.channel !== 'listed' || !isUuid(uploadUuid)) {
      throw new Error('web-ext did not produce a valid AMO upload UUID.');
    }

    const submittedState = { ...state, status: 'submitted', uploadUuid };
    if (stateAsset?.id) await githubApi.deleteAsset(stateAsset.id);
    await githubApi.uploadAsset(
      release,
      STATE_ASSET_NAME,
      Buffer.from(JSON.stringify(submittedState)),
      'application/json',
    );
    return { releaseId: release.id, tag, uploadUuid, resumed: false };
  } catch {
    throw new Error(`AMO release submission did not complete. Draft ${tag} was preserved; inspect it and reconcile with AMO before retrying.`);
  }
}

function validateAmoMetadata(metadata) {
  if (typeof metadata !== 'object' || metadata === null
    || typeof metadata.summary !== 'object' || metadata.summary === null
    || !Object.values(metadata.summary).some((summary) => typeof summary === 'string' && summary.trim() !== '')
    || !Array.isArray(metadata.categories) || metadata.categories.length === 0) {
    throw new Error('Checked-in AMO metadata must contain a localized summary and at least one category.');
  }
}

function parseState(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error('Draft AMO state asset is not valid JSON.');
  }
}

function validateState(state, tag, addonId) {
  if (state?.schemaVersion !== 1 || state.tag !== tag || state.addonId !== addonId) {
    throw new Error(`Draft ${tag} has incompatible AMO state; refusing to resubmit.`);
  }
  if (state.status === 'submitting' && state.uploadUuid === null) return;
  if (state.status !== 'submitted' || !isUuid(state.uploadUuid)) {
    throw new Error(`Draft ${tag} has invalid AMO state; refusing to resubmit.`);
  }
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function.`);
}

async function runRelease(env = process.env) {
  const githubApi = createGitHubReleaseClient({
    token: requiredString(env.GITHUB_TOKEN, 'GITHUB_TOKEN'),
    repository: requiredString(env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY'),
  });
  const amoClient = createAmoClient({
    apiKey: requiredString(env.AMO_API_KEY, 'AMO_API_KEY'),
    apiSecret: requiredString(env.AMO_API_SECRET, 'AMO_API_SECRET'),
  });
  const result = await prepareRelease({
    env,
    githubApi,
    amoClient,
    execFile: promisify(execFile),
    readFile: readFileFromDisk,
    writeFile: writeFileToDisk,
  });
  console.log(`Draft ${result.tag} is ready for AMO review (${result.resumed ? 'resumed' : 'submitted'}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runRelease().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
