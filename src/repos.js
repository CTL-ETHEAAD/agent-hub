import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const HUB_ROOT = path.join(WORKSPACE_ROOT, 'agent-hub');
const REPO_CONFIG_ROOT = path.join(HUB_ROOT, 'repos');

export async function listRepos() {
  const configEntries = await readdir(REPO_CONFIG_ROOT, { withFileTypes: true }).catch(() => []);
  const repoCatalog = configEntries.filter((entry) => entry.isDirectory()).map((entry) => ({ repo: entry.name, configPath: path.join(REPO_CONFIG_ROOT, entry.name, 'repo.config.json') }));
  const configuredRepos = await Promise.all(
    repoCatalog.map(async (repo) => {
      const config = await readJsonIfExists(repo.configPath);
      const merged = config ? { ...repo, ...config } : repo;
      return {
        ...merged,
        projectPath: merged.projectPath || path.join(WORKSPACE_ROOT, merged.repo),
        configured: Boolean(config)
      };
    })
  );
  const configuredNames = new Set(configuredRepos.map((repo) => repo.repo));
  const workspaceRepos = (await listWorkspaceFolders())
    .filter((repo) => !configuredNames.has(repo.repo));

  return [...configuredRepos, ...workspaceRepos];
}

async function readJsonIfExists(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function resolveRepo(repoName, ticketId) {
  const repos = await listRepos();
  const explicit = repoName && repos.find((repo) => repo.repo === repoName);
  if (explicit) {
    return explicit;
  }

  const inferred = repos.find((repo) => repo.ticketPrefix && ticketId.toUpperCase().startsWith(repo.ticketPrefix.toUpperCase()));
  if (!inferred) {
    throw new Error(`Cannot infer repo for ticket ${ticketId}`);
  }

  return inferred;
}

async function listWorkspaceFolders() {
  const entries = await readdir(WORKSPACE_ROOT, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => ({
      repo: entry.name,
      ticketPrefix: '',
      projectPath: path.join(WORKSPACE_ROOT, entry.name),
      baseBranch: '',
      branchPattern: 'agent/{workItemId}-{slug}',
      configured: false
    }))
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

export function renderPattern(pattern, values) {
  return pattern.replaceAll(/\{([a-zA-Z]+)\}/g, (_, key) => values[key] || '');
}

export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
