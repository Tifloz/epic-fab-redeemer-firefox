const GITHUB_API = 'https://api.github.com/';
const GITHUB_UPLOADS_HOST = 'uploads.github.com';

export function createGitHubReleaseClient({ token, repository, fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('GitHub token is required.');
  }
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GitHub repository must use owner/repo format.');
  }

  const repositoryPath = `repos/${repository}`;

  return {
    async getReleaseByTag(tag) {
      const path = `${repositoryPath}/releases/tags/${encodeURIComponent(tag)}`;
      return request(path, { allowNotFound: true });
    },

    async createDraftRelease({ tag, name, body }) {
      return request(`${repositoryPath}/releases`, {
        method: 'POST',
        body: { tag_name: tag, name, body, draft: true, prerelease: false },
      });
    },

    async listAssets(releaseId) {
      const assets = [];
      let page = 1;
      while (true) {
        const response = await requestRaw(`${repositoryPath}/releases/${numericId(releaseId)}/assets?per_page=100&page=${page}`);
        const pageAssets = await parseJson(response, response.url);
        if (!Array.isArray(pageAssets)) throw new Error('GitHub release assets response is invalid.');
        assets.push(...pageAssets);
        if (!nextPage(response.headers)) return assets;
        page += 1;
      }
    },

    async listDraftReleases() {
      const releases = [];
      let page = 1;
      while (true) {
        const response = await requestRaw(`${repositoryPath}/releases?per_page=100&page=${page}`);
        const pageReleases = await parseJson(response, response.url);
        if (!Array.isArray(pageReleases)) throw new Error('GitHub releases response is invalid.');
        releases.push(...pageReleases.filter((release) => release.draft));
        if (!nextPage(response.headers)) return releases;
        page += 1;
      }
    },

    async uploadAsset(release, name, bytes, contentType = 'application/octet-stream') {
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw new TypeError('GitHub release assets must be bytes.');
      }
      const uploadUrl = new URL(release?.upload_url?.replace(/\{\?[^}]*\}$/, ''));
      const expectedPath = `/${repositoryPath}/releases/${numericId(release.id)}/assets`;
      if (uploadUrl.protocol !== 'https:' || uploadUrl.port !== ''
        || uploadUrl.hostname !== GITHUB_UPLOADS_HOST || uploadUrl.pathname !== expectedPath) {
        throw new Error('GitHub release upload URL is not trusted.');
      }
      uploadUrl.searchParams.set('name', name);
      const response = await fetchSafe(fetchImpl, uploadUrl, {
        method: 'POST',
        headers: headers(token, 'application/vnd.github+json', contentType),
        body: bytes,
      });
      return parseJson(response, uploadUrl.pathname);
    },

    async downloadAsset(asset) {
      const assetId = numericId(asset?.id);
      const path = `${repositoryPath}/releases/assets/${assetId}`;
      const response = await requestRaw(path, { accept: 'application/octet-stream' });
      return Buffer.from(await response.arrayBuffer());
    },

    async deleteAsset(assetId) {
      const path = `${repositoryPath}/releases/assets/${numericId(assetId)}`;
      await requestRaw(path, { method: 'DELETE' });
    },

    async updateRelease(releaseId, changes) {
      return request(`${repositoryPath}/releases/${numericId(releaseId)}`, {
        method: 'PATCH',
        body: changes,
      });
    },
  };

  async function request(path, { method = 'GET', body, allowNotFound = false } = {}) {
    const response = await requestRaw(path, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      allowNotFound,
    });
    if (response === null) return null;
    return parseJson(response, path);
  }

  async function requestRaw(path, {
    method = 'GET',
    body,
    accept = 'application/vnd.github+json',
    contentType = 'application/json',
    allowNotFound = false,
  } = {}) {
    const url = new URL(path, GITHUB_API);
    if (url.origin !== new URL(GITHUB_API).origin || !url.pathname.startsWith(`/${repositoryPath}/`)) {
      throw new Error('GitHub API path is outside the configured repository.');
    }
    const response = await fetchSafe(fetchImpl, url, {
      method,
      headers: headers(token, accept, contentType),
      ...(body === undefined ? {} : { body }),
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw apiError(response.status, url.pathname);
    return response;
  }
}

async function fetchSafe(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(30_000), ...options });
  } catch {
    throw new Error(`GitHub API request failed for ${url.pathname}.`);
  }
}

async function parseJson(response, endpoint) {
  try {
    return await response.json();
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}.`);
  }
}

function headers(token, accept, contentType) {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'Content-Type': contentType,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'epic-fab-redeemer-release-automation',
  };
}

function apiError(status, endpoint) {
  return new Error(`GitHub API returned HTTP ${status} for ${endpoint}.`);
}

function numericId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('GitHub release or asset ID is invalid.');
  return id;
}

function nextPage(linkHeader) {
  const links = linkHeader?.get('Link');
  return typeof links === 'string' && /<[^>]+>;\s*rel="next"/.test(links);
}
