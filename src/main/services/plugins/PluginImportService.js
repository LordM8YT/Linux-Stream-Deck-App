const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const unzipper = require('unzipper');
const { validateManifest } = require('./PluginManager');

class PluginImportService {
  constructor({ pluginManager, userPluginsRoot, fetchImpl }) {
    this.pluginManager = pluginManager;
    this.userPluginsRoot = path.resolve(userPluginsRoot);
    this.fetchImpl = fetchImpl || global.fetch;

    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Plugin import requires a fetch implementation.');
    }
  }

  async inspectSource(sourceUrl) {
    const resolved = await resolvePluginSource(sourceUrl, this.fetchImpl);

    return {
      pluginId: resolved.manifest.id,
      pluginName: resolved.manifest.name,
      pluginVersion: resolved.manifest.version,
      description: resolved.manifest.description || '',
      actionCount: resolved.manifest.actions.length,
      fileCount: resolved.files.size,
      resolver: resolved.resolver,
      sourceUrl: resolved.sourceUrl,
      resolvedSourceUrl: resolved.resolvedSourceUrl,
      reference: resolved.reference
    };
  }

  async installFromUrl(sourceUrl) {
    const resolved = await resolvePluginSource(sourceUrl, this.fetchImpl);
    const existingPlugin = this.pluginManager.getPlugin(resolved.manifest.id);

    if (existingPlugin && !isPathInside(existingPlugin.root, this.userPluginsRoot)) {
      throw new Error(`Plugin "${resolved.manifest.id}" is already bundled with DeckSmith. Rename the plugin id or import a different plugin.`);
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'decksmith-plugin-'));
    const stagingRoot = path.join(tempRoot, resolved.manifest.id);
    const installRoot = path.join(this.userPluginsRoot, resolved.manifest.id);

    try {
      await fs.mkdir(stagingRoot, { recursive: true });

      for (const [relativePath, content] of resolved.files.entries()) {
        const targetPath = resolveChildPath(stagingRoot, relativePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content);
      }

      const sourceMetadataPath = path.join(stagingRoot, '.decksmith-source.json');
      await fs.writeFile(sourceMetadataPath, JSON.stringify({
        resolver: resolved.resolver,
        sourceUrl: resolved.sourceUrl,
        resolvedSourceUrl: resolved.resolvedSourceUrl,
        reference: resolved.reference,
        importedAt: new Date().toISOString()
      }, null, 2));

      await fs.mkdir(this.userPluginsRoot, { recursive: true });
      await fs.rm(installRoot, { recursive: true, force: true });
      await fs.rename(stagingRoot, installRoot);

      return {
        pluginId: resolved.manifest.id,
        pluginName: resolved.manifest.name,
        pluginVersion: resolved.manifest.version,
        installRoot,
        fileCount: resolved.files.size,
        resolver: resolved.resolver,
        sourceUrl: resolved.sourceUrl
      };
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function resolvePluginSource(sourceUrl, fetchImpl) {
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  const url = new URL(normalizedSourceUrl);

  if (looksLikeZipUrl(url)) {
    return resolveZipPluginSource(url, fetchImpl);
  }

  if (url.hostname === 'github.com') {
    return resolveGitHubPluginSource(url, fetchImpl);
  }

  return resolveJsonPluginSource(url, fetchImpl);
}

async function resolveJsonPluginSource(url, fetchImpl) {
  const descriptor = await fetchJson(url.toString(), fetchImpl, {
    accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
  });

  if (descriptor?.type === 'decksmith-plugin-source' && typeof descriptor.source?.url === 'string') {
    return resolvePluginSource(descriptor.source.url, fetchImpl);
  }

  if (Array.isArray(descriptor?.plugins)) {
    const pluginId = decodeURIComponent(url.hash.replace(/^#/, ''));
    const selectedPlugin = pluginId
      ? descriptor.plugins.find((plugin) => plugin.id === pluginId)
      : descriptor.plugins.length === 1
        ? descriptor.plugins[0]
        : null;

    if (!selectedPlugin) {
      throw new Error('Marketplace feeds must either contain a single plugin or use a URL fragment like "#plugin-id" to choose one plugin.');
    }

    if (typeof selectedPlugin.source?.url !== 'string') {
      throw new Error(`Marketplace entry "${selectedPlugin.id}" does not include a valid source URL.`);
    }

    return resolvePluginSource(selectedPlugin.source.url, fetchImpl);
  }

  throw new Error('Unsupported plugin source. Paste a GitHub repository URL, a direct plugin zip, or a DeckSmith marketplace JSON URL.');
}

async function resolveZipPluginSource(url, fetchImpl) {
  const archiveBuffer = await fetchBinary(url.toString(), fetchImpl);
  const directory = await unzipper.Open.buffer(archiveBuffer);
  const pluginRoot = detectZipPluginRoot(directory.files);
  const files = new Map();

  for (const entry of directory.files) {
    if (entry.type !== 'File') {
      continue;
    }

    const normalizedPath = normalizeZipPath(entry.path);

    if (!normalizedPath || normalizedPath.startsWith('__MACOSX/')) {
      continue;
    }

    if (!normalizedPath.startsWith(pluginRoot)) {
      continue;
    }

    const relativePath = normalizeRelativeZipPath(pluginRoot, normalizedPath);

    if (!relativePath) {
      continue;
    }

    files.set(relativePath, await entry.buffer());
  }

  const manifestBuffer = files.get('manifest.json');
  const entryBuffer = files.get('index.js');

  if (!manifestBuffer || !entryBuffer) {
    throw new Error('The plugin zip must contain manifest.json and index.js inside the same plugin folder.');
  }

  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  validateManifest(manifest);

  return {
    resolver: 'zip',
    sourceUrl: url.toString(),
    resolvedSourceUrl: url.toString(),
    reference: url.toString(),
    manifest,
    files
  };
}

async function resolveGitHubPluginSource(url, fetchImpl) {
  const location = await parseGitHubPluginLocation(url, fetchImpl);
  const pluginPath = location.pluginPath ?? await detectGitHubPluginRoot(location.owner, location.repo, location.ref, fetchImpl);
  const files = await downloadGitHubDirectory(location.owner, location.repo, location.ref, pluginPath, fetchImpl);
  const manifestBuffer = files.get('manifest.json');
  const entryBuffer = files.get('index.js');

  if (!manifestBuffer) {
    throw new Error('The plugin source does not contain a manifest.json file.');
  }

  if (!entryBuffer) {
    throw new Error('The plugin source does not contain an index.js entry file.');
  }

  const manifest = JSON.parse(manifestBuffer.toString('utf8'));
  validateManifest(manifest);

  return {
    resolver: 'github',
    sourceUrl: url.toString(),
    resolvedSourceUrl: buildGitHubTreeUrl(location.owner, location.repo, location.ref, pluginPath),
    reference: `${location.owner}/${location.repo}@${location.ref}${pluginPath ? `:${pluginPath}` : ''}`,
    manifest,
    files
  };
}

async function parseGitHubPluginLocation(url, fetchImpl) {
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  if (segments.length < 2) {
    throw new Error('GitHub plugin imports must point to a repository or a plugin folder inside a repository.');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  const mode = segments[2] || null;

  if (!mode) {
    return {
      owner,
      repo,
      ref: await fetchGitHubDefaultBranch(owner, repo, fetchImpl),
      pluginPath: null
    };
  }

  if (mode !== 'tree' && mode !== 'blob') {
    return {
      owner,
      repo,
      ref: await fetchGitHubDefaultBranch(owner, repo, fetchImpl),
      pluginPath: null
    };
  }

  const remainder = segments.slice(3);

  if (remainder.length === 0) {
    throw new Error('GitHub tree and blob URLs must include a branch or tag name.');
  }

  for (let splitIndex = remainder.length; splitIndex >= 1; splitIndex -= 1) {
    const ref = remainder.slice(0, splitIndex).join('/');
    const candidatePath = remainder.slice(splitIndex).join('/');
    const contents = await fetchGitHubContents(owner, repo, ref, candidatePath, fetchImpl, {
      allowNotFound: true
    });

    if (!contents) {
      continue;
    }

    return {
      owner,
      repo,
      ref,
      pluginPath: normalizeGitHubPluginPath(candidatePath, contents)
    };
  }

  throw new Error('DeckSmith could not resolve that GitHub URL. Paste a repository URL or a direct plugin folder URL.');
}

function normalizeGitHubPluginPath(candidatePath, contents) {
  if (Array.isArray(contents)) {
    return candidatePath;
  }

  if (contents.type === 'file') {
    const filePath = contents.path || candidatePath;
    const fileName = path.posix.basename(filePath);

    if (fileName === 'manifest.json' || fileName === 'index.js') {
      const directory = path.posix.dirname(filePath);
      return directory === '.' ? '' : directory;
    }
  }

  throw new Error('GitHub URL must point to a plugin folder, manifest.json, or index.js file.');
}

function detectZipPluginRoot(entries) {
  const filePaths = entries
    .filter((entry) => entry.type === 'File')
    .map((entry) => normalizeZipPath(entry.path))
    .filter(Boolean);
  const directories = new Set(['']);

  for (const filePath of filePaths) {
    const segments = filePath.split('/');

    while (segments.length > 1) {
      segments.pop();
      directories.add(segments.join('/'));
    }
  }

  const candidates = Array.from(directories)
    .filter((directoryPath) => {
      const prefix = directoryPath ? `${directoryPath}/` : '';

      return filePaths.includes(`${prefix}manifest.json`) && filePaths.includes(`${prefix}index.js`);
    })
    .sort((left, right) => left.length - right.length);

  if (candidates.length === 0) {
    throw new Error('DeckSmith could not find a plugin folder inside that zip. The archive needs manifest.json and index.js.');
  }

  return candidates[0] ? `${candidates[0]}/` : '';
}

function normalizeZipPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function normalizeRelativeZipPath(rootPath, filePath) {
  const relativePath = rootPath
    ? filePath.slice(rootPath.length)
    : filePath;

  return relativePath.replace(/^\/+/, '');
}

async function detectGitHubPluginRoot(owner, repo, ref, fetchImpl) {
  const rootEntries = await fetchGitHubContents(owner, repo, ref, '', fetchImpl);

  if (directoryLooksLikePlugin(rootEntries)) {
    return '';
  }

  const candidateDirectories = [];

  for (const entry of rootEntries) {
    if (entry.type !== 'dir') {
      continue;
    }

    const childEntries = await fetchGitHubContents(owner, repo, ref, entry.path, fetchImpl, {
      allowNotFound: true
    });

    if (Array.isArray(childEntries) && directoryLooksLikePlugin(childEntries)) {
      candidateDirectories.push(entry.path);
    }
  }

  if (candidateDirectories.length === 1) {
    return candidateDirectories[0];
  }

  if (candidateDirectories.length > 1) {
    throw new Error(`This repository contains multiple plugin folders (${candidateDirectories.join(', ')}). Paste a direct URL to the plugin folder you want to import.`);
  }

  throw new Error('DeckSmith could not find a plugin folder in that repository. The folder needs at least manifest.json and index.js.');
}

function directoryLooksLikePlugin(entries) {
  const fileNames = new Set(
    entries
      .filter((entry) => entry.type === 'file')
      .map((entry) => path.posix.basename(entry.path || entry.name || ''))
  );

  return fileNames.has('manifest.json') && fileNames.has('index.js');
}

async function downloadGitHubDirectory(owner, repo, ref, directoryPath, fetchImpl) {
  const files = new Map();

  await collectGitHubDirectory(owner, repo, ref, directoryPath, directoryPath, files, fetchImpl);
  return files;
}

async function collectGitHubDirectory(owner, repo, ref, currentPath, rootPath, files, fetchImpl) {
  const entries = await fetchGitHubContents(owner, repo, ref, currentPath, fetchImpl);

  if (!Array.isArray(entries)) {
    throw new Error('The selected GitHub path is not a directory.');
  }

  for (const entry of entries) {
    if (entry.type === 'dir') {
      await collectGitHubDirectory(owner, repo, ref, entry.path, rootPath, files, fetchImpl);
      continue;
    }

    if (entry.type !== 'file' || typeof entry.download_url !== 'string') {
      continue;
    }

    const relativePath = path.posix.relative(rootPath || '.', entry.path);
    files.set(relativePath, await fetchBinary(entry.download_url, fetchImpl));
  }
}

async function fetchGitHubDefaultBranch(owner, repo, fetchImpl) {
  const repository = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, fetchImpl, {
    accept: 'application/vnd.github+json'
  });

  if (typeof repository.default_branch !== 'string' || repository.default_branch.trim() === '') {
    throw new Error('DeckSmith could not determine the default branch for that GitHub repository.');
  }

  return repository.default_branch;
}

async function fetchGitHubContents(owner, repo, ref, contentPath, fetchImpl, { allowNotFound = false } = {}) {
  const normalizedPath = String(contentPath || '')
    .replace(/^\/+|\/+$/g, '');
  const encodedPath = normalizedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents${encodedPath ? `/${encodedPath}` : ''}`;
  const endpoint = `${baseUrl}?ref=${encodeURIComponent(ref)}`;
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DeckSmith'
    }
  });

  if (response.status === 404 && allowNotFound) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await buildFetchError(endpoint, response));
  }

  return response.json();
}

async function fetchJson(url, fetchImpl, { accept } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: accept || 'application/json',
      'User-Agent': 'DeckSmith'
    }
  });

  if (!response.ok) {
    throw new Error(await buildFetchError(url, response));
  }

  return response.json();
}

function looksLikeZipUrl(url) {
  const pathname = String(url.pathname || '').toLowerCase();

  return pathname.endsWith('.zip');
}

async function fetchBinary(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'DeckSmith'
    }
  });

  if (!response.ok) {
    throw new Error(await buildFetchError(url, response));
  }

  return Buffer.from(await response.arrayBuffer());
}

async function buildFetchError(url, response) {
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    return `GitHub rate limit reached while importing a plugin from ${url}. Try again later.`;
  }

  const body = await safeReadText(response);
  const bodySuffix = body ? ` ${body.slice(0, 180)}` : '';

  return `Failed to fetch plugin source (${response.status} ${response.statusText}) from ${url}.${bodySuffix}`.trim();
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function buildGitHubTreeUrl(owner, repo, ref, pluginPath) {
  const suffix = pluginPath ? `/${pluginPath}` : '';
  return `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(ref)}${suffix}`;
}

function normalizeSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== 'string' || sourceUrl.trim() === '') {
    throw new Error('Plugin import requires a URL.');
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(sourceUrl.trim());
  } catch {
    throw new Error('Plugin import only supports valid HTTPS URLs right now.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Plugin import only supports HTTPS URLs right now.');
  }

  return parsedUrl.toString();
}

function resolveChildPath(rootPath, relativePath) {
  const candidatePath = path.resolve(rootPath, ...String(relativePath).split('/'));
  const normalizedRoot = path.resolve(rootPath);

  if (candidatePath !== normalizedRoot && !candidatePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Plugin source contained an unsafe file path: ${relativePath}`);
  }

  return candidatePath;
}

function isPathInside(candidatePath, parentPath) {
  const normalizedCandidate = path.resolve(candidatePath);
  const normalizedParent = path.resolve(parentPath);

  return normalizedCandidate === normalizedParent
    || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

module.exports = {
  PluginImportService
};
