import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertPublishableAmoVersion,
  validateAmoLicense,
  validateManifest,
  verifySha256,
  versionFromTag,
} from '../scripts/release-contract.mjs';

const validManifest = {
  manifest_version: 3,
  browser_specific_settings: {
    gecko: {
      id: '{41f50f5e-77ac-47ec-8c28-3d16a00fa80e}',
      data_collection_permissions: { required: ['none'] },
    },
  },
  permissions: ['storage'],
  host_permissions: ['https://store.epicgames.com/*', 'https://www.fab.com/*'],
};
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('accepts the stable Firefox manifest contract', () => {
  assert.equal(validateManifest(validManifest), true);
});

test('rejects a missing Firefox add-on ID', () => {
  const manifest = structuredClone(validManifest);
  delete manifest.browser_specific_settings.gecko.id;
  assert.throws(() => validateManifest(manifest), /Gecko add-on ID/);
});

test('requires Firefox to declare that the extension does not collect data', () => {
  const manifest = structuredClone(validManifest);
  delete manifest.browser_specific_settings.gecko.data_collection_permissions;
  assert.throws(() => validateManifest(manifest), /data collection/);
});

test('rejects expanded or changed storefront access', () => {
  assert.throws(() => validateManifest({
    ...validManifest,
    host_permissions: [...validManifest.host_permissions, '<all_urls>'],
  }), /host permissions/);
});

test('keeps every manifest script, page, stylesheet, and web resource in the repository', () => {
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'manifest.json'), 'utf8'));
  const paths = [
    ...manifest.background.scripts,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css ?? [])]),
    ...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
  ];

  assert.ok(paths.length > 0);
  for (const path of paths) assert.ok(existsSync(resolve(projectRoot, path)), `Missing manifest path: ${path}`);
});

test('requires a semantic v-prefixed tag matching the manifest version', () => {
  assert.equal(versionFromTag('v0.1.0', '0.1.0'), '0.1.0');
  assert.throws(() => versionFromTag('0.1.0', '0.1.0'), /v-prefixed/);
  assert.throws(() => versionFromTag('v0.1.1', '0.1.0'), /does not match/);
});

test('requires an explicit AMO license slug', () => {
  assert.equal(validateAmoLicense('all-rights-reserved'), 'all-rights-reserved');
  assert.equal(validateAmoLicense('MIT'), 'MIT');
  assert.equal(validateAmoLicense('GPL-2.0-only'), 'GPL-2.0-only');
  assert.throws(() => validateAmoLicense(''), /required/);
  assert.throws(() => validateAmoLicense('made-up-license'), /not an accepted/);
  assert.throws(() => validateAmoLicense('GPL-2.0'), /not an accepted/);
  assert.throws(() => validateAmoLicense('CC-BY-4.0'), /not an accepted/);
});

test('allows publication only for the matching public AMO version', () => {
  assert.equal(assertPublishableAmoVersion({
    tag: 'v0.1.0',
    manifestVersion: '0.1.0',
    version: '0.1.0',
    fileStatus: 'public',
    fileUrl: 'https://addons.mozilla.org/firefox/downloads/file/123/addon.xpi',
    sha256: 'a'.repeat(64),
  }), true);
  assert.throws(() => assertPublishableAmoVersion({
    tag: 'v0.1.0', manifestVersion: '0.1.0', version: '0.1.0',
    fileStatus: 'unreviewed', fileUrl: 'https://addons.mozilla.org/file.xpi', sha256: 'a'.repeat(64),
  }), /not public/);
  assert.throws(() => assertPublishableAmoVersion({
    tag: 'v0.1.0', manifestVersion: '0.1.0', version: '0.1.1',
    fileStatus: 'public', fileUrl: 'https://addons.mozilla.org/file.xpi', sha256: 'a'.repeat(64),
  }), /version does not match/);
  assert.throws(() => assertPublishableAmoVersion({
    tag: 'v0.1.0', manifestVersion: '0.1.0', version: '0.1.0',
    fileStatus: 'disabled', fileUrl: 'https://addons.mozilla.org/file.xpi', sha256: 'a'.repeat(64),
  }), /not public/);
});

test('requires a valid Mozilla HTTPS signed file URL and SHA-256 digest', () => {
  const base = {
    tag: 'v0.1.0', manifestVersion: '0.1.0', version: '0.1.0',
    fileStatus: 'public', fileUrl: 'https://addons.mozilla.org/file.xpi', sha256: 'a'.repeat(64),
  };
  assert.throws(() => assertPublishableAmoVersion({ ...base, fileUrl: 'http://addons.mozilla.org/file.xpi' }), /HTTPS/);
  assert.throws(() => assertPublishableAmoVersion({ ...base, fileUrl: 'https://evil.example/file.xpi' }), /Mozilla/);
  assert.throws(() => assertPublishableAmoVersion({ ...base, fileUrl: 'https://addons.mozilla.org:444/file.xpi' }), /HTTPS/);
  assert.throws(() => assertPublishableAmoVersion({ ...base, fileUrl: 'https://user:pass@addons.mozilla.org/file.xpi' }), /credentials/);
  assert.throws(() => assertPublishableAmoVersion({ ...base, sha256: 'abc' }), /SHA-256/);
});

test('verifies downloaded signed XPI bytes with SHA-256', () => {
  const bytes = Buffer.from('signed addon bytes');
  const digest = '177055614634952799a91f6efbdc5e67aa5965065545ab04eeb8d0139b97b517';
  assert.equal(verifySha256(bytes, digest), true);
  assert.throws(() => verifySha256(bytes, '0'.repeat(64)), /digest mismatch/);
});
