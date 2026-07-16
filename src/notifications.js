import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
const NOTIFIABLE_STATES = new Set([
  'INTAKE_RUNNING',
  'PLAN_READY',
  'NEEDS_REFINEMENT',
  'NEEDS_SPLIT',
  'SPLIT_PLAN_READY',
  'IMPLEMENTING',
  'AI_REVIEW_RUNNING',
  'REVIEW_READY',
  'FIXING_REVIEW',
  'WAITING_FOR_DEPENDENCY',
  'WAITING_FOR_SIBLINGS',
  'INTEGRATION_READY',
  'INTEGRATION_REQUIRED',
  'CONTEXT_REFRESH_REQUIRED',
  'MANUAL',
  'MANUAL_DONE',
  'DONE',
  'BLOCKED',
  'FAILED',
  'INTERRUPTED',
  'CANCELED'
]);

const STATUS_MESSAGES = {
  INTAKE_RUNNING: 'Reading source context and preparing the implementation plan.',
  PLAN_READY: 'Plan is ready for your review.',
  NEEDS_REFINEMENT: 'The plan needs more detail before implementation.',
  NEEDS_SPLIT: 'Large context detected. A split plan is recommended.',
  SPLIT_PLAN_READY: 'Split plan is ready for approval.',
  IMPLEMENTING: 'Implementation has started.',
  AI_REVIEW_RUNNING: 'Implementation finished. AI review is running.',
  REVIEW_READY: 'Code and AI review are ready for human review.',
  FIXING_REVIEW: 'Review fixes are in progress.',
  WAITING_FOR_DEPENDENCY: 'Waiting for a dependency to complete.',
  WAITING_FOR_SIBLINGS: 'Local work is ready and waiting for sibling tasks.',
  INTEGRATION_READY: 'All child work is ready for integration review.',
  INTEGRATION_REQUIRED: 'Integration review found issues that need attention.',
  CONTEXT_REFRESH_REQUIRED: 'Context must be refreshed before work continues.',
  MANUAL: 'The issue is ready for manual takeover.',
  MANUAL_DONE: 'Manual work is complete and ready for review.',
  DONE: 'The issue workflow is complete.',
  BLOCKED: 'The agent is blocked and needs attention.',
  FAILED: 'The agent failed. Open Agent Hub for details.',
  INTERRUPTED: 'The agent process was interrupted.',
  CANCELED: 'The issue workflow was stopped.'
};

export function shouldNotifyStatusChange(previousStatus, nextStatus, options = {}) {
  if (!nextStatus || previousStatus === nextStatus) return false;
  if (options.enabled === false || process.env.AGENT_HUB_NOTIFICATIONS === 'false') return false;
  return NOTIFIABLE_STATES.has(nextStatus);
}

export function createNotification(issue) {
  const status = issue.status || 'UPDATED';
  const statusLabel = status.toLowerCase().replaceAll('_', ' ');
  return {
    title: `${issue.ticketId} · ${statusLabel}`,
    subtitle: issue.title && issue.title !== issue.ticketId ? issue.title : 'Agent Hub',
    message: STATUS_MESSAGES[status] || 'Issue status changed.'
  };
}

export async function notifyIssueStatusChange(previousStatus, issue, options = {}) {
  if (!shouldNotifyStatusChange(previousStatus, issue.status, options)) return false;
  if (process.platform !== 'darwin') return false;

  const notification = createNotification(issue);
  const notifier = await resolveNotifierPath(options.notifier);
  if (notifier) {
    dispatch(notifier, [
      '-title', notification.title,
      '-subtitle', notification.subtitle,
      '-message', notification.message,
      '-group', `agent-hub-${issue.ticketId}`
    ]);
    return true;
  }

  const script = [
    'on run argv',
    'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)',
    'end run'
  ].join('\n');

  dispatch('osascript', [
    '-e', script,
    '--',
    notification.message,
    notification.title,
    notification.subtitle
  ]);
  return true;
}

async function resolveNotifierPath(preferredPath) {
  const candidates = [
    preferredPath,
    process.env.TERMINAL_NOTIFIER_PATH,
    '/opt/homebrew/bin/terminal-notifier',
    '/usr/local/bin/terminal-notifier'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return '';
}

function dispatch(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore'
  });
  child.once('error', () => {});
  child.unref();
}
