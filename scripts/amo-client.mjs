import { createHmac, randomUUID } from 'node:crypto';

const AMO_API_BASE = 'https://addons.mozilla.org/api/v5/';
const TOKEN_LIFETIME_SECONDS = 60;

export function createAmoClient({ apiKey, apiSecret, fetchImpl = fetch, now = Date.now }) {
  return {
    getAddon(addonId) {
      if (typeof addonId !== 'string' || addonId.length === 0 || addonId.length > 255) {
        throw new Error('AMO add-on ID is invalid.');
      }

      return request(`addons/addon/${encodeURIComponent(addonId)}/`, { allowNotFound: true });
    },

    getUpload(uuid) {
      if (!isUuid(uuid)) {
        throw new Error('AMO upload UUID is invalid.');
      }

      return request(`addons/upload/${encodeURIComponent(uuid)}/`);
    },

    getVersion(addonId, version) {
      if (typeof addonId !== 'string' || addonId.length === 0 || addonId.length > 255) {
        throw new Error('AMO add-on ID is invalid.');
      }
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error('AMO version is invalid.');
      }

      return request(`addons/addon/${encodeURIComponent(addonId)}/versions/${encodeURIComponent(version)}/`);
    },
  };

  async function request(path, { allowNotFound = false } = {}) {
    if (typeof apiKey !== 'string' || apiKey.length === 0
      || typeof apiSecret !== 'string' || apiSecret.length === 0) {
      throw new Error('AMO API credentials are required.');
    }

    const url = new URL(path, AMO_API_BASE);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `JWT ${createToken(apiKey, apiSecret, now)}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(`AMO API request failed for ${url.pathname}.`);
    }

    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`AMO API returned HTTP ${response.status} for ${url.pathname}.`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error(`AMO API returned invalid JSON for ${url.pathname}.`);
    }
  }
}

function createToken(apiKey, apiSecret, now) {
  const issuedAt = Math.floor(now() / 1000);
  const header = encodeBase64Url({ alg: 'HS256', typ: 'JWT' });
  const claims = encodeBase64Url({
    iss: apiKey,
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  });
  const unsignedToken = `${header}.${claims}`;
  const signature = createHmac('sha256', apiSecret).update(unsignedToken).digest('base64url');
  return `${unsignedToken}.${signature}`;
}

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
