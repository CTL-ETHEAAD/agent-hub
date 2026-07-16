import path from 'node:path';
import { renderPattern, slugify } from '../repos.js';

const DEFAULT_SOURCE_TYPE = 'manual';

export function normalizeWorkItemInput(input = {}) {
  const externalId = normalizeExternalId(input.externalId || input.ticketId || input.id || input.workItemId);
  if (!externalId) throw new Error('externalId is required');
  const title = String(input.title || externalId).trim();
  const sourceType = String(input.source?.type || input.sourceType || inferSourceType(input) || DEFAULT_SOURCE_TYPE).trim().toLowerCase();
  const sourceUrl = String(input.source?.url || input.sourceUrl || '').trim();
  const ticketOnlyInput = Boolean(input.ticketId && !input.externalId && !input.workItemId && !input.id);
  const workItemId = normalizeWorkItemId(input.workItemId || input.id || (ticketOnlyInput ? externalId : `${sourceType}-${externalId}`));
  const slug = slugify(title === externalId ? 'work-item' : title) || 'work-item';
  return {
    workItemId,
    externalId,
    ticketId: externalId,
    title,
    slug,
    source: {
      type: sourceType,
      externalId,
      url: sourceUrl
    }
  };
}

export function deriveWorkItemPaths({ item, repo, roots = {}, patterns = {} }) {
  const values = {
    workItemId: item.workItemId,
    externalId: item.externalId,
    ticketId: item.externalId,
    slug: item.slug,
    sourceType: item.source.type
  };
  const branchPattern = repo.branchPattern || patterns.branchPattern || 'agent/{workItemId}-{slug}';
  const featureFilePattern = patterns.featureFilePattern || repo.featureFilePattern || path.join(roots.workItemsRoot, '{workItemId}-{slug}.md');
  return {
    branch: renderPattern(branchPattern, values),
    worktreePath: path.join(roots.worktreeRoot, repo.repo, item.workItemId),
    featureFilePath: renderPattern(featureFilePattern, values),
    artifactDir: path.join(roots.artifactRoot, item.workItemId)
  };
}

export function normalizeExternalId(value) {
  return String(value || '').trim();
}

export function normalizeWorkItemId(value) {
  const base = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  if (!base) throw new Error('workItemId is required');
  return base;
}

function inferSourceType(input) {
  if (input.githubUrl) return 'github';
  return '';
}
