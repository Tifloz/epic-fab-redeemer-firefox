import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareRelease } from '../scripts/prepare-release.mjs';

const uploadUuid = 'f7de8de4-9c4b-4f1e-9f7e-8e1342c32111';
const manifest = {
  manifest_version: 3,
  name: 'Epic Fab Redeemer',
  version: '0.1.0',
  description: 'Claim free PC game offers and free assets.',
  browser_specific_settings: {
    gecko: {
      id: '{41f50f5e-77ac-47ec-8c28-3d16a00fa80e}',
      data_collection_permissions: { required: ['none'] },
    },
  },
  permissions: ['storage'],
  host_permissions: ['https://store.epicgames.com/*', 'https://www.fab.com/*'],
};

function createHarness({ state = null, releaseExists = false, releaseDraft = true, existingAddon = false, execFailure = null } = {}) {
  const release = { id: 12, tag_name: 'v0.1.0', draft: releaseDraft, upload_url: 'https://uploads.github.com/test' };
  const events = [];
  const assets = state ? [{ id: 55, name: 'amo-upload-state.json' }] : [];
  const githubApi = {
    async getReleaseByTag(tag) {
      events.push(['get-release', tag]);
      return releaseExists ? release : null;
    },
    async createDraftRelease(input) {
      events.push(['create-draft', input.tag]);
      return release;
    },
    async listAssets() { return assets; },
    async uploadAsset(targetRelease, name, bytes) {
      const parsed = name === 'amo-upload-state.json' ? JSON.parse(bytes.toString()) : null;
      events.push(['upload-asset', name, parsed]);
      if (name === 'amo-upload-state.json') {
        if (!assets.some((asset) => asset.name === name)) assets.push({ id: 55, name });
        return assets.find((asset) => asset.name === name);
      } else if (!assets.some((asset) => asset.name === name)) {
        assets.push({ id: 56, name });
      }
      return assets.find((asset) => asset.name === name);
    },
    async downloadAsset() { return Buffer.from(JSON.stringify(state)); },
    async deleteAsset(id) {
      events.push(['delete-state', id]);
      const index = assets.findIndex((asset) => asset.id === id);
      if (index >= 0) assets.splice(index, 1);
    },
  };
  const amoClient = {
    async getAddon(addonId) {
      events.push(['get-addon', addonId]);
      return existingAddon ? { guid: addonId } : null;
    },
  };
  const files = new Map([
    ['manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['.amo-metadata.json', Buffer.from(JSON.stringify({ summary: { 'en-US': 'Extension summary' }, categories: ['other'] }))],
    ['dist/epic-fab-redeemer-v0.1.0.zip', Buffer.from('source zip')],
  ]);
  const env = {
    GITHUB_REF_NAME: 'v0.1.0',
    GITHUB_REPOSITORY: 'Tifloz/epic-fab-redeemer-firefox',
    GITHUB_TOKEN: 'github-token',
    AMO_API_KEY: 'amo-key',
    AMO_API_SECRET: 'amo-secret',
    AMO_LICENSE: 'all-rights-reserved',
  };
  let signCalls = 0;
  const execFile = async (command, args, options) => {
    events.push(['sign', args, options]);
    signCalls += 1;
    if (execFailure) throw execFailure;
    files.set('.amo-upload-uuid', Buffer.from(JSON.stringify({ uploadUuid, channel: 'listed', xpiCrcHash: 'test-hash' })));
    return { stdout: 'AMO upload created', stderr: '' };
  };

  return {
    events,
    assets,
    env,
    githubApi,
    files,
    get signCalls() { return signCalls; },
    async run(extra = {}) {
      return prepareRelease({
        env,
        githubApi,
        amoClient,
        execFile,
        readFile: async (path) => {
          if (!files.has(path)) throw new Error(`Missing test file ${path}`);
          return files.get(path);
        },
        writeFile: async (path, bytes) => { files.set(path, Buffer.from(bytes)); },
        ...extra,
      });
    },
  };
}

test('validates required inputs and tag before GitHub or AMO side effects', async () => {
  const harness = createHarness();
  harness.env.GITHUB_REF_NAME = 'v0.1.1';

  await assert.rejects(harness.run(), /does not match/);
  assert.deepEqual(harness.events, []);
  assert.equal(harness.signCalls, 0);
});

test('rejects a missing or invalid license before creating the draft', async () => {
  const harness = createHarness();
  delete harness.env.AMO_LICENSE;

  await assert.rejects(harness.run(), /AMO_LICENSE/);
  assert.deepEqual(harness.events.map((event) => event[0]), ['get-release', 'get-addon']);
  assert.equal(harness.signCalls, 0);
});

test('creates draft state before one AMO submission and stores the resulting upload UUID', async () => {
  const harness = createHarness();

  await harness.run();

  const marker = harness.events.findIndex((event) => event[0] === 'upload-asset' && event[2]?.status === 'submitting');
  const sign = harness.events.findIndex((event) => event[0] === 'sign');
  const submitted = harness.events.findIndex((event) => event[0] === 'upload-asset' && event[2]?.status === 'submitted');
  assert.ok(marker >= 0 && marker < sign && sign < submitted);
  assert.equal(harness.signCalls, 1);
  assert.deepEqual(harness.events[submitted][2], {
    schemaVersion: 1,
    tag: 'v0.1.0',
    status: 'submitted',
    uploadUuid,
    addonId: '{41f50f5e-77ac-47ec-8c28-3d16a00fa80e}',
  });
  const signOptions = harness.events[sign][2];
  assert.equal(signOptions.env.WEB_EXT_API_KEY, 'amo-key');
  assert.equal(signOptions.env.WEB_EXT_API_SECRET, 'amo-secret');
  assert.equal(signOptions.env.AMO_API_KEY, undefined);
  assert.equal(signOptions.env.AMO_API_SECRET, undefined);
  assert.equal(signOptions.env.GITHUB_TOKEN, undefined);
  assert.equal(signOptions.windowsHide, true);
  assert.equal(harness.events[sign][1].includes('amo-secret'), false);
});

test('resumes submitted draft state without submitting a second AMO upload', async () => {
  const state = {
    schemaVersion: 1,
    tag: 'v0.1.0',
    status: 'submitted',
    uploadUuid,
    addonId: '{41f50f5e-77ac-47ec-8c28-3d16a00fa80e}',
  };
  const harness = createHarness({ state, releaseExists: true });

  await harness.run();

  assert.equal(harness.signCalls, 0);
  assert.equal(harness.events.filter((event) => event[0] === 'upload-asset' && event[2]?.status === 'submitted').length, 0);
});

test('inherits the existing AMO listing license without requiring or replacing it', async () => {
  const harness = createHarness({ existingAddon: true });
  delete harness.env.AMO_LICENSE;

  await harness.run();

  assert.equal(harness.signCalls, 1);
  assert.equal(harness.events.find((event) => event[0] === 'sign')[1].some((arg) => arg.startsWith('--amo-metadata=')), false);
});

test('fails closed when a prior run left an ambiguous submitting marker', async () => {
  const state = {
    schemaVersion: 1,
    tag: 'v0.1.0',
    status: 'submitting',
    uploadUuid: null,
    addonId: '{41f50f5e-77ac-47ec-8c28-3d16a00fa80e}',
  };
  const harness = createHarness({ state, releaseExists: true });

  await assert.rejects(harness.run(), /manual AMO reconciliation/);
  assert.equal(harness.signCalls, 0);
});

test('refuses to update a published release for the same tag', async () => {
  const harness = createHarness({ releaseExists: true, releaseDraft: false });

  await assert.rejects(harness.run(), /must remain a draft/);
  assert.equal(harness.signCalls, 0);
});
