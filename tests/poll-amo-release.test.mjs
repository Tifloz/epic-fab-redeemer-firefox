import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { pollDraftRelease } from '../scripts/poll-amo-release.mjs';

const uploadUuid = 'f7de8de4-9c4b-4f1e-9f7e-8e1342c32111';
const addonId = '{41f50f5e-77ac-47ec-8c28-3d16a00fa80e}';
const signedBytes = Buffer.from('Mozilla signed extension bytes');
const hash = createHash('sha256').update(signedBytes).digest('hex');
const release = { id: 12, tag_name: 'v0.1.0', draft: true };
const manifest = {
  manifest_version: 3,
  version: '0.1.0',
  browser_specific_settings: {
    gecko: { id: addonId, data_collection_permissions: { required: ['none'] } },
  },
  permissions: ['storage'],
  host_permissions: ['https://store.epicgames.com/*', 'https://www.fab.com/*'],
};
const state = {
  schemaVersion: 1,
  tag: 'v0.1.0',
  status: 'submitted',
  uploadUuid,
  addonId,
};

function createHarness({ fileStatus = 'public', uploadValid = true, uploadSubmitted = true, uploadVersion = '0.1.0', version = '0.1.0', fileHash = hash, existingXpi = false, releaseDraft = true } = {}) {
  const events = [];
  const stateAsset = { id: 55, name: 'amo-upload-state.json' };
  const assets = [stateAsset];
  if (existingXpi) assets.push({ id: 77, name: 'epic-fab-redeemer-v0.1.0.xpi' });
  const githubApi = {
    async listAssets() { return assets; },
    async downloadAsset(asset) {
      events.push(['download-asset', asset.name]);
      return asset.id === 55 ? Buffer.from(JSON.stringify(state)) : signedBytes;
    },
    async uploadAsset(target, name) { events.push(['upload-asset', name]); assets.push({ id: 88, name }); },
    async deleteAsset(id) { events.push(['delete-asset', id]); },
    async updateRelease(id, changes) { events.push(['update-release', id, changes]); },
  };
  const amoClient = {
    async getUpload(uuid) {
      events.push(['amo-upload', uuid]);
      return { processed: true, submitted: uploadSubmitted, valid: uploadValid, channel: 'listed', version: uploadVersion };
    },
    async getVersion(requestedAddonId, requestedVersion) {
      events.push(['amo-version', requestedAddonId, requestedVersion]);
      return {
        version,
        file: {
          status: fileStatus,
          url: 'https://addons.mozilla.org/firefox/downloads/file/123/addon.xpi',
          hash: fileHash,
        },
      };
    },
  };
  const fetchImpl = async (url) => {
    events.push(['download-xpi', url.href]);
    return { ok: true, status: 200, arrayBuffer: async () => signedBytes.buffer.slice(signedBytes.byteOffset, signedBytes.byteOffset + signedBytes.byteLength) };
  };

  return {
    assets,
    events,
    githubApi,
    amoClient,
    fetchImpl,
    async run() {
      return pollDraftRelease({ release: { ...release, draft: releaseDraft }, manifest, env: {}, githubApi, amoClient, fetchImpl });
    },
  };
}

test('leaves unreviewed versions as drafts without GitHub mutations', async () => {
  const harness = createHarness({ fileStatus: 'unreviewed' });

  assert.deepEqual(await harness.run(), { status: 'pending', tag: 'v0.1.0' });
  assert.equal(harness.events.some((event) => ['upload-asset', 'delete-asset', 'update-release'].includes(event[0])), false);
});

test('fails without publication when AMO marks an upload invalid or disabled', async () => {
  for (const options of [{ uploadValid: false }, { uploadValid: false, uploadSubmitted: false }, { fileStatus: 'disabled' }]) {
    const harness = createHarness(options);
    await assert.rejects(harness.run());
    assert.equal(harness.events.some((event) => event[0] === 'update-release'), false);
  }
});

test('rejects tag and AMO version mismatches before publishing', async () => {
  const harness = createHarness({ version: '0.1.1' });

  await assert.rejects(harness.run(), /version does not match/);
  assert.equal(harness.events.some((event) => event[0] === 'update-release'), false);
});

test('does not publish an upload from a non-listed AMO channel', async () => {
  const harness = createHarness();
  harness.amoClient.getUpload = async () => ({ processed: true, submitted: true, valid: true, channel: 'unlisted', version: '0.1.0' });

  await assert.rejects(harness.run(), /not a listed AMO upload/);
  assert.equal(harness.events.some((event) => event[0] === 'update-release'), false);
});

test('does not upload or publish an XPI when downloaded bytes fail the AMO digest', async () => {
  const harness = createHarness({ fileHash: '0'.repeat(64) });

  await assert.rejects(harness.run(), /digest mismatch/);
  assert.equal(harness.events.some((event) => event[0] === 'upload-asset'), false);
  assert.equal(harness.events.some((event) => event[0] === 'update-release'), false);
});

test('attaches the verified XPI, removes internal state, then publishes the release', async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.run(), { status: 'published', tag: 'v0.1.0' });
  const upload = harness.events.findIndex((event) => event[0] === 'upload-asset');
  const removeState = harness.events.findIndex((event) => event[0] === 'delete-asset');
  const publish = harness.events.findIndex((event) => event[0] === 'update-release');
  assert.ok(upload >= 0 && upload < removeState && removeState < publish);
  assert.equal(harness.events[upload][1], 'epic-fab-redeemer-v0.1.0.xpi');
  assert.deepEqual(harness.events[publish][2], { draft: false });
});

test('does not duplicate a previously attached verified XPI on retry', async () => {
  const harness = createHarness({ existingXpi: true });

  await harness.run();

  assert.equal(harness.events.some((event) => event[0] === 'upload-asset'), false);
  assert.equal(harness.events.some((event) => event[0] === 'update-release'), true);
});

test('accepts the SHA-256 prefix returned by AMO file metadata', async () => {
  const harness = createHarness({ fileHash: `sha256:${hash}` });

  assert.deepEqual(await harness.run(), { status: 'published', tag: 'v0.1.0' });
});

test('ignores already published releases and pending submission markers', async () => {
  const published = createHarness({ releaseDraft: false });
  assert.deepEqual(await published.run(), { status: 'published', tag: 'v0.1.0' });
  assert.equal(published.events.length, 0);

  const pending = createHarness();
  pending.githubApi.downloadAsset = async () => Buffer.from(JSON.stringify({ ...state, status: 'submitting', uploadUuid: null }));
  assert.deepEqual(await pending.run(), { status: 'pending', tag: 'v0.1.0' });
  assert.equal(pending.events.some((event) => event[0] === 'amo-upload'), false);
});
