import { createHash } from 'node:crypto';

const EXPECTED_GECKO_ID = '{41f50f5e-77ac-47ec-8c28-3d16a00fa80e}';
const EXPECTED_HOST_PERMISSIONS = [
  'https://store.epicgames.com/*',
  'https://www.fab.com/*',
];
const ACCEPTED_AMO_LICENSES = new Set([
  'all-rights-reserved',
  'MPL-2.0',
  'Apache-2.0',
  'GPL-2.0-only',
  'GPL-3.0-only',
  'LGPL-2.1-only',
  'LGPL-3.0-only',
  'AGPL-3.0-only',
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'Unlicense',
]);

export function validateManifest(manifest) {
  if (manifest?.manifest_version !== 3) {
    throw new Error('Manifest must use Firefox Manifest V3.');
  }

  if (manifest?.browser_specific_settings?.gecko?.id !== EXPECTED_GECKO_ID) {
    throw new Error('Manifest must keep the stable Firefox Gecko add-on ID.');
  }

  const dataPermissions = manifest?.browser_specific_settings?.gecko?.data_collection_permissions;
  if (!sameValues(dataPermissions?.required, ['none']) || (dataPermissions?.optional?.length ?? 0) > 0) {
    throw new Error('Manifest must declare no required or optional data collection.');
  }

  if (!sameValues(manifest.permissions, ['storage'])) {
    throw new Error('Manifest permissions must remain limited to storage.');
  }

  if (!sameValues(manifest.host_permissions, EXPECTED_HOST_PERMISSIONS)) {
    throw new Error('Manifest host permissions must remain limited to the Epic and Fab storefronts.');
  }

  return true;
}

export function versionFromTag(tag, manifestVersion) {
  if (typeof tag !== 'string' || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Release tag must be v-prefixed and use MAJOR.MINOR.PATCH.');
  }

  const version = tag.slice(1);
  if (version !== manifestVersion) {
    throw new Error(`Release tag version ${version} does not match manifest version ${manifestVersion}.`);
  }

  return version;
}

export function validateAmoLicense(license) {
  if (typeof license !== 'string' || license.trim() === '') {
    throw new Error('AMO_LICENSE repository variable is required.');
  }

  if (license !== license.trim() || !ACCEPTED_AMO_LICENSES.has(license)) {
    throw new Error(`AMO license slug is not an accepted AMO license: ${license}.`);
  }

  return license;
}

export function assertPublishableAmoVersion({
  tag,
  manifestVersion,
  version,
  fileStatus,
  fileUrl,
  sha256,
}) {
  const expectedVersion = versionFromTag(tag, manifestVersion);

  if (version !== expectedVersion) {
    throw new Error(`AMO version does not match release tag version ${expectedVersion}.`);
  }

  if (fileStatus !== 'public') {
    throw new Error(`AMO file is not public (status: ${fileStatus ?? 'missing'}).`);
  }

  let signedFileUrl;
  try {
    signedFileUrl = new URL(fileUrl);
  } catch {
    throw new Error('AMO signed file URL must be a valid HTTPS Mozilla URL.');
  }

  if (signedFileUrl.protocol !== 'https:' || signedFileUrl.port !== '') {
    throw new Error('AMO signed file URL must use HTTPS.');
  }

  if (signedFileUrl.hostname !== 'addons.mozilla.org') {
    throw new Error('AMO signed file URL must use the Mozilla Add-ons host.');
  }
  if (signedFileUrl.username !== '' || signedFileUrl.password !== '') {
    throw new Error('AMO signed file URL must not include credentials.');
  }

  if (typeof sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(sha256)) {
    throw new Error('AMO must provide a valid SHA-256 digest.');
  }

  return true;
}

export function verifySha256(buffer, expected) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError('Signed XPI contents must be bytes.');
  }

  if (typeof expected !== 'string' || !/^[a-f\d]{64}$/i.test(expected)) {
    throw new Error('Expected SHA-256 digest must contain 64 hexadecimal characters.');
  }

  const actual = createHash('sha256').update(buffer).digest('hex');
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('Signed XPI digest mismatch.');
  }

  return true;
}

function sameValues(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return sortedActual.every((value, index) => value === sortedExpected[index]);
}
