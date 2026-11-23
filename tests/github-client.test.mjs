import assert from 'node:assert/strict';
import test from 'node:test';

import { createGitHubReleaseClient } from '../scripts/github-client.mjs';

test('fetches a release by encoded tag and treats only 404 as absent', async () => {
  const requests = [];
  const client = createGitHubReleaseClient({
    token: 'github-token',
    repository: 'Tifloz/epic-fab-redeemer-firefox',
    fetchImpl: async (url, options) => {
      requests.push({ url: url.href, options });
      return requests.length === 1
        ? { ok: false, status: 404 }
        : { ok: true, status: 200, json: async () => ({ id: 1, tag_name: 'v0.1.0', draft: true }) };
    },
  });

  assert.equal(await client.getReleaseByTag('v0.1.0'), null);
  assert.deepEqual(await client.getReleaseByTag('v0.1.0'), { id: 1, tag_name: 'v0.1.0', draft: true });
  assert.equal(requests[0].url, 'https://api.github.com/repos/Tifloz/epic-fab-redeemer-firefox/releases/tags/v0.1.0');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer github-token');
});

test('uploads binary release assets only to the trusted GitHub uploads host', async () => {
  let request;
  const client = createGitHubReleaseClient({
    token: 'github-token',
    repository: 'Tifloz/epic-fab-redeemer-firefox',
    fetchImpl: async (url, options) => {
      request = { url: url.href, options };
      return { ok: true, status: 201, json: async () => ({ id: 44, name: 'release.zip' }) };
    },
  });

  const asset = await client.uploadAsset({
    id: 7,
    upload_url: 'https://uploads.github.com/repos/Tifloz/epic-fab-redeemer-firefox/releases/7/assets{?name,label}',
  }, 'release zip.zip', Buffer.from('zip bytes'), 'application/zip');

  assert.deepEqual(asset, { id: 44, name: 'release.zip' });
  const uploadUrl = new URL(request.url);
  assert.equal(`${uploadUrl.origin}${uploadUrl.pathname}`, 'https://uploads.github.com/repos/Tifloz/epic-fab-redeemer-firefox/releases/7/assets');
  assert.equal(uploadUrl.searchParams.get('name'), 'release zip.zip');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Content-Type'], 'application/zip');
  assert.equal(request.options.body.toString(), 'zip bytes');
});

test('rejects an upload URL that uses a nonstandard port', async () => {
  let sent = false;
  const client = createGitHubReleaseClient({
    token: 'github-token',
    repository: 'Tifloz/epic-fab-redeemer-firefox',
    fetchImpl: async () => { sent = true; },
  });

  await assert.rejects(client.uploadAsset({
    id: 7,
    upload_url: 'https://uploads.github.com:444/repos/Tifloz/epic-fab-redeemer-firefox/releases/7/assets{?name,label}',
  }, 'file.zip', Buffer.from('zip')),/not trusted/);
  assert.equal(sent, false);
});

test('lists draft releases and reads asset bytes through authenticated REST endpoints', async () => {
  const requests = [];
  const client = createGitHubReleaseClient({
    token: 'github-token',
    repository: 'Tifloz/epic-fab-redeemer-firefox',
    fetchImpl: async (url, options) => {
      requests.push({ url: url.href, options });
      if (url.pathname.endsWith('/releases')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => [{ id: 7, draft: true }] };
      }
      return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    },
  });

  assert.deepEqual(await client.listDraftReleases(), [{ id: 7, draft: true }]);
  assert.deepEqual(await client.downloadAsset({ id: 12 }), Buffer.from([1, 2, 3]));
  assert.match(requests[1].url, /releases\/assets\/12$/);
  assert.equal(requests[1].options.headers.Accept, 'application/octet-stream');
});

test('rejects invalid repository and does not expose API response bodies', async () => {
  assert.throws(() => createGitHubReleaseClient({ token: 'x', repository: 'bad', fetchImpl: fetch }), /owner\/repo/);
  const client = createGitHubReleaseClient({
    token: 'github-token',
    repository: 'Tifloz/epic-fab-redeemer-firefox',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'sensitive response' }) }),
  });

  await assert.rejects(client.listAssets(7), (error) => {
    assert.match(error.message, /403/);
    assert.doesNotMatch(error.message, /github-token|sensitive response/);
    return true;
  });
});
