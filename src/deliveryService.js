import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readIssue, writeIssue } from './stateStore.js';

const defaultExec = promisify(execFile);

export async function commitFeature(ticketId, { message, stateRoot, exec = defaultExec } = {}) {
  const issue = await requireApprovedIssue(ticketId, stateRoot);
  if (issue.commitSha) return issue;
  const label = issue.externalId || issue.workItemId || issue.ticketId;
  const commitMessage = String(message || `${label}: agent implementation`).trim();
  if (!commitMessage.startsWith(`${label}:`)) throw deliveryError(`Commit message must start with "${label}:".`, 'COMMIT_MESSAGE_INVALID', 422);
  const { stdout: status = '' } = await exec('git', ['status', '--porcelain'], { cwd: issue.worktreePath });
  if (status.trim()) await exec('git', ['add', '-A'], { cwd: issue.worktreePath });
  const staged = await exec('git', ['diff', '--cached', '--quiet'], { cwd: issue.worktreePath }).then(() => false).catch((error) => error.code === 1 ? true : Promise.reject(error));
  if (staged) await exec('git', ['commit', '-m', commitMessage], { cwd: issue.worktreePath });
  const { stdout: sha = '' } = await exec('git', ['rev-parse', 'HEAD'], { cwd: issue.worktreePath });
  return writeIssue({ ...issue, commitSha: sha.trim(), commitMessage, committedAt: new Date().toISOString(), history: append(issue, 'FEATURE_COMMITTED') }, stateRoot);
}

export async function pushFeature(ticketId, { stateRoot, exec = defaultExec } = {}) {
  const issue = await requireApprovedIssue(ticketId, stateRoot);
  if (!issue.commitSha) throw deliveryError('Commit the feature before pushing.', 'FEATURE_NOT_COMMITTED', 409);
  if (issue.pushedCommitSha === issue.commitSha) return issue;
  const { stdout = '', stderr = '' } = await exec('git', ['push', '-u', 'origin', issue.branch], { cwd: issue.worktreePath });
  return writeIssue({ ...issue, pushedAt: new Date().toISOString(), pushedCommitSha: issue.commitSha, pushResult: `${stdout}${stderr}`.trim(), history: append(issue, 'FEATURE_PUSHED') }, stateRoot);
}

export async function createDraftPullRequest(ticketId, { title, body, stateRoot, exec = defaultExec } = {}) {
  const issue = await requireApprovedIssue(ticketId, stateRoot);
  if (!issue.pushedAt) throw deliveryError('Push the feature branch before creating a PR.', 'FEATURE_NOT_PUSHED', 409);
  if (issue.pullRequest?.url) return issue;
  const existing = await exec('gh', ['pr', 'view', issue.branch, '--json', 'number,url,isDraft,state'], { cwd: issue.worktreePath })
    .then(({ stdout }) => JSON.parse(stdout)).catch(() => null);
  const pullRequest = existing || await exec('gh', [
    'pr', 'create', '--draft', '--base', issue.baseBranch || 'master', '--head', issue.branch,
    '--title', String(title || `${issue.externalId || issue.workItemId || issue.ticketId}: ${issue.title}`),
    '--body', String(body || renderPullRequestBody(issue))
  ], { cwd: issue.worktreePath }).then(({ stdout }) => ({ url: stdout.trim(), isDraft: true, state: 'OPEN' }));
  return writeIssue({ ...issue, pullRequest, pullRequestCreatedAt: new Date().toISOString(), history: append(issue, 'DRAFT_PR_CREATED') }, stateRoot);
}

export async function waitForPullRequestChecks(ticketId, { timeoutMs = 30 * 60 * 1000, intervalMs = 10_000, stateRoot, exec = defaultExec } = {}) {
  let issue = await requireApprovedIssue(ticketId, stateRoot);
  if (!issue.pullRequest?.url) throw deliveryError('Create the pull request before waiting for CI.', 'PULL_REQUEST_MISSING', 409);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { stdout = '[]' } = await exec('gh', ['pr', 'checks', issue.pullRequest.url, '--json', 'name,state,bucket,link'], { cwd: issue.worktreePath });
    const checks = JSON.parse(stdout || '[]');
    if (checks.some((check) => ['fail', 'cancel'].includes(check.bucket))) throw deliveryError('Pull request checks failed.', 'CI_CHECKS_FAILED', 409, checks);
    if (checks.length && checks.every((check) => ['pass', 'skipping'].includes(check.bucket))) {
      issue = await writeIssue({ ...issue, ciStatus: 'PASSED', ciChecks: checks, ciCompletedAt: new Date().toISOString(), history: append(issue, 'CI_PASSED') }, stateRoot);
      return issue;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw deliveryError('Timed out waiting for pull request checks.', 'CI_CHECKS_TIMEOUT', 408);
}

async function requireApprovedIssue(ticketId, stateRoot) {
  const issue = await readIssue(ticketId, stateRoot);
  if (issue.status !== 'DONE') throw deliveryError(`Feature must be approved before delivery; current status is ${issue.status}.`, 'FEATURE_NOT_APPROVED', 409);
  return issue;
}

function renderPullRequestBody(issue) {
  return [`## Summary`, `Automated delivery for ${issue.externalId || issue.workItemId || issue.ticketId}.`, '', '## Validation', issue.reviewResultPath ? `AI review: ${issue.reviewResultPath}` : 'Review completed in Agent Hub.'].join('\n');
}
function append(issue, status) { return [...(issue.history || []), { status, at: new Date().toISOString() }]; }
function deliveryError(message, code, status, details = []) { const error = new Error(message); error.code = code; error.status = status; error.details = details; return error; }
