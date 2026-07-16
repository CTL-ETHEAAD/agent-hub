import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { notifyIssueStatusChange } from './notifications.js';

export const HUB_ROOT = path.resolve(import.meta.dirname, '..');
export const STATE_ROOT = path.join(HUB_ROOT, 'state');
export const WORK_ITEMS_ROOT = path.join(STATE_ROOT, 'work-items');
export const ISSUES_ROOT = WORK_ITEMS_ROOT;
const STUCK_IDLE_MS = 5 * 60 * 1000;
const LONG_TEST_IDLE_MS = 2 * 60 * 1000;
const writeQueues = new Map();

export async function ensureStateRoot(root = ISSUES_ROOT) {
  await mkdir(root, { recursive: true });
}

export function issueStatePath(ticketId, root = ISSUES_ROOT) {
  return path.join(root, `${normalizeStateId(ticketId)}.json`);
}

export async function readIssue(ticketId, root = ISSUES_ROOT) {
  const content = await readFile(issueStatePath(ticketId, root), 'utf8');
  return withProgress(JSON.parse(content));
}

export async function listIssues(root = ISSUES_ROOT) {
  await ensureStateRoot(root);
  const names = await readdir(root);
  const raw = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => withProgress(JSON.parse(await readFile(path.join(root, name), 'utf8'))))
  );
  const sorted = raw.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return injectSplitProgress(sorted);
}

function injectSplitProgress(issues) {
  const statusMap = new Map(issues.map((i) => [i.ticketId, i.status]));
  const completedStatuses = new Set(['REVIEW_READY', 'DONE', 'MANUAL_DONE']);
  return issues.map((issue) => {
    if (!issue.splitChildren?.length) return issue;
    const total = issue.splitChildren.length;
    const done = issue.splitChildren.filter((id) => completedStatuses.has(statusMap.get(id))).length;
    return { ...issue, splitProgress: { done, total } };
  });
}

export async function writeIssue(issue, root = ISSUES_ROOT) {
  const targetPath = issueStatePath(issue.ticketId, root);
  const previous = writeQueues.get(targetPath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    await ensureStateRoot(root);
    const previousIssue = await readFile(targetPath, 'utf8')
      .then((content) => JSON.parse(content))
      .catch(() => null);
    const now = new Date().toISOString();
    const next = {
      ...issue,
      updatedAt: now,
      createdAt: issue.createdAt || now
    };
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`);
    await rename(tempPath, targetPath);
    if (root === ISSUES_ROOT) {
      await notifyIssueStatusChange(previousIssue?.status, next).catch((error) => {
        console.warn(`macOS notification failed: ${error.message}`);
      });
    }
    return next;
  });
  writeQueues.set(targetPath, operation);
  try {
    return await operation;
  } finally {
    if (writeQueues.get(targetPath) === operation) {
      writeQueues.delete(targetPath);
    }
  }
}

export async function deleteIssue(ticketId, root = ISSUES_ROOT) {
  await unlink(issueStatePath(ticketId, root));
}

export const workItemStatePath = issueStatePath;
export const readWorkItem = readIssue;
export const listWorkItems = listIssues;
export const writeWorkItem = writeIssue;
export const deleteWorkItem = deleteIssue;

function normalizeStateId(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function withProgress(issue) {
  if (!issue.activeAgent?.logPath) {
    return issue;
  }

  return {
    ...issue,
    progress: await deriveProgress(issue).catch(() => null)
  };
}

async function deriveProgress(issue) {
  const logPath = issue.activeAgent?.logPath;
  if (!logPath) {
    return null;
  }

  const content = await readFile(logPath, 'utf8').catch(() => '');
  const logInfo = await stat(logPath).catch(() => null);
  const lines = content.trim().split('\n').filter(Boolean).slice(-250);
  let toolCount = 0;
  let lastTool = '';
  let lastAction = '';
  let lastText = '';
  let lastResult = '';
  let currentStep = null;
  let guardrailEvent = null;
  let lastBashCommand = '';
  const timeline = [];

  const pushTimeline = (event) => {
    timeline.push({
      ...event,
      index: timeline.length + 1
    });
    if (timeline.length > 8) {
      timeline.shift();
    }
  };

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'result') {
      lastResult = entry.subtype || 'result';
      pushTimeline({ type: 'result', label: `Result: ${lastResult}` });
    }

    if (entry.type === 'guardrail') {
      const label = `Guardrail: ${entry.rule || entry.error || 'blocked'}`;
      guardrailEvent = { label, command: entry.command || '' };
      lastAction = entry.command ? `${label} (${entry.command})` : label;
      pushTimeline({ type: 'guardrail', label, detail: entry.command || '' });
    }

    const parts = entry.message?.content || [];
    for (const part of parts) {
      if (part.type === 'text' && part.text?.trim()) {
        lastText = compactText(part.text);
        lastAction = lastText;
        const marker = parseProgressMarker(part.text);
        if (marker) {
          currentStep = marker;
          lastAction = `Step ${marker.current}/${marker.total}: ${marker.label}`;
          pushTimeline({ type: 'progress', label: lastAction });
        }
      }

      if (part.type === 'tool_use') {
        toolCount += 1;
        lastTool = part.name || 'tool';
        if (part.name === 'Bash' && part.input?.command) {
          lastBashCommand = part.input.command;
        }
        lastAction = describeToolUse(part);
        pushTimeline({ type: 'tool', label: lastAction, tool: lastTool });
      }
    }
  }

  const lastLogAt = logInfo ? logInfo.mtime.toISOString() : '';
  const idleMs = logInfo ? Math.max(0, Date.now() - logInfo.mtimeMs) : 0;
  const stuck = detectStuck({ idleMs, timeline, guardrailEvent, lastBashCommand });

  return {
    phase: issue.activeAgent.kind,
    pid: issue.activeAgent.pid,
    logPath,
    toolCount,
    lastTool,
    lastAction: lastAction || lastResult || 'Agent started.',
    lastMessage: lastText,
    currentStep,
    stepPercent: currentStep ? Math.round((currentStep.current / currentStep.total) * 100) : null,
    timeline,
    stuck,
    lastLogAt,
    idleMs,
    idleLabel: formatDuration(idleMs),
    updatedAt: issue.updatedAt
  };
}

function detectStuck({ idleMs, timeline, guardrailEvent, lastBashCommand }) {
  const reasons = [];
  if (guardrailEvent) {
    reasons.push(`Guardrail triggered${guardrailEvent.command ? `: ${guardrailEvent.command}` : ''}`);
  }
  if (idleMs >= STUCK_IDLE_MS) {
    reasons.push(`No log update for ${formatDuration(idleMs)}`);
  }

  const lastTools = timeline.filter((item) => item.type === 'tool').slice(-3);
  if (lastTools.length === 3 && lastTools.every((item) => item.label === lastTools[0].label)) {
    reasons.push(`Repeated tool call: ${lastTools[0].label}`);
  }

  if (lastBashCommand && /\b(?:pnpm|npm|yarn|npx|jest)\b[^\n]*(?:test|jest)\b/i.test(lastBashCommand) && idleMs >= LONG_TEST_IDLE_MS) {
    reasons.push(`Test command running for ${formatDuration(idleMs)}: ${lastBashCommand}`);
  }

  return {
    isStuck: reasons.length > 0,
    reasons
  };
}

function parseProgressMarker(text) {
  const match = text.match(/PROGRESS:\s*step=(\d+)\/(\d+)\s+label=(?:"([^"]+)"|'([^']+)'|([^\n]+))/i);
  if (!match) {
    return null;
  }

  const current = Number(match[1]);
  const total = Number(match[2]);
  const label = (match[3] || match[4] || match[5] || '').trim();
  if (!Number.isFinite(current) || !Number.isFinite(total) || current <= 0 || total <= 0) {
    return null;
  }

  return {
    current,
    total,
    label
  };
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function compactText(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function describeToolUse(part) {
  const input = part.input || {};
  if (part.name === 'Read' && input.file_path) {
    return `Reading ${input.file_path}`;
  }
  if (part.name === 'Write' && input.file_path) {
    return `Writing ${input.file_path}`;
  }
  if (part.name === 'Edit' && input.file_path) {
    return `Editing ${input.file_path}`;
  }
  if ((part.name === 'Grep' || part.name === 'Glob') && (input.pattern || input.path)) {
    return `${part.name}: ${input.pattern || input.path}`;
  }
  if (part.name === 'Bash' && input.command) {
    return `Running ${input.command}`;
  }
  if (part.name?.startsWith('mcp__')) {
    return `Using ${part.name}`;
  }
  return `Using ${part.name || 'tool'}`;
}
