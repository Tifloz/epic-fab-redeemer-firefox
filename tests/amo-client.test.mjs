import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createAmoClient } from '../scripts/amo-client.mjs';

const uploadUuid = 'f7de8de4-9c4b-4f1e-9f7e-8e1342c32111';
const decodeSegment = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

test('creates a short-lived HMAC-SHA256 JWT and authenticates AMO requests', async () => {
  let request;
  const client = createAmoClient({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    now: () => 1_800_000_000_000,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ uuid: uploadUuid }) };
    },
  });

  assert.deepEqual(await client.getUpload(uploadUuid), { uuid: uploadUuid });
  assert.equal(request.url.href, `https://addons.mozilla.org/api/v5/addons/upload/${uploadUuid}/`);
  assert.equal(request.options.method, 'GET');
  const token = request.options.headers.Authorization.slice('JWT '.length);
  const [encodedHeader, encodedClaims, signature] = token.split('.');
  const header = decodeSegment(encodedHeader);
  const claims = decodeSegment(encodedClaims);
  const expectedSignature = createHmac('sha256', 'test-secret')
    .update(`${encodedHeader}.${encodedClaims}`)
    .digest('base64url');

  assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
  assert.equal(claims.iss, 'test-key');
  assert.equal(claims.iat, 1_800_000_000);
  assert.equal(claims.exp, claims.iat + 60);
  assert.ok(typeof claims.jti === 'string' && claims.jti.length > 0);
  assert.equal(signature, expectedSignature);
});

test('queries the exact version detail endpoint for an add-on ID and version', async () => {
  let requestedUrl;
  const client = createAmoClient({
    apiKey: 'key',
    apiSecret: 'secret',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, status: 200, json: async () => ({ version: '0.1.0' }) };
    },
  });

  assert.deepEqual(await client.getVersion('{addon@example}', '0.1.0'), { version: '0.1.0' });
  assert.equal(requestedUrl.href, 'https://addons.mozilla.org/api/v5/addons/addon/%7Baddon%40example%7D/versions/0.1.0/');
});

test('looks up the existing AMO listing and returns null when the add-on is not listed yet', async () => {
  const requested = [];
  const client = createAmoClient({
    apiKey: 'key',
    apiSecret: 'secret',
    fetchImpl: async (url) => {
      requested.push(url.href);
      return { ok: false, status: 404 };
    },
  });

  assert.equal(await client.getAddon('{addon@example}'), null);
  assert.equal(requested[0], 'https://addons.mozilla.org/api/v5/addons/addon/%7Baddon%40example%7D/');
});

test('returns null when a requested AMO version is not visible yet', async () => {
  const client = createAmoClient({
    apiKey: 'key',
    apiSecret: 'secret',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });

  assert.equal(await client.getVersion('{addon@example}', '0.1.1'), null);
});

test('rejects missing credentials before making a request', async () => {
  let called = false;
  const client = createAmoClient({ apiKey: '', apiSecret: 'secret', fetchImpl: async () => { called = true; } });

  await assert.rejects(client.getUpload(uploadUuid), /credentials are required/);
  assert.equal(called, false);
});

test('does not expose response bodies or credentials in API errors', async () => {
  const client = createAmoClient({
    apiKey: 'private-key',
    apiSecret: 'private-secret',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ detail: 'private response body' }) }),
  });

  await assert.rejects(client.getUpload(uploadUuid), (error) => {
    assert.match(error.message, /403/);
    assert.match(error.message, /addons\/upload/);
    assert.doesNotMatch(error.message, /private-key|private-secret|private response body/);
    return true;
  });
});

test('rejects invalid JSON and malformed upload identifiers', async () => {
  const client = createAmoClient({
    apiKey: 'key',
    apiSecret: 'secret',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid'); } }),
  });

  assert.throws(() => client.getUpload('uuid/with/path'), /upload UUID/);
  await assert.rejects(client.getUpload(uploadUuid), /valid JSON/);
});
