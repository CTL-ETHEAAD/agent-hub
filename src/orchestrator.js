import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isClaudeAvailable, runClaude } from './claudeRunner.js';
import { runReview } from './reviewClient.js';
import { renderPattern, resolveRepo, slugify } from './repos.js';
import { deleteIssue as deleteIssueFromStore, listIssues, readIssue, writeIssue } from './stateStore.js';
import { deriveWorkItemPaths, normalizeWorkItemInput } from './workItems/workItemNaming.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORKTREE_ROOT = path.join(WORKSPACE_ROOT, '.worktrees');
const WORK_ITEMS_ROOT = path.join(WORKSPACE_ROOT, 'work-items');
const FEATURES_ROOT = WORK_ITEMS_ROOT;
const LOG_ROOT = path.join(WORKSPACE_ROOT, 'agent-hub/state/logs');
const ARTIFACT_ROOT = path.join(WORKSPACE_ROOT, 'agent-hub/state/artifacts');
const TEMPLATE_ROOT = path.join(WORKSPACE_ROOT, 'agent-hub/templates');

export const STATES = Object.freeze({
  ADDED: 'ADDED',
  INTAKE_RUNNING: 'INTAKE_RUNNING',
  PLAN_READY: 'PLAN_READY',
  IMPLEMENTING: 'IMPLEMENTING',
  IMPLEMENTED: 'IMPLEMENTED',
  AI_REVIEW_RUNNING: 'AI_REVIEW_RUNNING',
  REVIEW_READY: 'REVIEW_READY',
  FIXING_REVIEW: 'FIXING_REVIEW',
  NEEDS_REFINEMENT: 'NEEDS_REFINEMENT',
  NEEDS_SPLIT: 'NEEDS_SPLIT',
  SPLIT_PLAN_READY: 'SPLIT_PLAN_READY',
  SPLIT_APPROVED: 'SPLIT_APPROVED',
  SPLIT_EXECUTED: 'SPLIT_EXECUTED',
  CONTEXT_REFRESH_REQUIRED: 'CONTEXT_REFRESH_REQUIRED',
  RESUMING: 'RESUMING',
  MANUAL: 'MANUAL',
  MANUAL_DONE: 'MANUAL_DONE',
  INTEGRATION_READY: 'INTEGRATION_READY',
  INTEGRATION_REQUIRED: 'INTEGRATION_REQUIRED',
  WAITING_FOR_DEPENDENCY: 'WAITING_FOR_DEPENDENCY',
  WAITING_FOR_SIBLINGS: 'WAITING_FOR_SIBLINGS',
  DONE: 'DONE',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  INTERRUPTED: 'INTERRUPTED',
  CANCELED: 'CANCELED'
});

export function buttonsForState(status) {
  return {
    review: [STATES.PLAN_READY, STATES.MANUAL_DONE, STATES.INTEGRATION_READY].includes(status),
    proceed: status === STATES.PLAN_READY,
    loop: [STATES.PLAN_READY, STATES.FIXING_REVIEW, STATES.INTEGRATION_REQUIRED].includes(status),
    approveSplit: status === STATES.SPLIT_PLAN_READY,
    executeSplit: status === STATES.SPLIT_APPROVED,
    codeReviewResult: [STATES.REVIEW_READY, STATES.FIXING_REVIEW, STATES.WAITING_FOR_SIBLINGS, STATES.INTEGRATION_REQUIRED, STATES.DONE].includes(status),
    viewDiff: [STATES.IMPLEMENTED, STATES.AI_REVIEW_RUNNING, STATES.REVIEW_READY, STATES.FIXING_REVIEW, STATES.WAITING_FOR_SIBLINGS, STATES.MANUAL, STATES.MANUAL_DONE, STATES.INTEGRATION_READY, STATES.INTEGRATION_REQUIRED, STATES.DONE, STATES.CONTEXT_REFRESH_REQUIRED].includes(status),
    fixReviewComment: [STATES.FIXING_REVIEW, STATES.INTEGRATION_REQUIRED].includes(status),
    requestFix: status === STATES.REVIEW_READY,
    approve: status === STATES.REVIEW_READY,
    pushBranch: status === STATES.DONE,
    retry: [STATES.FAILED, STATES.BLOCKED, STATES.INTERRUPTED].includes(status),
    splitIssue: [STATES.NEEDS_SPLIT, STATES.PLAN_READY].includes(status),
    runWorkflow: status === STATES.SPLIT_EXECUTED,
    refreshContext: [STATES.PLAN_READY, STATES.NEEDS_REFINEMENT, STATES.NEEDS_SPLIT, STATES.SPLIT_PLAN_READY, STATES.CONTEXT_REFRESH_REQUIRED, STATES.FIXING_REVIEW, STATES.WAITING_FOR_DEPENDENCY, STATES.WAITING_FOR_SIBLINGS].includes(status),
    regeneratePlan: [STATES.NEEDS_REFINEMENT, STATES.NEEDS_SPLIT, STATES.SPLIT_PLAN_READY, STATES.CONTEXT_REFRESH_REQUIRED].includes(status),
    resumeFromSummary: status === STATES.CONTEXT_REFRESH_REQUIRED,
    manualDone: status === STATES.MANUAL,
    blockedByDependency: status === STATES.WAITING_FOR_DEPENDENCY
  };
}

export async function addIssue(input, options = {}) {
  const item = normalizeWorkItemInput(input);
  const ticketId = item.externalId;
  const repo = await (options.resolveRepo || resolveRepo)(input.repo, item.externalId);
  const title = item.title;
  const paths = deriveWorkItemPaths({
    item,
    repo,
    roots: {
      workItemsRoot: options.workItemsRoot || WORK_ITEMS_ROOT,
      worktreeRoot: options.worktreeRoot || WORKTREE_ROOT,
      artifactRoot: options.artifactRoot || ARTIFACT_ROOT
    },
    patterns: {
      featureFilePattern: options.featureFilePattern
    }
  });

  return writeIssue(
    {
      id: item.workItemId,
      workItemId: item.workItemId,
      externalId: item.externalId,
      ticketId,
      repo: repo.repo,
      title,
      type: input.type || 'task',
      status: STATES.ADDED,
      parentTicketId: input.parentTicketId || input.parentWorkItemId || '',
      parentWorkItemId: input.parentWorkItemId || input.parentTicketId || '',
      source: item.source,
      sourceType: item.source.type,
      sourceUrl: item.source.url,
      confluencePageId: input.confluencePageId || '',
      figmaUrl: input.figmaUrl || '',
      branch: paths.branch,
      worktreePath: paths.worktreePath,
      featureFilePath: paths.featureFilePath,
      artifactDir: paths.artifactDir,
      projectPath: repo.projectPath || path.join(WORKSPACE_ROOT, repo.repo),
      baseBranch: repo.baseBranch || '',
      projectGuide: repo.projectGuide || '',
      repoProfile: repo.repoProfile || '',
      packageManager: repo.packageManager || '',
      testCommand: repo.testCommand || '',
      fullValidation: repo.fullValidation || '',
      repoSkills: repo.repoSkills || [],
      intakeModel: repo.intakeModel || '',
      reviewModel: repo.reviewModel || '',
      reviewMode: input.reviewMode || '',
      executionMode: input.executionMode || 'parallel',
      dependsOn: input.dependsOn || [],
      blocks: input.blocks || [],
      owns: input.owns || [],
      parallelGroup: input.parallelGroup || '',
      expectedCrossChildFindings: input.expectedCrossChildFindings || [],
      artifacts: createArtifactPaths(paths.artifactDir),
      contextHealth: createInitialContextHealth(input),
      logs: {},
      activeAgent: null,
      reviewResultPath: '',
      reviewComments: [],
      loop: null,
      lastError: '',
      history: [{ status: STATES.ADDED, at: new Date().toISOString() }],
      buttons: buttonsForState(STATES.ADDED)
    },
    options.stateRoot
  );
}

export async function startIntake(ticketId, options = {}) {
  const issue = await transition(ticketId, STATES.INTAKE_RUNNING, options);
  if (options.dryRun) {
    return completeIntake(ticketId, options);
  }

  const available = await isClaudeAvailable(options.claudeCommand);
  if (!available) {
    return failIssue(ticketId, 'Claude Code CLI is not available. Fix the native binary install, then retry.', options);
  }

  const preparedIssue = await ensureWorktree(issue, options);
  const logPath = path.join(options.logRoot || LOG_ROOT, `${issue.ticketId}-intake.jsonl`);
  const runId = randomUUID();
  const runner = await runClaude({
    cwd: preparedIssue.worktreePath,
    logPath,
    command: options.claudeCommand,
    model: preparedIssue.intakeModel || undefined,
    additionalDirs: buildAdditionalDirs(preparedIssue),
    prompt: buildIntakePrompt(preparedIssue)
  });

  await writeIssue(
    {
      ...preparedIssue,
      status: STATES.INTAKE_RUNNING,
      activeAgent: { pid: runner.pid, kind: 'intake', logPath, runId },
      logs: { ...(preparedIssue.logs || {}), intake: logPath },
      buttons: buttonsForState(STATES.INTAKE_RUNNING)
    },
    options.stateRoot
  );

  runner.done.then(async (result) => {
    if (!(await isCurrentRun(ticketId, runId, options))) {
      return;
    }
    if (result.code === 0) {
      await completeIntake(ticketId, options);
    } else if (isBlockedAgentResult(result)) {
      await blockIssue(ticketId, result.error || 'Intake agent was blocked by runner guardrails.', options, {
        blockType: result.blockType || 'guardrail'
      });
    } else {
      await failIssue(ticketId, result.error || `Intake agent exited with code ${result.code}`, options);
    }
  });

  return readIssue(ticketId, options.stateRoot);
}

export async function completeIntake(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  await mkdir(path.dirname(issue.featureFilePath), { recursive: true });

  if (options.dryRun) {
    await writeFile(issue.featureFilePath, renderRoadmap(issue));
  }

  const nextIssue = await updateArtifactsAndHealth(issue, options);
  const status = nextIssue.contextHealth.risk === 'Needs Split'
    ? STATES.NEEDS_SPLIT
    : nextIssue.contextHealth.qualityGate.passed
      ? STATES.PLAN_READY
      : STATES.NEEDS_REFINEMENT;

  const reviewed = await writeIssue(
    {
      ...nextIssue,
      status,
      activeAgent: null,
      buttons: buttonsForState(status),
      history: appendHistory(nextIssue, status)
    },
    options.stateRoot
  );
  await unlockSiblingWaiters(ticketId, options);
  await updateParentIntegrationStatus(ticketId, options);
  if (reviewed.parentTicketId) {
    await continueSplitWorkflow(reviewed.parentTicketId, options);
  }
  return reviewed;
}

export async function proceedIssue(ticketId, options = {}) {
  let currentIssue = await readIssue(ticketId, options.stateRoot);
  const dependencyGate = await getUnmetDependencies(currentIssue, options);
  if (dependencyGate.length) {
    return writeIssue(
      {
        ...currentIssue,
        status: STATES.WAITING_FOR_DEPENDENCY,
        lastError: `Blocked by unfinished dependency: ${dependencyGate.join(', ')}`,
        buttons: buttonsForState(STATES.WAITING_FOR_DEPENDENCY),
        history: appendHistory(currentIssue, STATES.WAITING_FOR_DEPENDENCY)
      },
      options.stateRoot
    );
  }

  const overlapGate = await getRunningOwnershipOverlap(currentIssue, options);
  if (overlapGate.length) {
    return writeIssue(
      {
        ...currentIssue,
        status: STATES.WAITING_FOR_DEPENDENCY,
        lastError: `Blocked by active sibling ownership overlap: ${overlapGate.join(', ')}`,
        buttons: buttonsForState(STATES.WAITING_FOR_DEPENDENCY),
        history: appendHistory(currentIssue, STATES.WAITING_FOR_DEPENDENCY)
      },
      options.stateRoot
    );
  }

  if ([STATES.NEEDS_REFINEMENT, STATES.NEEDS_SPLIT].includes(currentIssue.status) && !options.force) {
    return writeIssue(
      {
        ...currentIssue,
        lastError: 'Plan is gated by context health. Refresh context, regenerate the plan, split the issue, or force proceed from an explicit workflow.',
        buttons: buttonsForState(currentIssue.status)
      },
      options.stateRoot
    );
  }

  const isReviewFix = [STATES.REVIEW_READY, STATES.FIXING_REVIEW, STATES.INTEGRATION_REQUIRED].includes(currentIssue.status);

  if (isReviewFix && currentIssue.reviewComments?.some((comment) => comment.status === 'OPEN')) {
    currentIssue = await writeIssue({
      ...currentIssue,
      reviewComments: currentIssue.reviewComments.map((comment) => comment.status === 'OPEN'
        ? { ...comment, status: 'SENT', sentAt: new Date().toISOString() }
        : comment)
    }, options.stateRoot);
  }

  if (options.humanComment) {
    await writeIssue({ ...currentIssue, humanComment: options.humanComment }, options.stateRoot);
  }

  const dirtyGate = await getDirtyRerunGate(currentIssue, options);
  if (dirtyGate && !options.allowDirty) {
    return blockIssue(ticketId, dirtyGate.message, options, {
      blockType: 'dirty-worktree',
      worktreeStatus: dirtyGate.worktreeStatus
    });
  }

  const issue = await transition(ticketId, STATES.IMPLEMENTING, options);
  if (options.dryRun) {
    const implemented = await writeIssue(
      {
        ...issue,
        status: STATES.IMPLEMENTED,
        lastImplementationAt: new Date().toISOString(),
        buttons: buttonsForState(STATES.IMPLEMENTED),
        history: appendHistory(issue, STATES.IMPLEMENTED)
      },
      options.stateRoot
    );
    await unlockDependents(ticketId, options);
    return implemented;
  }

  const available = await isClaudeAvailable(options.claudeCommand);
  if (!available) {
    return failIssue(ticketId, 'Claude Code CLI is not available. Fix the native binary install, then retry.', options);
  }

  const preparedIssue = await ensureWorktree(issue, options);
  const baselineChangedFiles = await getChangedFiles(preparedIssue, options);
  const loopIteration = preparedIssue.loop?.enabled ? preparedIssue.loop.iteration : 0;
  const logSuffix = loopIteration ? `loop-${loopIteration}-implement` : 'implement';
  const logPath = path.join(options.logRoot || LOG_ROOT, `${issue.ticketId}-${logSuffix}.jsonl`);
  const runId = randomUUID();
  const runner = await runClaude({
    cwd: preparedIssue.worktreePath,
    logPath,
    command: options.claudeCommand,
    additionalDirs: buildAdditionalDirs(preparedIssue),
    prompt: isReviewFix
      ? buildFixReviewPrompt({ ...preparedIssue, reviewSourceStatus: currentIssue.status })
      : buildImplementationPrompt(preparedIssue)
  });

  await writeIssue(
    {
      ...preparedIssue,
      activeAgent: { pid: runner.pid, kind: 'implementation', logPath, runId, baselineChangedFiles, loopIteration },
      logs: { ...(preparedIssue.logs || {}), implementation: logPath },
      loop: recordLoopLog(preparedIssue.loop, loopIteration, 'implementation', logPath),
      buttons: buttonsForState(STATES.IMPLEMENTING)
    },
    options.stateRoot
  );

  runner.done.then(async (result) => {
    if (!(await isCurrentRun(ticketId, runId, options))) {
      return;
    }
    if (result.code === 0) {
      const latestIssue = await readIssue(ticketId, options.stateRoot);
      const ownershipViolation = await getOwnershipViolation(latestIssue, options);
      if (ownershipViolation) {
        await blockIssue(ticketId, ownershipViolation, options, { blockType: 'ownership' });
        return;
      }
      const implementedIssue = await transition(ticketId, STATES.IMPLEMENTED, options);
      const persistedImplementation = await writeIssue(
        {
          ...implementedIssue,
          lastImplementationAt: new Date().toISOString(),
          implementationBaselineChangedFiles: latestIssue.activeAgent?.baselineChangedFiles || [],
          worktreeStatus: await getWorktreeStatus(implementedIssue)
        },
        options.stateRoot
      );
      await unlockDependents(ticketId, options);
      if (persistedImplementation.loop?.enabled) {
        const validation = await runLoopValidation(persistedImplementation, options);
        if (!validation.passed) {
          await handleLoopValidationFailure(persistedImplementation, validation, options);
          return;
        }
      }
      await startAiReview(ticketId, options);
    } else if (isBlockedAgentResult(result)) {
      await blockIssue(ticketId, result.error || 'Implementation agent was blocked by runner guardrails.', options, {
        blockType: result.blockType || 'guardrail'
      });
    } else {
      await failIssue(ticketId, result.error || `Implementation agent exited with code ${result.code}`, options);
    }
  });

  return readIssue(ticketId, options.stateRoot);
}

export async function startAiReview(ticketId, options = {}) {
  const issue = await transition(ticketId, STATES.AI_REVIEW_RUNNING, options);
  const loopIteration = issue.loop?.enabled ? issue.loop.iteration : 0;
  const reviewSuffix = loopIteration ? `loop-${loopIteration}-review` : 'review';
  const reviewResultPath = path.join(options.logRoot || LOG_ROOT, `${issue.ticketId}-${reviewSuffix}.md`);
  await mkdir(path.dirname(reviewResultPath), { recursive: true });

  if (options.dryRun) {
    const dryReview = options.reviewFindings
      ? 'HIGH: dry-run finding\n'
      : options.reviewDependencyFindings
        ? 'DEPENDENCY: dry-run sibling work is pending\n'
        : 'No blocking findings.\n';
    await writeFile(reviewResultPath, dryReview);
    return completeAiReview(ticketId, { ...options, reviewResultPath });
  }

  const available = await isClaudeAvailable(options.claudeCommand);
  if (!available) {
    return failIssue(ticketId, 'Claude Code CLI is not available. Fix the native binary install, then retry.', options);
  }

  const runId = randomUUID();
  const { pid, done } = await runReview({
    issue,
    reviewResultPath,
    model: issue.reviewModel,
    command: options.claudeCommand
  });
  await writeIssue(
    {
      ...issue,
      reviewResultPath,
      activeAgent: { pid, kind: 'review', runId, loopIteration },
      logs: { ...(issue.logs || {}), review: reviewResultPath },
      loop: recordLoopLog(issue.loop, loopIteration, 'review', reviewResultPath),
      buttons: buttonsForState(STATES.AI_REVIEW_RUNNING)
    },
    options.stateRoot
  );

  done.then(async (result) => {
    if (!(await isCurrentRun(ticketId, runId, options))) return;
    if (result.code === 0) {
      await completeAiReview(ticketId, { ...options, reviewResultPath });
    } else {
      await failIssue(ticketId, result.error || 'Review failed', options);
    }
  });

  return readIssue(ticketId, options.stateRoot);
}

export async function completeAiReview(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const reviewResultPath = options.reviewResultPath || issue.reviewResultPath;
  const reviewText = reviewResultPath ? await readFile(reviewResultPath, 'utf8').catch(() => '') : '';
  const reviewRouting = classifyReviewResult(reviewText);
  const siblingGate = await getPendingSiblingBlocks(issue, options);
  const status = reviewRouting.hasBlockingFinding
    ? STATES.FIXING_REVIEW
    : reviewRouting.hasIntegrationFinding && issue.splitChildren?.length
      ? STATES.INTEGRATION_REQUIRED
    : reviewRouting.hasDependencyFinding && siblingGate.length
      ? STATES.WAITING_FOR_SIBLINGS
      : STATES.REVIEW_READY;
  const nextIssue = await updateArtifactsAndHealth({ ...issue, reviewResultPath }, options);

  let reviewed = await writeIssue(
    {
      ...nextIssue,
      status,
      activeAgent: null,
      reviewResultPath,
      reviewRouting: {
        ...reviewRouting,
        pendingSiblings: siblingGate
      },
      reviewComments: status === STATES.REVIEW_READY
        ? (nextIssue.reviewComments || []).map((comment) => comment.status === 'SENT'
          ? { ...comment, status: 'RESOLVED', resolvedAt: new Date().toISOString() }
          : comment)
        : nextIssue.reviewComments || [],
      lastError: status === STATES.WAITING_FOR_SIBLINGS
        ? `Review is locally clean, waiting for sibling work: ${siblingGate.join(', ')}`
        : status === STATES.INTEGRATION_REQUIRED
          ? 'Parent integration review found integration work that must be fixed before completion.'
        : '',
      buttons: buttonsForState(status),
      history: appendHistory(issue, status)
    },
    options.stateRoot
  );

  if (reviewed.loop?.enabled) {
    reviewed = await continueIssueLoop(reviewed, status, options);
  }
  await unlockSiblingWaiters(ticketId, options);
  await updateParentIntegrationStatus(ticketId, options);
  if (reviewed.parentTicketId) {
    await continueSplitWorkflow(reviewed.parentTicketId, options);
  }
  return reviewed;
}

export async function startIssueLoop(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (issue.activeAgent) {
    throw new Error(`Cannot start loop for ${ticketId}: an agent is already running.`);
  }
  if (![STATES.PLAN_READY, STATES.FIXING_REVIEW, STATES.INTEGRATION_REQUIRED].includes(issue.status)) {
    throw new Error(`Cannot start loop for ${ticketId} from status ${issue.status}.`);
  }

  const maxIterations = normalizeLoopLimit(options.maxIterations);
  const validationCommand = options.validationCommand || issue.fullValidation;
  if (!validationCommand) {
    throw new Error(`Cannot start loop for ${ticketId}: repo fullValidation is not configured.`);
  }
  const loop = {
    enabled: true,
    status: 'RUNNING',
    iteration: 0,
    maxIterations,
    startedAt: new Date().toISOString(),
    completedAt: '',
    stopReason: '',
    validationCommand,
    acceptanceCriteria: options.acceptanceCriteria?.trim() || 'The approved plan is implemented, deterministic validation passes, and AI review has no blocking findings.',
    runs: []
  };
  await writeIssue(
    {
      ...issue,
      loop,
      lastError: '',
      history: appendHistory(issue, 'LOOP_STARTED')
    },
    options.stateRoot
  );
  return startNextLoopIteration(ticketId, options);
}

async function startNextLoopIteration(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const iteration = (issue.loop?.iteration || 0) + 1;
  const loop = {
    ...issue.loop,
    enabled: true,
    status: 'RUNNING',
    iteration,
    stopReason: ''
  };
  await writeIssue(
    {
      ...issue,
      loop,
      history: appendHistory(issue, `LOOP_ITERATION_${iteration}`)
    },
    options.stateRoot
  );
  return proceedIssue(ticketId, { ...options, allowDirty: iteration > 1 || options.allowDirty, loopRun: true });
}

async function continueIssueLoop(issue, reviewStatus, options = {}) {
  if (reviewStatus === STATES.REVIEW_READY) {
    return finishIssueLoop(issue, 'COMPLETED', 'Review passed.', options);
  }
  if (![STATES.FIXING_REVIEW, STATES.INTEGRATION_REQUIRED].includes(reviewStatus)) {
    return finishIssueLoop(issue, 'WAITING', `Loop paused at ${reviewStatus}.`, options);
  }
  if (issue.loop.iteration >= issue.loop.maxIterations) {
    return finishIssueLoop(issue, 'LIMIT_REACHED', `Maximum ${issue.loop.maxIterations} iterations reached.`, options);
  }

  await writeIssue(
    {
      ...issue,
      loop: { ...issue.loop, status: 'CONTINUING' },
      history: appendHistory(issue, 'LOOP_CONTINUING')
    },
    options.stateRoot
  );
  return startNextLoopIteration(issue.ticketId, options);
}

async function finishIssueLoop(issue, status, stopReason, options = {}) {
  return writeIssue(
    {
      ...issue,
      loop: {
        ...issue.loop,
        enabled: false,
        status,
        completedAt: new Date().toISOString(),
        stopReason
      },
      lastError: status === 'LIMIT_REACHED' ? stopReason : issue.lastError,
      buttons: buttonsForState(issue.status),
      history: appendHistory(issue, `LOOP_${status}`)
    },
    options.stateRoot
  );
}

async function runLoopValidation(issue, options = {}) {
  const command = options.validationCommand || issue.loop?.validationCommand || issue.fullValidation;
  const iteration = issue.loop?.iteration || 0;
  const resultPath = path.join(options.logRoot || LOG_ROOT, `${issue.ticketId}-loop-${iteration}-validation.md`);
  if (!command) {
    const error = 'Loop requires a deterministic fullValidation command in the repo configuration.';
    await writeFile(resultPath, `# Validation failed\n\n${error}\n`);
    return { passed: false, command: '', resultPath, output: error };
  }

  let passed = true;
  let output = '';
  try {
    if (options.validationRunner) {
      const result = await options.validationRunner({ issue, command });
      passed = result.code === 0;
      output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    } else {
      const result = await execFileAsync('/bin/sh', ['-lc', command], {
        cwd: issue.worktreePath,
        timeout: options.validationTimeout || 20 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024
      });
      output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    }
  } catch (error) {
    passed = false;
    output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
  }

  await writeFile(resultPath, [
    `# Loop Validation: ${issue.ticketId}`,
    '',
    `Iteration: ${iteration}`,
    `Command: ${command}`,
    `Result: ${passed ? 'PASS' : 'FAIL'}`,
    '',
    '```text',
    output || '(no output)',
    '```',
    ''
  ].join('\n'));
  return { passed, command, resultPath, output };
}

async function handleLoopValidationFailure(issue, validation, options = {}) {
  const message = `HIGH: Deterministic validation failed in loop iteration ${issue.loop.iteration}. Read ${validation.resultPath} and fix the failures.`;
  const failed = await writeIssue(
    {
      ...issue,
      status: STATES.FIXING_REVIEW,
      activeAgent: null,
      reviewResultPath: validation.resultPath,
      logs: { ...(issue.logs || {}), validation: validation.resultPath },
      loop: recordLoopLog(issue.loop, issue.loop.iteration, 'validation', validation.resultPath),
      lastError: message,
      buttons: buttonsForState(STATES.FIXING_REVIEW),
      history: appendHistory(issue, 'LOOP_VALIDATION_FAILED')
    },
    options.stateRoot
  );
  return continueIssueLoop(failed, STATES.FIXING_REVIEW, options);
}

export async function refreshContext(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const nextIssue = await updateArtifactsAndHealth(
    {
      ...issue,
      contextHealth: {
        ...issue.contextHealth,
        lastCompactSummaryAt: new Date().toISOString()
      }
    },
    options
  );
  const status = nextIssue.status === STATES.CONTEXT_REFRESH_REQUIRED ? STATES.PLAN_READY : nextIssue.status;

  return writeIssue(
    {
      ...nextIssue,
      status,
      buttons: buttonsForState(status),
      history: appendHistory(nextIssue, 'CONTEXT_REFRESHED')
    },
    options.stateRoot
  );
}

export async function addReviewComment(ticketId, input, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (!isReviewableStatus(issue.status)) {
    throw new Error(`Cannot add review comments from status ${issue.status}.`);
  }
  const file = String(input.file || '').trim();
  const line = Number(input.line);
  const body = String(input.body || '').trim();
  if (!file || !Number.isInteger(line) || line < 1 || !body) {
    throw new Error('Review comment requires file, positive line, and body.');
  }
  const changedFiles = await getChangedFiles(issue, options);
  if (!changedFiles.includes(file)) {
    throw new Error(`Review comment file is not part of the issue diff: ${file}`);
  }
  return writeIssue({
    ...issue,
    reviewComments: [
      ...(issue.reviewComments || []),
      {
        id: randomUUID(),
        file,
        line,
        body,
        status: 'OPEN',
        createdAt: new Date().toISOString()
      }
    ],
    history: appendHistory(issue, 'REVIEW_COMMENT_ADDED')
  }, options.stateRoot);
}

export async function deleteReviewComment(ticketId, commentId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const comments = issue.reviewComments || [];
  if (!comments.some((comment) => comment.id === commentId)) {
    throw new Error(`Review comment not found: ${commentId}`);
  }
  return writeIssue({
    ...issue,
    reviewComments: comments.filter((comment) => comment.id !== commentId),
    history: appendHistory(issue, 'REVIEW_COMMENT_DELETED')
  }, options.stateRoot);
}

export async function splitIssue(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  await ensureArtifacts(issue);
  const roadmapText = await readFile(issue.featureFilePath, 'utf8').catch(() => '');
  const content = renderSplitSuggestion(issue, roadmapText);
  await writeFile(issue.artifacts.splitSuggestion, content);
  const contextHealth = {
    ...issue.contextHealth,
    risk: 'Needs Split',
    riskReasons: Array.from(new Set([...(issue.contextHealth?.riskReasons || []), 'Split suggestion generated'])),
    splitSuggestionPath: issue.artifacts.splitSuggestion
  };

  return writeIssue(
    {
      ...issue,
      status: STATES.SPLIT_PLAN_READY,
      contextHealth,
      buttons: buttonsForState(STATES.SPLIT_PLAN_READY),
      history: appendHistory(issue, STATES.SPLIT_PLAN_READY)
    },
    options.stateRoot
  );
}

export async function approveSplitPlan(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const splitSuggestionPath = issue.contextHealth?.splitSuggestionPath || issue.artifacts?.splitSuggestion;
  const hasSplitPlan = splitSuggestionPath && await stat(splitSuggestionPath).then(() => true).catch(() => false);
  if (!hasSplitPlan) {
    return failIssue(ticketId, 'Split plan has not been generated yet.', options);
  }

  return writeIssue(
    {
      ...issue,
      contextHealth: {
        ...issue.contextHealth,
        splitSuggestionPath
      },
      status: STATES.SPLIT_APPROVED,
      buttons: buttonsForState(STATES.SPLIT_APPROVED),
      history: appendHistory(issue, STATES.SPLIT_APPROVED)
    },
    options.stateRoot
  );
}

export async function executeSplitPlan(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (![STATES.SPLIT_APPROVED, STATES.SPLIT_EXECUTED].includes(issue.status)) {
    return writeIssue(
      {
        ...issue,
        lastError: 'Approve the split plan before executing it.',
        buttons: buttonsForState(issue.status)
      },
      options.stateRoot
    );
  }

  await ensureArtifacts(issue);
  const splitText = await readFile(issue.artifacts.splitSuggestion, 'utf8').catch(() => '');
  const subtasks = parseSplitSubtasks(splitText, issue.ticketId);
  const created = [];

  // Pre-resolve all child ticket IDs so we can build the blocks map before writing any child.
  const resolvedSubtasks = subtasks.map((subtask, index) => ({
    ...subtask,
    childTicketId: normalizeTicketId(subtask.ticketId || `${issue.ticketId}-${index + 1}`)
  }));

  const existingChildren = [];
  for (const subtask of resolvedSubtasks) {
    const existing = await readIssue(subtask.childTicketId, options.stateRoot).catch(() => null);
    if (existing) {
      existingChildren.push(subtask.childTicketId);
    }
  }

  if (existingChildren.length && !options.resetExisting) {
    return writeIssue(
      {
        ...issue,
        status: issue.status,
        lastError: `Split execution refused because child issue cards already exist: ${existingChildren.join(', ')}. Delete/archive them or explicitly reset before re-executing the split plan.`,
        buttons: buttonsForState(issue.status),
        history: appendHistory(issue, 'SPLIT_EXECUTE_REFUSED_EXISTING_CHILDREN')
      },
      options.stateRoot
    );
  }

  const suggestedExecutionMode = issue.contextHealth?.suggestedExecutionMode || 'parallel';
  const ownershipIssues = validateSplitOwnership(resolvedSubtasks);
  if (ownershipIssues.length) {
    return writeIssue(
      {
        ...issue,
        status: STATES.SPLIT_PLAN_READY,
        lastError: `Split plan needs ownership refinement: ${ownershipIssues.join('; ')}`,
        buttons: buttonsForState(STATES.SPLIT_PLAN_READY),
        history: appendHistory(issue, STATES.NEEDS_REFINEMENT)
      },
      options.stateRoot
    );
  }

  const blocksMap = new Map(resolvedSubtasks.map(({ childTicketId, dependsOn: deps = [] }) => {
    const blockedBy = resolvedSubtasks
      .filter((other) => (other.dependsOn || []).map((d) => d.toUpperCase()).includes(childTicketId))
      .map((other) => other.childTicketId);
    return [childTicketId, blockedBy];
  }));

  for (const [index, subtask] of resolvedSubtasks.entries()) {
    const { childTicketId } = subtask;
    const childSlug = slugify(subtask.title || `split-${index + 1}`);
    const childFeatureFilePath = renderPattern(
      path.join(FEATURES_ROOT, '{ticketId}-{slug}.md'),
      { ticketId: childTicketId, slug: childSlug }
    );
    const childArtifactDir = path.join(options.artifactRoot || ARTIFACT_ROOT, childTicketId);
    const dependsOn = (subtask.dependsOn || []).map((d) => d.toUpperCase());
    const childBlocks = blocksMap.get(childTicketId) || [];
    const executionMode = subtask.executionMode || suggestedExecutionMode;
    const reviewMode = subtask.reviewMode || (index === 0 ? 'local-only'
      : index === resolvedSubtasks.length - 1 ? 'parent-integration'
      : 'dependency-aware');
    const childStatus = dependsOn.length > 0 ? STATES.WAITING_FOR_DEPENDENCY : STATES.PLAN_READY;

    // Sequential children share the parent's worktree and branch — no new git worktree needed.
    const childWorktreePath = executionMode === 'sequential'
      ? issue.worktreePath
      : path.join(options.worktreeRoot || WORKTREE_ROOT, issue.repo, childTicketId);
    const childBranch = executionMode === 'sequential'
      ? issue.branch
      : renderPattern('agent/{workItemId}-{slug}', { workItemId: childTicketId, ticketId: childTicketId, slug: childSlug });

    await mkdir(path.dirname(childFeatureFilePath), { recursive: true });
    await writeFile(childFeatureFilePath, renderChildSplitRoadmap(issue, subtask, childTicketId, dependsOn, childBlocks, executionMode));

    created.push(childTicketId);
    await writeIssue(
      {
        ...issue,
        ticketId: childTicketId,
        parentTicketId: issue.ticketId,
        title: subtask.title || childTicketId,
        type: 'split-task',
        reviewMode,
        executionMode,
        dependsOn,
        blocks: childBlocks,
        owns: subtask.owns || [],
        parallelGroup: subtask.parallelGroup || '',
        expectedCrossChildFindings: subtask.expectedCrossChildFindings || [],
        status: childStatus,
        jiraUrl: issue.jiraUrl,
        branch: childBranch,
        worktreePath: childWorktreePath,
        featureFilePath: childFeatureFilePath,
        artifactDir: childArtifactDir,
        artifacts: createArtifactPaths(childArtifactDir),
        contextHealth: {
          ...createInitialContextHealth(issue),
          size: 'Low',
          risk: 'Context OK',
          sourcesLoaded: [issue.source?.type || issue.sourceType || 'Parent source', 'Parent split plan'],
          qualityGate: { passed: true, missing: [] }
        },
        logs: {},
        activeAgent: null,
        reviewResultPath: '',
        lastError: '',
        history: [{ status: childStatus, at: new Date().toISOString() }],
        buttons: buttonsForState(childStatus),
        createdAt: undefined,
        updatedAt: undefined
      },
      options.stateRoot
    );
  }

  await writeFile(issue.artifacts.finalSummary, `# Split Plan Executed: ${issue.ticketId}

Created child issue cards:
${created.map((id) => `- ${id}`).join('\n')}
`);

  return writeIssue(
    {
      ...issue,
      status: STATES.SPLIT_EXECUTED,
      splitChildren: created,
      workflowActive: false,
      workflowCurrentChild: '',
      activeAgent: null,
      buttons: buttonsForState(STATES.SPLIT_EXECUTED),
      history: appendHistory(issue, STATES.SPLIT_EXECUTED)
    },
    options.stateRoot
  );
}

export async function runSplitWorkflow(ticketId, options = {}) {
  const parent = await readIssue(ticketId, options.stateRoot);
  if (!parent.splitChildren?.length) {
    return writeIssue(
      {
        ...parent,
        lastError: 'Split workflow has no child issues. Execute the split plan first.',
        buttons: buttonsForState(parent.status)
      },
      options.stateRoot
    );
  }

  const activatedParent = await writeIssue(
    {
      ...parent,
      workflowActive: true,
      workflowStartedAt: parent.workflowStartedAt || new Date().toISOString(),
      lastError: '',
      buttons: buttonsForState(parent.status)
    },
    options.stateRoot
  );

  return continueSplitWorkflow(activatedParent.ticketId, options);
}

export async function markContextRefreshRequired(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  return writeIssue(
    {
      ...issue,
      status: STATES.CONTEXT_REFRESH_REQUIRED,
      buttons: buttonsForState(STATES.CONTEXT_REFRESH_REQUIRED),
      history: appendHistory(issue, STATES.CONTEXT_REFRESH_REQUIRED)
    },
    options.stateRoot
  );
}

export async function getArtifact(ticketId, artifactName, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const artifacts = ensureIssueArtifacts(issue).artifacts;
  const artifactPath = artifacts[artifactName];
  if (!artifactPath) {
    throw new Error(`Unknown artifact: ${artifactName}`);
  }

  return readFile(artifactPath, 'utf8').catch(() => `${artifactName} has not been written yet.`);
}

export async function getLog(ticketId, kind = 'intake', options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const logPath = issue.logs?.[kind] || issue.activeAgent?.logPath;
  if (!logPath) {
    return `${kind} log has not been written yet.`;
  }

  return readFile(logPath, 'utf8').catch(() => `${kind} log not found at ${logPath}.`);
}

export async function getTakeoverInfo(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const logKinds = Object.keys(issue.logs || {});
  const implementationLog = issue.logs?.implementation || issue.activeAgent?.logPath || '';
  const reviewLog = issue.logs?.review || issue.reviewResultPath || '';
  const commands = [
    `cd ${shellQuote(issue.worktreePath)}`,
    'claude',
    '',
    '# Useful board commands',
    `npm run hub -- show ${issue.ticketId}`,
    implementationLog ? `npm run hub -- logs ${issue.ticketId} implementation --follow` : '',
    reviewLog ? `npm run hub -- logs ${issue.ticketId} review` : ''
  ].filter(Boolean);

  return `# Take Over ${issue.ticketId}

Title: ${issue.title}
Status: ${issue.status}
Repo: ${issue.repo}
Branch: ${issue.branch}
Worktree: ${issue.worktreePath}
Feature file: ${issue.featureFilePath}
Active agent: ${issue.activeAgent ? `${issue.activeAgent.kind} pid ${issue.activeAgent.pid || 'unknown'}` : 'none'}
Logs: ${logKinds.length ? logKinds.join(', ') : 'none yet'}

Run:

\`\`\`bash
${commands.join('\n')}
\`\`\`

Suggested first prompt inside Claude:

\`\`\`text
Read ${issue.featureFilePath}, inspect the current git diff, and continue ${issue.ticketId} from the current worktree state.
\`\`\`
`;
}

export async function markIssueManual(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (issue.activeAgent?.pid) {
    try {
      process.kill(-issue.activeAgent.pid, 'SIGTERM');
    } catch {
      // Process group already gone; still mark the issue as manually owned.
    }
  }

  const manualIssue = await writeIssue(
    {
      ...issue,
      status: STATES.MANUAL,
      previousStatus: issue.status,
      activeAgent: null,
      loop: stopLoopState(issue.loop, 'TAKEN_OVER', 'Taken over manually.'),
      manualStartedAt: new Date().toISOString(),
      manualTakeoverCount: (issue.manualTakeoverCount || 0) + 1,
      lastError: '',
      buttons: buttonsForState(STATES.MANUAL),
      history: appendHistory(issue, STATES.MANUAL)
    },
    options.stateRoot
  );

  return {
    issue: manualIssue,
    takeoverInfo: await getTakeoverInfo(ticketId, options)
  };
}

export async function markIssueManualDone(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  return writeIssue(
    {
      ...issue,
      status: STATES.MANUAL_DONE,
      activeAgent: null,
      manualDoneAt: new Date().toISOString(),
      lastError: '',
      buttons: buttonsForState(STATES.MANUAL_DONE),
      history: appendHistory(issue, STATES.MANUAL_DONE)
    },
    options.stateRoot
  );
}

export async function deleteIssue(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (issue.activeAgent) {
    throw new Error(`Cannot delete ${ticketId}: agent is still running. Stop it first.`);
  }

  if (issue.splitChildren?.length) {
    const children = await listIssues(options.stateRoot);
    const activeChildren = children.filter(
      (child) => issue.splitChildren.includes(child.ticketId) && child.activeAgent
    );
    if (activeChildren.length) {
      throw new Error(`Cannot delete ${ticketId}: split child agent is still running: ${activeChildren.map((child) => child.ticketId).join(', ')}. Stop them first.`);
    }
    for (const childId of issue.splitChildren) {
      await deleteIssueFromStore(childId, options.stateRoot).catch(() => {});
    }
  }

  if (issue.parentTicketId) {
    const parent = await readIssue(issue.parentTicketId, options.stateRoot).catch(() => null);
    if (parent?.splitChildren?.includes(issue.ticketId)) {
      const splitChildren = parent.splitChildren.filter((id) => id !== issue.ticketId);
      await writeIssue(
        {
          ...parent,
          splitChildren,
          workflowActive: splitChildren.length ? parent.workflowActive : false,
          workflowCurrentChild: parent.workflowCurrentChild === issue.ticketId ? '' : parent.workflowCurrentChild,
          buttons: buttonsForState(parent.status)
        },
        options.stateRoot
      );
    }
  }

  await deleteIssueFromStore(ticketId, options.stateRoot);
}

export async function stopIssue(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (issue.activeAgent?.pid) {
    try {
      // Negative PID kills the entire process group (claude + all its subprocesses).
      process.kill(-issue.activeAgent.pid, 'SIGTERM');
    } catch {
      // Process group already gone — still clear the state
    }
  }

  return writeIssue(
    {
      ...issue,
      status: STATES.CANCELED,
      activeAgent: null,
      loop: stopLoopState(issue.loop, 'STOPPED', 'Stopped by user.'),
      stoppedAt: new Date().toISOString(),
      lastError: 'Stopped by user.',
      buttons: buttonsForState(STATES.CANCELED),
      history: appendHistory(issue, STATES.CANCELED)
    },
    options.stateRoot
  );
}

export async function cleanIssueWorktree(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (issue.activeAgent) {
    throw new Error(`Cannot clean ${ticketId}: agent is still running. Stop it first.`);
  }
  if (!options.force) {
    throw new Error(`Refusing to clean ${ticketId} without explicit confirmation.`);
  }
  if (issue.parentTicketId && issue.executionMode === 'sequential') {
    throw new Error(`Cannot clean ${ticketId}: this sequential child shares the parent worktree. Clean or recreate the parent workflow explicitly.`);
  }
  if (!issue.worktreePath) {
    throw new Error(`Cannot clean ${ticketId}: worktree path is missing.`);
  }
  if (path.resolve(issue.worktreePath) === path.resolve(issue.projectPath || '')) {
    throw new Error(`Cannot clean ${ticketId}: worktree path points at the main project checkout.`);
  }
  if (!isInsidePath(path.resolve(options.worktreeRoot || WORKTREE_ROOT), path.resolve(issue.worktreePath))) {
    throw new Error(`Cannot clean ${ticketId}: worktree is outside the managed worktree root.`);
  }

  const isWorktree = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: issue.worktreePath
  }).then(() => true).catch(() => false);

  if (!isWorktree) {
    throw new Error(`Cannot clean ${ticketId}: ${issue.worktreePath} is not a git worktree.`);
  }

  const { stdout: before } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: issue.worktreePath
  }).catch(() => ({ stdout: '' }));

  await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: issue.worktreePath });
  await execFileAsync('git', ['clean', '-fd'], { cwd: issue.worktreePath });

  const cleanedAt = new Date().toISOString();
  return writeIssue(
    {
      ...issue,
      cleanedAt,
      cleanResult: before.trim()
        ? `Cleaned worktree at ${cleanedAt}.\n\nRemoved local changes:\n${before.trim()}`
        : `Worktree was already clean at ${cleanedAt}.`,
      lastError: '',
      buttons: buttonsForState(issue.status),
      history: appendHistory(issue, 'WORKTREE_CLEANED')
    },
    options.stateRoot
  );
}

export async function approveIssue(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  if (issue.status !== STATES.REVIEW_READY) {
    throw new Error(`Cannot approve ${ticketId} from status ${issue.status}. Resolve review findings first.`);
  }

  if (issue.splitChildren?.length) {
    const hasReview = Boolean(issue.reviewResultPath && await stat(issue.reviewResultPath).then(() => true).catch(() => false));
    const reviewText = hasReview ? await readFile(issue.reviewResultPath, 'utf8').catch(() => '') : '';
    const reviewRouting = classifyReviewResult(reviewText);
    const allIssues = await listIssues(options.stateRoot);
    const statusMap = new Map(allIssues.map((candidate) => [candidate.ticketId.toUpperCase(), candidate.status]));
    const incompleteChildren = issue.splitChildren.filter(
      (childId) => !INTEGRATION_READY_CHILD_STATUSES.has(statusMap.get(childId.toUpperCase()))
    );
    const reviewBlocked = reviewRouting.hasBlockingFinding || reviewRouting.hasIntegrationFinding;
    if (!hasReview || !options.approvalNote?.trim() || incompleteChildren.length || reviewBlocked) {
      return writeIssue(
        {
          ...issue,
          lastError: [
            !hasReview ? 'Parent approval requires an AI review result.' : '',
            !options.approvalNote?.trim() ? 'Parent approval requires an approval note.' : '',
            incompleteChildren.length ? `Parent approval requires completed children: ${incompleteChildren.join(', ')}.` : '',
            reviewBlocked ? 'Parent approval requires a clean integration review.' : ''
          ].filter(Boolean).join('\n'),
          buttons: buttonsForState(issue.status)
        },
        options.stateRoot
      );
    }
  }

  const result = await writeIssue(
    {
      ...issue,
      status: STATES.DONE,
      approvalNote: options.approvalNote || issue.approvalNote || '',
      approvedAt: new Date().toISOString(),
      activeAgent: null,
      lastError: '',
      buttons: buttonsForState(STATES.DONE),
      history: appendHistory(issue, STATES.DONE)
    },
    options.stateRoot
  );
  await unlockSiblingWaiters(ticketId, options);
  await updateParentIntegrationStatus(ticketId, options);
  return result;
}

async function updateParentIntegrationStatus(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot).catch(() => null);
  if (!issue?.parentTicketId) return;

  const parent = await readIssue(issue.parentTicketId, options.stateRoot).catch(() => null);
  if (!parent?.splitChildren?.length || [STATES.DONE, STATES.INTEGRATION_READY, STATES.INTEGRATION_REQUIRED, STATES.AI_REVIEW_RUNNING, STATES.REVIEW_READY, STATES.FIXING_REVIEW].includes(parent.status)) return;

  const all = await listIssues(options.stateRoot);
  const statusMap = new Map(all.map((i) => [i.ticketId, i.status]));
  const allReady = parent.splitChildren.every((id) => INTEGRATION_READY_CHILD_STATUSES.has(statusMap.get(id.toUpperCase())));

  if (allReady) {
    await transition(parent.ticketId, STATES.INTEGRATION_READY, options);
  }
}

export async function retryIssue(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const phase = issue.failedPhase || inferFailedPhase(issue);
  const resetLoop = issue.loop?.enabled
    ? stopLoopState(issue.loop, 'RETRYING', 'Retry started outside the previous loop run.')
    : issue.loop;
  if (phase === 'review') {
    await writeIssue(
      {
        ...issue,
        status: STATES.IMPLEMENTED,
        loop: resetLoop,
        lastError: '',
        activeAgent: null,
        buttons: buttonsForState(STATES.IMPLEMENTED),
        history: appendHistory(issue, 'RETRY_REVIEW')
      },
      options.stateRoot
    );
    return startAiReview(ticketId, options);
  }
  if (phase === 'implementation') {
    const retryStatus = [STATES.FIXING_REVIEW, STATES.INTEGRATION_REQUIRED, STATES.REVIEW_READY].includes(issue.failedFromStatus)
      ? issue.failedFromStatus
      : STATES.PLAN_READY;
    await writeIssue(
      {
        ...issue,
        status: retryStatus,
        loop: resetLoop,
        lastError: '',
        activeAgent: null,
        buttons: buttonsForState(retryStatus),
        history: appendHistory(issue, 'RETRY_IMPLEMENTATION')
      },
      options.stateRoot
    );
    return proceedIssue(ticketId, options);
  }

  await writeIssue(
    {
      ...issue,
      status: STATES.ADDED,
      loop: resetLoop,
      lastError: '',
      activeAgent: null,
      buttons: buttonsForState(STATES.ADDED),
      history: appendHistory(issue, 'RETRY_INTAKE')
    },
    options.stateRoot
  );
  return startIntake(ticketId, options);
}

export async function reconcileStaleAgents(options = {}) {
  const issues = await listIssues(options.stateRoot);
  const interrupted = [];
  for (const issue of issues) {
    if (!issue.activeAgent) continue;
    const pid = issue.activeAgent.pid;
    const alive = pid ? isProcessAlive(pid) : false;
    if (alive) continue;
    const next = await writeIssue(
      {
        ...issue,
        status: STATES.INTERRUPTED,
        failedPhase: issue.activeAgent.kind,
        failedFromStatus: issue.status,
        activeAgent: null,
        loop: stopLoopState(issue.loop, 'INTERRUPTED', 'Agent process was not running when Agent Hub restarted.'),
        lastError: 'Agent process was interrupted. Retry the failed phase or take over manually.',
        buttons: buttonsForState(STATES.INTERRUPTED),
        history: appendHistory(issue, STATES.INTERRUPTED)
      },
      options.stateRoot
    );
    interrupted.push(next);
  }
  return interrupted;
}

export async function pushIssueBranch(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const cwd = issue.worktreePath;

  const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], { cwd })
    .catch(() => ({ stdout: '' }));

  if (statusOut.trim()) {
    await execFileAsync(
      'git', ['add', '-A'],
      { cwd }
    );
    await execFileAsync(
      'git', ['commit', '-m', `chore(${issue.ticketId}): agent implementation`],
      { cwd }
    );
  }

  const { stdout: pushOut, stderr: pushErr } = await execFileAsync(
    'git', ['push', '-u', 'origin', issue.branch],
    { cwd }
  );

  const pushResult = (pushOut + pushErr).trim() || `Branch ${issue.branch} pushed to origin.`;
  return writeIssue(
    { ...issue, pushedAt: new Date().toISOString(), pushResult },
    options.stateRoot
  );
}

export async function getDiff(ticketId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  const baseBranch = options.baseBranch || issue.baseBranch || 'master';
  try {
    const changedFiles = await getChangedFiles(issue, options);
    const requestedFile = options.file?.trim();
    if (requestedFile && !changedFiles.includes(requestedFile)) {
      throw new Error(`File is not part of the issue diff: ${requestedFile}`);
    }
    const files = requestedFile ? [requestedFile] : changedFiles;
    if (!files.length) return '(no diff)';
    const { stdout } = await execFileAsync('git', ['diff', baseBranch, '--', ...files], {
      cwd: issue.worktreePath,
      maxBuffer: 20 * 1024 * 1024
    });
    const trackedDiff = stdout || '';
    const untracked = await getUntrackedFiles(issue);
    const untrackedDiffs = await Promise.all(
      files.filter((file) => untracked.includes(file)).map((file) => renderUntrackedDiff(issue.worktreePath, file))
    );
    return [trackedDiff.trimEnd(), ...untrackedDiffs].filter(Boolean).join('\n') || '(no diff)';
  } catch (error) {
    return error.stderr || error.message;
  }
}

export async function getChangedFiles(issue, options = {}) {
  if (!issue?.worktreePath) {
    return [];
  }

  const baseBranch = options.baseBranch || issue.baseBranch || 'master';
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', baseBranch], {
    cwd: issue.worktreePath
  }).catch(() => ({ stdout: '' }));
  const untracked = await getUntrackedFiles(issue);
  return [...new Set([
    ...stdout.trim().split('\n').map((file) => file.trim()).filter(Boolean),
    ...untracked
  ])];
}

async function getUntrackedFiles(issue) {
  const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: issue.worktreePath
  }).catch(() => ({ stdout: '' }));
  return stdout.trim().split('\n').map((file) => file.trim()).filter(Boolean);
}

async function renderUntrackedDiff(worktreePath, file) {
  const content = await readFile(path.join(worktreePath, file), 'utf8').catch(() => '');
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return [
    `diff --git a/${file} b/${file}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join('\n');
}

async function getDirtyRerunGate(issue, options = {}) {
  if (!shouldCheckDirtyBeforeRun(issue)) {
    return null;
  }

  const worktreeStatus = await getWorktreeStatus(issue);
  if (!worktreeStatus.isGitWorktree || worktreeStatus.dirtyCount === 0) {
    return null;
  }

  return {
    worktreeStatus,
    message: [
      `Worktree has ${worktreeStatus.dirtyCount} uncommitted change${worktreeStatus.dirtyCount === 1 ? '' : 's'} before rerun.`,
      'Clean the worktree, take over manually, or retry with explicit dirty-worktree approval.',
      worktreeStatus.files.length ? `Dirty files: ${worktreeStatus.files.join(', ')}` : ''
    ].filter(Boolean).join('\n')
  };
}

function shouldCheckDirtyBeforeRun(issue) {
  return Boolean(
    issue.logs?.implementation ||
    issue.lastImplementationAt ||
    [STATES.FAILED, STATES.BLOCKED, STATES.FIXING_REVIEW, STATES.REVIEW_READY].includes(issue.status)
  );
}

async function getWorktreeStatus(issue) {
  if (!issue?.worktreePath) {
    return { isGitWorktree: false, dirtyCount: 0, files: [], checkedAt: new Date().toISOString() };
  }

  const isGitWorktree = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: issue.worktreePath
  }).then(() => true).catch(() => false);

  if (!isGitWorktree) {
    return { isGitWorktree: false, dirtyCount: 0, files: [], checkedAt: new Date().toISOString() };
  }

  const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: issue.worktreePath
  }).catch(() => ({ stdout: '' }));
  const files = stdout.trim().split('\n').filter(Boolean).map(parsePorcelainPath);

  return {
    isGitWorktree: true,
    dirtyCount: files.length,
    files,
    checkedAt: new Date().toISOString()
  };
}

function parsePorcelainPath(line) {
  const rawPath = line.slice(3).trim();
  const renameParts = rawPath.split(' -> ');
  return renameParts[renameParts.length - 1] || rawPath;
}

async function getOwnershipViolation(issue, options = {}) {
  if (!issue.parentTicketId || !issue.owns?.length) {
    return '';
  }

  const changedFiles = await getChangedFiles(issue, options);
  const baseline = new Set(issue.activeAgent?.baselineChangedFiles || []);
  const newOrChangedFiles = changedFiles.filter((file) => !baseline.has(file));
  const outsideOwnedFiles = newOrChangedFiles.filter((file) => !isOwnedPath(file, issue.owns));

  if (!outsideOwnedFiles.length) {
    return '';
  }

  return [
    'Implementation changed files outside this split child ownership.',
    `Owned files: ${issue.owns.join(', ')}`,
    `Outside-owned files: ${outsideOwnedFiles.join(', ')}`,
    'Refine the split plan, move ownership, or take over manually before retrying.'
  ].join('\n');
}

function isOwnedPath(file, ownedPaths = []) {
  return ownedPaths.some((ownedPath) => {
    const normalizedOwned = String(ownedPath).replace(/\/+$/, '');
    return file === normalizedOwned || file.startsWith(`${normalizedOwned}/`);
  });
}

const UNBLOCKING_STATUSES = new Set([
  STATES.IMPLEMENTED,
  STATES.AI_REVIEW_RUNNING,
  STATES.REVIEW_READY,
  STATES.FIXING_REVIEW,
  STATES.WAITING_FOR_SIBLINGS,
  STATES.DONE
]);

const COMPLETED_SIBLING_STATUSES = new Set([
  STATES.REVIEW_READY,
  STATES.DONE
]);

const INTEGRATION_READY_CHILD_STATUSES = new Set([
  STATES.REVIEW_READY,
  STATES.DONE,
  STATES.MANUAL_DONE
]);

const ACTIVE_STATUSES = new Set([
  STATES.INTAKE_RUNNING,
  STATES.IMPLEMENTING,
  STATES.AI_REVIEW_RUNNING,
  STATES.RESUMING,
  STATES.MANUAL
]);

function classifyReviewResult(reviewText = '') {
  return {
    hasBlockingFinding: /(^|\n)\s*(?:\[[^\]]+\]\s*)?(CRITICAL|HIGH)\s*[:\-]/i.test(reviewText),
    hasDependencyFinding: /(^|\n)\s*(?:\[[^\]]+\]\s*)?(DEPENDENCY|Dependency finding|Cross-child dependency)\s*[:\-]/i.test(reviewText),
    hasIntegrationFinding: /(^|\n)\s*(?:\[[^\]]+\]\s*)?INTEGRATION\s*[:\-]/i.test(reviewText)
  };
}

async function getUnmetDependencies(issue, options = {}) {
  if (!issue.dependsOn?.length) {
    return [];
  }

  const all = await listIssues(options.stateRoot);
  const statusMap = new Map(all.map((i) => [i.ticketId.toUpperCase(), i.status]));
  return issue.dependsOn
    .map((dep) => dep.toUpperCase())
    .filter((dep) => !UNBLOCKING_STATUSES.has(statusMap.get(dep)));
}

async function getRunningOwnershipOverlap(issue, options = {}) {
  if (!issue.parentTicketId || !issue.owns?.length) {
    return [];
  }

  const issueOwns = new Set(issue.owns);
  const siblings = (await listIssues(options.stateRoot))
    .filter((candidate) => candidate.parentTicketId === issue.parentTicketId && candidate.ticketId !== issue.ticketId);

  return siblings
    .filter((sibling) => ACTIVE_STATUSES.has(sibling.status))
    .filter((sibling) => (sibling.owns || []).some((file) => issueOwns.has(file)))
    .map((sibling) => sibling.ticketId);
}

async function getPendingSiblingBlocks(issue, options = {}) {
  if (!issue.parentTicketId || !issue.blocks?.length) {
    return [];
  }

  const all = await listIssues(options.stateRoot);
  const statusMap = new Map(all.map((i) => [i.ticketId.toUpperCase(), i.status]));
  return issue.blocks
    .map((ticketId) => ticketId.toUpperCase())
    .filter((ticketId) => !COMPLETED_SIBLING_STATUSES.has(statusMap.get(ticketId)));
}

async function unlockDependents(completedTicketId, options = {}) {
  const all = await listIssues(options.stateRoot);
  const statusMap = new Map(all.map((i) => [i.ticketId, i.status]));
  const waiting = all.filter(
    (i) => i.status === STATES.WAITING_FOR_DEPENDENCY &&
      (i.dependsOn || []).some((d) => d.toUpperCase() === completedTicketId)
  );

  for (const child of waiting) {
    const allMet = (child.dependsOn || []).every(
      (dep) => UNBLOCKING_STATUSES.has(statusMap.get(dep.toUpperCase()))
    );
    if (allMet) {
      await transition(child.ticketId, STATES.PLAN_READY, options);
    }
  }
}

async function continueSplitWorkflow(parentTicketId, options = {}) {
  const parent = await readIssue(parentTicketId, options.stateRoot).catch(() => null);
  if (!parent?.workflowActive || !parent.splitChildren?.length) {
    return parent;
  }

  const all = await listIssues(options.stateRoot);
  const children = parent.splitChildren
    .map((id) => all.find((issue) => issue.ticketId.toUpperCase() === id.toUpperCase()))
    .filter(Boolean);
  const activeChild = children.find((child) => ACTIVE_STATUSES.has(child.status) || child.activeAgent);
  if (activeChild) {
    return writeIssue(
      {
        ...parent,
        workflowCurrentChild: activeChild.ticketId,
        workflowLastUpdateAt: new Date().toISOString(),
        buttons: buttonsForState(parent.status)
      },
      options.stateRoot
    );
  }

  const statusMap = new Map(all.map((issue) => [issue.ticketId.toUpperCase(), issue.status]));
  const readyChild = children.find((child) => {
    if (child.status !== STATES.PLAN_READY) return false;
    return (child.dependsOn || []).every((dep) => COMPLETED_SIBLING_STATUSES.has(statusMap.get(dep.toUpperCase())));
  });

  if (!readyChild) {
    const allComplete = children.length > 0 && children.every((child) => INTEGRATION_READY_CHILD_STATUSES.has(child.status));
    return writeIssue(
      {
        ...parent,
        workflowActive: !allComplete,
        workflowCurrentChild: '',
        workflowLastUpdateAt: new Date().toISOString(),
        lastError: allComplete ? '' : 'Split workflow is waiting for dependencies or manual review fixes.',
        buttons: buttonsForState(parent.status)
      },
      options.stateRoot
    );
  }

  await writeIssue(
    {
      ...parent,
      workflowCurrentChild: readyChild.ticketId,
      workflowLastUpdateAt: new Date().toISOString(),
      lastError: '',
      buttons: buttonsForState(parent.status)
    },
    options.stateRoot
  );
  return proceedIssue(readyChild.ticketId, options);
}

async function unlockSiblingWaiters(completedTicketId, options = {}) {
  const completed = await readIssue(completedTicketId, options.stateRoot).catch(() => null);
  if (!completed?.parentTicketId) return;

  const all = await listIssues(options.stateRoot);
  const siblingWaiters = all.filter(
    (issue) => issue.parentTicketId === completed.parentTicketId &&
      issue.status === STATES.WAITING_FOR_SIBLINGS &&
      (issue.blocks || []).some((id) => id.toUpperCase() === completedTicketId.toUpperCase())
  );

  for (const waiter of siblingWaiters) {
    const pending = await getPendingSiblingBlocks(waiter, options);
    if (!pending.length) {
      await transition(waiter.ticketId, STATES.REVIEW_READY, options);
    }
  }
}

async function transition(ticketId, status, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  return writeIssue(
    {
      ...issue,
      status,
      activeAgent: null,
      lastError: '',
      buttons: buttonsForState(status),
      history: appendHistory(issue, status)
    },
    options.stateRoot
  );
}

async function failIssue(ticketId, message, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  return writeIssue(
    {
      ...issue,
      status: STATES.FAILED,
      activeAgent: null,
      failedPhase: issue.activeAgent?.kind || inferFailedPhase(issue),
      failedFromStatus: issue.status,
      loop: stopLoopState(issue.loop, 'FAILED', message),
      lastError: message,
      buttons: buttonsForState(STATES.FAILED),
      history: appendHistory(issue, STATES.FAILED)
    },
    options.stateRoot
  );
}

async function blockIssue(ticketId, message, options = {}, metadata = {}) {
  const issue = await readIssue(ticketId, options.stateRoot);
  return writeIssue(
    {
      ...issue,
      status: STATES.BLOCKED,
      activeAgent: null,
      failedPhase: issue.activeAgent?.kind || inferFailedPhase(issue),
      failedFromStatus: issue.status,
      loop: stopLoopState(issue.loop, 'BLOCKED', message),
      lastError: message,
      blockedAt: new Date().toISOString(),
      blockType: metadata.blockType || 'workflow',
      worktreeStatus: metadata.worktreeStatus || issue.worktreeStatus,
      buttons: buttonsForState(STATES.BLOCKED),
      history: appendHistory(issue, STATES.BLOCKED)
    },
    options.stateRoot
  );
}

function isBlockedAgentResult(result = {}) {
  return result.blocked || /^Blocked forbidden command\b/i.test(result.error || '');
}

function inferFailedPhase(issue) {
  if (issue.status === STATES.INTAKE_RUNNING || issue.status === STATES.ADDED) return 'intake';
  if (issue.status === STATES.AI_REVIEW_RUNNING) return 'review';
  return 'implementation';
}

function isReviewableStatus(status) {
  return [STATES.REVIEW_READY, STATES.FIXING_REVIEW, STATES.INTEGRATION_REQUIRED].includes(status);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isCurrentRun(ticketId, runId, options = {}) {
  const issue = await readIssue(ticketId, options.stateRoot).catch(() => null);
  return issue?.activeAgent?.runId === runId;
}

async function ensureWorktree(issue, options = {}) {
  if (options.skipWorktree || issue.executionMode === 'sequential') {
    return issue;
  }

  await mkdir(path.dirname(issue.worktreePath), { recursive: true });
  const projectPath = issue.projectPath || path.join(WORKSPACE_ROOT, issue.repo);
  const baseRef = await resolveWorktreeBaseRef(issue, options, projectPath);
  const preparedIssue = baseRef !== issue.baseBranch
    ? await writeIssue({ ...issue, baseBranch: baseRef }, options.stateRoot)
    : issue;
  const exists = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: issue.worktreePath
  }).then(() => true).catch(() => false);

  if (!exists) {
    const branchExists = await execFileAsync(
      'git', ['show-ref', '--verify', '--quiet', `refs/heads/${issue.branch}`],
      { cwd: projectPath }
    ).then(() => true).catch(() => false);
    const args = branchExists
      ? ['worktree', 'add', issue.worktreePath, issue.branch]
      : ['worktree', 'add', '-b', issue.branch, issue.worktreePath, baseRef];
    await execFileAsync('git', args, { cwd: projectPath });
  }

  const claudeMdPath = path.join(issue.worktreePath, '.claude', 'CLAUDE.md');
  await mkdir(path.dirname(claudeMdPath), { recursive: true });
  await writeFile(claudeMdPath, buildWorktreeClaude(preparedIssue));
  return preparedIssue;
}

async function resolveWorktreeBaseRef(issue, options, projectPath) {
  const candidates = [
    options.baseBranch,
    issue.baseBranch,
    'master',
    'main',
    'HEAD'
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    const ok = await execFileAsync('git', ['rev-parse', '--verify', candidate], {
      cwd: projectPath
    }).then(() => true).catch(() => false);
    if (ok) {
      return candidate;
    }
  }

  throw new Error(`Cannot find a valid git base ref for ${issue.repo}. Tried: ${candidates.join(', ')}`);
}

function buildWorktreeClaude(issue) {
  return `# Agent Rules for ${issue.ticketId}

This worktree is dedicated to ${issue.ticketId}. The issue-worker agent owns it end-to-end.

## Scope

- Implement only what is specified in the source work item and the approved plan.
- Do not make unrelated refactors or add abstractions not in the plan.
- Keep changes scoped to the files identified in the roadmap.

## Package Manager

${issue.packageManager ? `Use \`${issue.packageManager}\` for all package operations.` : 'Use the package manager specified in the repo profile.'}
Do not run dependency installation commands (pnpm install, npm install, yarn install, or lockfile updates). Dependencies are expected to be ready before agent execution.

## Tests

${issue.testCommand ? `Run relevant tests with: \`${issue.testCommand}\`` : 'Run the repo-specific relevant test command after each logical group of changes.'}
${issue.fullValidation ? `Full validation command: \`${issue.fullValidation}\`` : ''}

## Stop Conditions

Stop and report BLOCKED if:
- The plan is missing required information that cannot be inferred from source/design/code.
- The worktree has conflicting edits that make scoped implementation unsafe.
- Required dependencies or MCP sources are unavailable and no reasonable fallback exists.
`;
}

function normalizeTicketId(ticketId) {
  if (!ticketId || typeof ticketId !== 'string') {
    throw new Error('workItemId is required');
  }

  return ticketId
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-|-$/g, '');
}

function shellQuote(value) {
  return `'${String(value || '').replaceAll("'", "'\\''")}'`;
}

function isInsidePath(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function appendHistory(issue, status) {
  return [...(issue.history || []), { status, at: new Date().toISOString() }];
}

function normalizeLoopLimit(value) {
  const parsed = Number(value ?? 3);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error('Loop maxIterations must be an integer between 1 and 10.');
  }
  return parsed;
}

function recordLoopLog(loop, iteration, kind, logPath) {
  if (!loop || !iteration) return loop || null;
  const runs = [...(loop.runs || [])];
  const index = runs.findIndex((run) => run.iteration === iteration);
  const run = index >= 0 ? { ...runs[index] } : { iteration, startedAt: new Date().toISOString() };
  run[`${kind}LogPath`] = logPath;
  if (index >= 0) runs[index] = run;
  else runs.push(run);
  return { ...loop, runs };
}

function stopLoopState(loop, status, stopReason) {
  if (!loop?.enabled) return loop || null;
  return {
    ...loop,
    enabled: false,
    status,
    completedAt: new Date().toISOString(),
    stopReason
  };
}

function buildAdditionalDirs(issue) {
  return Array.from(new Set([
    path.join(WORKSPACE_ROOT, 'agent-hub'),
    path.dirname(issue.featureFilePath),
    issue.repoProfile ? path.dirname(issue.repoProfile) : '',
    issue.projectGuide ? path.dirname(issue.projectGuide) : '',
    issue.artifactDir || ''
  ].filter(Boolean)));
}

function createArtifactPaths(artifactDir) {
  return {
    intakeSummary: path.join(artifactDir, 'source-intake-summary.md'),
    designSummary: path.join(artifactDir, 'design-summary.md'),
    codeAnalysis: path.join(artifactDir, 'code-analysis-notes.md'),
    roadmap: '',
    implementationPlan: path.join(artifactDir, 'implementation-plan.md'),
    testResult: path.join(artifactDir, 'test-result.md'),
    reviewResult: path.join(artifactDir, 'ai-review-result.md'),
    finalSummary: path.join(artifactDir, 'final-summary.md'),
    splitSuggestion: path.join(artifactDir, 'suggested-subtasks.md')
  };
}

function createInitialContextHealth(input = {}) {
  const sourcesLoaded = [input.source?.type || input.sourceType || 'Manual'];
  if (input.confluencePageId) {
    sourcesLoaded.push('Confluence');
  }
  if (input.figmaUrl) {
    sourcesLoaded.push('Figma');
  }

  return {
    size: 'Low',
    risk: 'Context OK',
    sourcesLoaded,
    filesAnalyzed: 0,
    affectedFiles: 0,
    testFiles: 0,
    planSteps: 0,
    domainsTouched: 0,
    lastCompactSummaryAt: '',
    riskReasons: [],
    qualityGate: {
      passed: false,
      missing: ['affected files', 'tests', 'risks', 'out of scope', 'split decision']
    }
  };
}

async function updateArtifactsAndHealth(issue, options = {}) {
  await ensureArtifacts(issue);
  const roadmapText = await readFile(issue.featureFilePath, 'utf8').catch(() => '');
  const reviewText = issue.reviewResultPath ? await readFile(issue.reviewResultPath, 'utf8').catch(() => '') : '';
  const health = await assessContextHealth(issue, roadmapText, reviewText);

  await writeFile(issue.artifacts.intakeSummary, renderArtifact('Source Intake Summary', issue, roadmapText, ['Work Item Info', 'Ticket Info', 'Summary', 'Requirements']));
  await writeFile(issue.artifacts.designSummary, renderArtifact('Design Summary', issue, roadmapText, ['References', 'Design', 'Figma']));
  await writeFile(issue.artifacts.codeAnalysis, renderArtifact('Code Analysis Notes', issue, roadmapText, ['Affected', 'Files', 'Code']));
  await writeFile(issue.artifacts.implementationPlan, renderArtifact('Implementation Plan', issue, roadmapText, ['Implementation Plan', 'Tests', 'Risks']));
  await writeFile(issue.artifacts.reviewResult, reviewText || 'Review has not run yet.\n');
  await writeFile(issue.artifacts.testResult, 'Test results will be written after implementation.\n', { flag: 'w' });
  await writeFile(issue.artifacts.finalSummary, renderFinalSummary(issue, health));

  return {
    ...issue,
    artifacts: {
      ...issue.artifacts,
      roadmap: issue.featureFilePath
    },
    contextHealth: health
  };
}

async function ensureArtifacts(issue) {
  const normalized = ensureIssueArtifacts(issue);
  issue.artifactDir = normalized.artifactDir;
  issue.artifacts = normalized.artifacts;
  await mkdir(issue.artifactDir, { recursive: true });
}

function ensureIssueArtifacts(issue) {
  const artifactDir = issue.artifactDir || path.join(ARTIFACT_ROOT, issue.ticketId);
  return {
    ...issue,
    artifactDir,
    artifacts: {
      ...createArtifactPaths(artifactDir),
      ...(issue.artifacts || {}),
      roadmap: issue.featureFilePath
    },
    contextHealth: issue.contextHealth || createInitialContextHealth(issue)
  };
}

async function assessContextHealth(issue, roadmapText, reviewText) {
  const text = roadmapText || '';
  const lower = text.toLowerCase();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const affectedFiles = countPathLikeMentions(text);
  const testFiles = countMatches(text, /\b[\w./-]+(?:spec|test)\.(?:js|jsx|ts|tsx)\b/g);
  const planSteps = countMatches(text, /^\s*(?:[-*]|\d+\.)\s+/gm);
  const domainsTouched = countDomainMentions(text);
  const filesAnalyzed = Math.max(affectedFiles, countMatches(text, /\b(src|spec|locale|packages|libs)\//g));
  const sourcesLoaded = Array.from(new Set([
    ...(issue.contextHealth?.sourcesLoaded || [issue.source?.type || issue.sourceType || 'Manual']),
    issue.confluencePageId || /confluence:\s*https?:/i.test(text) ? 'Confluence' : '',
    issue.figmaUrl || /figma:\s*https?:/i.test(text) ? 'Figma' : '',
    filesAnalyzed > 0 ? 'Code files' : ''
  ].filter(Boolean)));

  const qualityGate = assessPlanQuality(lower);
  const riskReasons = [];
  if (words > 1800) riskReasons.push('Feature plan is long');
  if (sourcesLoaded.includes('Confluence') && sourcesLoaded.includes('Figma')) riskReasons.push('Multiple rich design sources loaded');
  if (affectedFiles > 10) riskReasons.push('Affected files > 10');
  if (planSteps > 25) riskReasons.push('Plan steps > 25');
  if (testFiles > 5) riskReasons.push('Test files > 5');
  if (domainsTouched > 3) riskReasons.push('Multiple domains touched');
  if (countMatches(reviewText, /(^|\n)\s*(CRITICAL|HIGH|MEDIUM|LOW)\s*[:\-]/gi) > 8) riskReasons.push('Many review findings');
  if (!qualityGate.passed) riskReasons.push('Plan quality gate missing required sections');

  const size = riskReasons.length >= 3 || words > 2600 || affectedFiles > 15 ? 'High' : riskReasons.length >= 1 || words > 900 || affectedFiles > 6 ? 'Medium' : 'Low';
  const risk = size === 'High' ? 'Needs Split' : size === 'Medium' ? 'Large Context' : 'Context OK';

  // Detect layered call-chain pattern (e.g. helpers → containers).
  // When affected files span both a helper/utility layer and a container/component layer,
  // the changes are most likely a single call chain that should execute sequentially
  // in one worktree rather than being parallelised across independent branches.
  const hasHelperLayer = /\b(helpers?|utils?)(\/|\.)/i.test(text);
  const hasContainerLayer = /\b(containers?|components?)(\/|\.)/i.test(text);
  const suggestedExecutionMode = hasHelperLayer && hasContainerLayer ? 'sequential' : 'parallel';

  return {
    size,
    risk,
    sourcesLoaded,
    filesAnalyzed,
    affectedFiles,
    testFiles,
    planSteps,
    domainsTouched,
    lastCompactSummaryAt: issue.contextHealth?.lastCompactSummaryAt || '',
    riskReasons,
    qualityGate,
    suggestedExecutionMode,
    splitSuggestionPath: issue.contextHealth?.splitSuggestionPath || ''
  };
}

function assessPlanQuality(lowerText) {
  const checks = [
    ['affected files', lowerText.includes('affected') || lowerText.includes('files likely affected')],
    ['tests', lowerText.includes('test')],
    ['risks', lowerText.includes('risk')],
    ['out of scope', lowerText.includes('out of scope')],
    ['split decision', lowerText.includes('split') || lowerText.includes('large task') || lowerText.includes('subtask')]
  ];
  const missing = checks.filter(([, passed]) => !passed).map(([name]) => name);
  return {
    passed: missing.length === 0,
    missing
  };
}

function countPathLikeMentions(text) {
  const matches = text.match(/\b(?:src|spec|locale|packages|libs|apps|test|tests)\/[\w./-]+\.(?:js|jsx|ts|tsx|json|yml|yaml|scss|css|md)\b/g);
  return new Set(matches || []).size;
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function countDomainMentions(text) {
  const domains = ['src/containers', 'src/components', 'src/helpers', 'src/models', 'src/hooks', 'src/services', 'locale/', 'spec/', 'packages/', 'libs/'];
  return domains.filter((domain) => text.includes(domain)).length;
}

function renderArtifact(title, issue, roadmapText, keywords) {
  const lines = roadmapText.split('\n');
  const selected = lines.filter((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase())));
  return `# ${title}: ${issue.ticketId}

Source roadmap: ${issue.featureFilePath}

${selected.length ? selected.join('\n') : 'No dedicated section found yet. Rehydrate from the roadmap before continuing.'}
`;
}

function renderFinalSummary(issue, health) {
  return `# Final Summary: ${issue.ticketId}

Status: ${issue.status}
Context size: ${health.size}
Context risk: ${health.risk}
Sources loaded: ${health.sourcesLoaded.join(', ') || 'None'}
Files analyzed: ${health.filesAnalyzed}
Last compact summary: ${health.lastCompactSummaryAt || 'N/A'}

Use this summary to rehydrate the agent before resuming work.
`;
}

function renderSplitSuggestion(issue, roadmapText = '') {
  const affectedFiles = extractAffectedFiles(roadmapText);
  const helperFiles = affectedFiles.filter((file) => /\bsrc\/helpers\//.test(file) || /\bspec\/helpers\//.test(file));
  const documentGridFiles = affectedFiles.filter((file) => /\bsrc\/containers\/DocumentGrid\//.test(file) || /\bspec\/containers\/DocumentGrid\//.test(file));
  const restoreVersionFiles = affectedFiles.filter((file) => /\bsrc\/containers\/(?:RestoreGrid|VersionHistories)\//.test(file) || /\bspec\/containers\/(?:RestoreGrid|VersionHistories)\//.test(file));
  const fallbackGroups = splitFilesEvenly(affectedFiles);
  const groupA = helperFiles.length ? helperFiles : fallbackGroups[0];
  const groupB = documentGridFiles.length ? documentGridFiles : fallbackGroups[1];
  const groupC = restoreVersionFiles.length ? restoreVersionFiles : fallbackGroups[2];
  const assignedFiles = new Set([...groupA, ...groupB, ...groupC]);
  const remainingFiles = affectedFiles.filter((file) => !assignedFiles.has(file));
  const executionMode = issue.contextHealth?.suggestedExecutionMode || 'parallel';
  const splitPlan = [
    {
      ticketId: `${issue.ticketId}-A`,
      title: helperFiles.length ? 'Restore helper-layer flag behavior only' : 'Implement foundation changes',
      dependsOn: [],
      owns: groupA,
      executionMode,
      parallelGroup: 'foundation',
      reviewMode: 'local-only',
      expectedCrossChildFindings: ['Missing call-site wiring may be owned by dependent child tasks.']
    },
    {
      ticketId: `${issue.ticketId}-B`,
      title: documentGridFiles.length ? 'Restore DocumentGrid flag wiring only' : 'Implement first dependent area',
      dependsOn: [`${issue.ticketId}-A`],
      owns: groupB,
      executionMode,
      parallelGroup: 'dependent-ui',
      reviewMode: 'dependency-aware',
      expectedCrossChildFindings: ['Parent integration may validate behavior across sibling areas.']
    },
    {
      ticketId: `${issue.ticketId}-C`,
      title: restoreVersionFiles.length ? 'Restore RestoreGrid and VersionHistories flag wiring only' : 'Implement second dependent area',
      dependsOn: [`${issue.ticketId}-A`],
      owns: groupC,
      executionMode,
      parallelGroup: 'dependent-ui',
      reviewMode: 'dependency-aware',
      expectedCrossChildFindings: ['Parent integration may validate behavior across sibling areas.']
    },
    {
      ticketId: `${issue.ticketId}-D`,
      title: 'Run integration tests and cleanup for changed areas only',
      dependsOn: [`${issue.ticketId}-B`, `${issue.ticketId}-C`],
      owns: remainingFiles,
      executionMode,
      parallelGroup: 'integration',
      reviewMode: 'parent-integration',
      expectedCrossChildFindings: []
    }
  ];

  return `# Suggested Split Plan: ${issue.ticketId}

Large context detected. Consider splitting this issue before proceeding.

${splitPlan.map((task, index) => `${index + 1}. ${task.ticketId}: ${task.title} — depends: ${task.dependsOn.length ? task.dependsOn.join(', ') : 'none'} — mode: ${task.executionMode} — owns: ${task.owns.length ? task.owns.join(', ') : 'none'} — review: ${task.reviewMode}`).join('\n')}

Suggested split dimensions:
- Prefer file/module ownership over generic analysis/implementation/test phases.
- Each child should own a disjoint file set where possible.
- Shared tests should be assigned to exactly one child or run after integration.
- Run split children in parallel only when their file ownership does not overlap.

## Split Metadata

\`\`\`json
${JSON.stringify({ subtasks: splitPlan }, null, 2)}
\`\`\`
`;
}

function parseSplitSubtasks(splitText, parentTicketId) {
  const structured = parseSplitMetadata(splitText);
  if (structured.length) {
    return structured;
  }

  const matches = [...splitText.matchAll(/^\s*\d+\.\s+([A-Z]+-\d+(?:-[a-z0-9]+)?)\s*:\s*(.+?)(?:\s+—\s+depends:\s*([^—\n]+?))?(?:\s+—\s+mode:\s*(\w+))?(?:\s+—\s+owns:\s*([^—\n]+?))?(?:\s+—\s+review:\s*([^—\n]+?))?$/gim)];
  if (matches.length) {
    return matches.map((match) => ({
      ticketId: match[1].toUpperCase(),
      title: match[2].trim(),
      dependsOn: parseDependsOn(match[3]),
      executionMode: parseExecutionMode(match[4]),
      owns: parseList(match[5]).filter((item) => item.toLowerCase() !== 'none'),
      reviewMode: parseReviewMode(match[6])
    }));
  }

  return [
    { ticketId: `${parentTicketId}-A`, title: 'Implement foundation changes', dependsOn: [], owns: [], executionMode: 'sequential', reviewMode: 'local-only', parallelGroup: 'foundation', expectedCrossChildFindings: [] },
    { ticketId: `${parentTicketId}-B`, title: 'Implement first dependent area', dependsOn: [`${parentTicketId}-A`], owns: [], executionMode: 'sequential', reviewMode: 'dependency-aware', parallelGroup: 'dependent-ui', expectedCrossChildFindings: [] },
    { ticketId: `${parentTicketId}-C`, title: 'Implement second dependent area', dependsOn: [`${parentTicketId}-A`], owns: [], executionMode: 'sequential', reviewMode: 'dependency-aware', parallelGroup: 'dependent-ui', expectedCrossChildFindings: [] },
    { ticketId: `${parentTicketId}-D`, title: 'Run integration tests and cleanup for changed areas only', dependsOn: [`${parentTicketId}-B`, `${parentTicketId}-C`], owns: [], executionMode: 'sequential', reviewMode: 'parent-integration', parallelGroup: 'integration', expectedCrossChildFindings: [] }
  ];
}

function parseSplitMetadata(splitText) {
  const match = splitText.match(/```json\s*([\s\S]*?)```/i);
  if (!match) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed.subtasks)
      ? parsed.subtasks.map(normalizeSplitSubtask).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalizeSplitSubtask(task) {
  if (!task?.ticketId) {
    return null;
  }

  return {
    ticketId: normalizeTicketId(task.ticketId),
    title: String(task.title || task.ticketId).trim(),
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(normalizeTicketId) : parseDependsOn(task.dependsOn),
    owns: Array.isArray(task.owns) ? task.owns.map((item) => String(item).trim()).filter(Boolean) : parseList(task.owns),
    executionMode: parseExecutionMode(task.executionMode),
    parallelGroup: String(task.parallelGroup || '').trim(),
    reviewMode: parseReviewMode(task.reviewMode),
    expectedCrossChildFindings: Array.isArray(task.expectedCrossChildFindings)
      ? task.expectedCrossChildFindings.map((item) => String(item).trim()).filter(Boolean)
      : parseList(task.expectedCrossChildFindings)
  };
}

function parseDependsOn(raw) {
  if (!raw || raw.trim().toLowerCase() === 'none') {
    return [];
  }

  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function parseList(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseExecutionMode(raw) {
  const normalised = raw?.trim().toLowerCase();
  return normalised === 'sequential' ? 'sequential' : 'parallel';
}

function parseReviewMode(raw) {
  const normalised = raw?.trim().toLowerCase();
  return ['local-only', 'dependency-aware', 'parent-integration'].includes(normalised)
    ? normalised
    : '';
}

function validateSplitOwnership(subtasks) {
  const issues = [];
  const seen = new Map();
  for (const task of subtasks) {
    for (const file of task.owns || []) {
      if (!file || file.toLowerCase() === 'none') continue;
      const previous = seen.get(file);
      if (previous) {
        issues.push(`${file} is owned by both ${previous} and ${task.childTicketId}`);
      } else {
        seen.set(file, task.childTicketId);
      }
    }
  }
  return issues;
}

function extractAffectedFiles(text) {
  const matches = text.match(/\b(?:src|spec|locale|packages|libs|apps|test|tests)\/[\w./-]+\.(?:js|jsx|ts|tsx|json|yml|yaml|scss|css|md)\b/g);
  return [...new Set(matches || [])];
}

function splitFilesEvenly(files) {
  const groups = [[], [], [], []];
  files.forEach((file, index) => groups[index % groups.length].push(file));
  return groups;
}

function renderChildSplitRoadmap(parentIssue, subtask, childTicketId, dependsOn = [], blocks = [], executionMode = 'parallel') {
  const executionNote = executionMode === 'sequential'
    ? 'Sequential: this child shares the parent worktree and branch. Do not run concurrently with siblings.'
    : 'Parallel: this child has its own independent worktree and branch.';

  return `# ${childTicketId}: ${subtask.title}

## Ticket Info
- Parent: ${parentIssue.ticketId}
- Source: ${parentIssue.source?.url || parentIssue.sourceUrl || parentIssue.jiraUrl || 'N/A'}
- Type: split-task
- Execution mode: ${executionMode}

## Split Scope
${subtask.title}

## Ownership
- Owns: ${subtask.owns?.length ? subtask.owns.join(', ') : 'none declared'}
- Parallel group: ${subtask.parallelGroup || 'none'}
- Review mode: ${subtask.reviewMode || 'dependency-aware'}
- Expected cross-child findings: ${subtask.expectedCrossChildFindings?.length ? subtask.expectedCrossChildFindings.join('; ') : 'none'}

## Dependencies
- Depends on: ${dependsOn.length ? dependsOn.join(', ') : 'none'}
- Unblocks: ${blocks.length ? blocks.join(', ') : 'none'}
${dependsOn.length ? '- Do not start implementation until all dependencies reach IMPLEMENTED.' : ''}
- ${executionNote}

## Source Context
- Parent roadmap: ${parentIssue.featureFilePath}
- Parent split plan: ${parentIssue.artifacts.splitSuggestion}
- Repo profile: ${parentIssue.repoProfile}
- Project guide: ${parentIssue.projectGuide}

## Implementation Plan
1. Rehydrate from the parent roadmap and split plan.
2. Confirm the files relevant to this subtask only.
3. Implement this subtask in isolation.
4. Run the relevant tests for the touched files.

## Tests
- Add or update tests directly related to this subtask.
- Use repo command shape: ${parentIssue.testCommand || 'repo-specific relevant test command'}.

## Risks
- Parent task was split because the original plan exceeded context health thresholds.
- Keep this child scoped; do not implement sibling split work here.

## Out of Scope
- Sibling split tasks from ${parentIssue.ticketId}.
- Unrelated refactors and dependency upgrades.

## Split Decision
- This is an approved split child from ${parentIssue.ticketId}.

PLAN_READY
`;
}

function buildIntakePrompt(issue) {
  return [
    'Use the issue-worker agent.',
    buildProgressMarkerInstructions([
      'Read repo and project guidance',
      'Fetch source/design context',
      'Analyze the smallest relevant code surface',
      'Write roadmap and implementation plan',
      'Stop at plan ready'
    ]),
    issue.repoProfile ? `Read repo profile: ${issue.repoProfile}.` : '',
    issue.projectGuide ? `Read project guide: ${issue.projectGuide}.` : '',
    renderSourceFetchInstruction(issue),
    issue.confluencePageId ? `Read Confluence page ${issue.confluencePageId}.` : '',
    issue.figmaUrl ? `Read Figma ${issue.figmaUrl}.` : '',
    issue.repoSkills?.length ? `Repo-specific skills to consider:\n${issue.repoSkills.map((skill) => `- ${skill}`).join('\n')}` : '',
    `Analyze relevant code and write the roadmap to ${issue.featureFilePath}.`,
    'Produce a decision-complete implementation plan in that roadmap.',
    'Keep intake bounded: read only the source/design context and the smallest set of relevant files needed to produce a reliable plan.',
    'The roadmap must include explicit sections named: Affected Code Areas, Implementation Plan, Tests, Risks, Out of Scope, Split Decision.',
    'In Split Decision, write one of: Not needed, Recommended, or Required, with a short reason.',
    'Stop after the plan. Do not implement until Proceed is requested.'
  ].filter(Boolean).join('\n');
}

function renderSourceFetchInstruction(issue) {
  if (issue.source?.url) return `Read source work item context from ${issue.source.url}.`;
  return `Use the provided work item title and source metadata for ${issue.externalId || issue.ticketId}.`;
}

function buildImplementationPrompt(issue) {
  return [
    issue.loop?.enabled ? `Autonomous loop iteration ${issue.loop.iteration}/${issue.loop.maxIterations}. Work toward the approved plan's acceptance criteria. Do not declare success without running the requested validation.` : '',
    issue.loop?.enabled ? `Loop acceptance criteria: ${issue.loop.acceptanceCriteria}` : '',
    buildProgressMarkerInstructions([
      'Rehydrate issue context',
      'Inspect current diff and owned files',
      'Implement scoped changes',
      'Run focused validation',
      'Summarize result'
    ]),
    issue.repoProfile ? `Read repo profile: ${issue.repoProfile}.` : '',
    issue.projectGuide ? `Read project guide: ${issue.projectGuide}.` : '',
    `Read ${issue.featureFilePath}.`,
    issue.parentTicketId ? `This is a split child of ${issue.parentTicketId}.` : '',
    issue.owns?.length ? `Owned files for this child:\n${issue.owns.map((file) => `- ${file}`).join('\n')}` : '',
    issue.dependsOn?.length ? `Dependencies already required before start: ${issue.dependsOn.join(', ')}.` : '',
    issue.expectedCrossChildFindings?.length ? `Expected sibling-owned gaps:\n${issue.expectedCrossChildFindings.map((item) => `- ${item}`).join('\n')}` : '',
    'Implement the approved plan in this worktree.',
    issue.parentTicketId ? 'For split child work, edit only owned files. If required work belongs to a sibling, stop and report DEPENDENCY instead of editing outside scope.' : '',
    'Do not run dependency installation commands such as pnpm install, npm install, yarn install, or lockfile updates. Dependencies are expected to be ready before agent execution.',
    issue.testCommand ? `Run relevant tests with this command shape: ${issue.testCommand}.` : 'Run the repo-specific relevant tests after each logical group of changes.',
    issue.fullValidation ? `Use full validation when appropriate: ${issue.fullValidation}.` : '',
    issue.repoSkills?.length ? `Repo-specific skills to consider:\n${issue.repoSkills.map((skill) => `- ${skill}`).join('\n')}` : '',
    'Keep the change scoped to the source work item.'
  ].filter(Boolean).join('\n');
}

function buildFixReviewPrompt(issue) {
  const hasHumanInstructions = issue.humanComment?.trim();
  const isIntegrationFix = (issue.reviewSourceStatus || issue.status) === STATES.INTEGRATION_REQUIRED;
  const reviewComments = (issue.reviewComments || []).filter((comment) => ['OPEN', 'SENT'].includes(comment.status));
  return [
    issue.loop?.enabled ? `Autonomous loop iteration ${issue.loop.iteration}/${issue.loop.maxIterations}. This is a fresh repair pass. Re-read the persisted plan, current diff, and latest review result before editing.` : '',
    issue.loop?.enabled ? `Loop acceptance criteria: ${issue.loop.acceptanceCriteria}` : '',
    isIntegrationFix
      ? `Fix parent integration review findings for ${issue.ticketId}.`
      : `Fix review findings for ${issue.ticketId}.`,
    buildProgressMarkerInstructions([
      'Read review findings',
      'Inspect current diff',
      'Apply scoped fixes',
      'Run focused validation',
      'Summarize result'
    ]),
    issue.repoProfile ? `Read repo profile: ${issue.repoProfile}.` : '',
    issue.projectGuide ? `Read project guide: ${issue.projectGuide}.` : '',
    `Read the implementation plan at ${issue.featureFilePath}.`,
    issue.reviewResultPath ? `Read the AI review result at ${issue.reviewResultPath}.` : '',
    reviewComments.length ? `Human inline review comments (address all):\n${reviewComments.map((comment) => `- ${comment.file}:${comment.line} - ${comment.body}`).join('\n')}` : '',
    hasHumanInstructions
      ? `Human review instructions (follow exactly — these take precedence over AI review findings):\n${issue.humanComment}`
      : isIntegrationFix
        ? 'Address INTEGRATION findings from the AI review result. Keep sibling-local work in sibling children unless the integration fix must happen in the parent worktree.'
        : 'Address all CRITICAL and HIGH findings from the AI review result.',
    'Keep changes minimal and scoped to the identified issues. Do not refactor unrelated code.',
    issue.testCommand ? `Run relevant tests: ${issue.testCommand}.` : '',
    issue.repoSkills?.length ? `Repo-specific skills to consider:\n${issue.repoSkills.map((s) => `- ${s}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

function buildProgressMarkerInstructions(labels) {
  return [
    'Report progress as plain text before each major phase using exactly this format:',
    ...labels.map((label, index) => `PROGRESS: step=${index + 1}/${labels.length} label="${label}"`)
  ].join('\n');
}

function buildReviewPrompt(issue, reviewResultPath) {
  return [
    `Review changes for ${issue.ticketId}.`,
    'Use the review-packet skill.',
    `Shared review skill: ${path.join(TEMPLATE_ROOT, 'skills/review-packet/SKILL.md')}.`,
    issue.repoProfile ? `Read repo profile: ${issue.repoProfile}.` : '',
    issue.projectGuide ? `Read project guide: ${issue.projectGuide}.` : '',
    `Compare against base branch: ${issue.baseBranch || 'master'}.`,
    issue.splitChildren?.length ? `Parent integration review for split children: ${issue.splitChildren.join(', ')}.` : '',
    'Use the code-reviewer subagent and security-reviewer subagent.',
    'Focus on bugs, regressions, missing tests, secrets, injection, and OWASP risks.',
    ...buildReviewModeInstructions(issue),
    `Write the final review result to ${reviewResultPath}.`,
    'Use exact blocking prefixes only for real blocking findings: CRITICAL: or HIGH:.',
    'If there are no blocking findings, write exactly: No blocking findings.'
  ].filter(Boolean).join('\n');
}

function buildReviewModeInstructions(issue) {
  const mode = issue.reviewMode;
  if (!mode) {
    return [];
  }

  if (mode === 'local-only') {
    return [
      `Review mode: local-only. This is a foundation split-child of ${issue.parentTicketId || 'the parent task'}.`,
      'Only report CRITICAL or HIGH for issues within files this child directly modified.',
      'Missing call-site wiring or container-level integration expected from sibling tasks is NOT a blocking finding here.',
      'If you see cross-child dependency gaps, note them as: DEPENDENCY: [description] — expected to be resolved by a sibling task. Do not mark these CRITICAL or HIGH.'
    ];
  }

  if (mode === 'dependency-aware') {
    return [
      `Review mode: dependency-aware. This is a wiring split-child of ${issue.parentTicketId || 'the parent task'}.`,
      'Only mark CRITICAL or HIGH for issues within files this child directly modified.',
      'You may note cross-child integration issues, but label them as: DEPENDENCY: [description] rather than CRITICAL or HIGH.'
    ];
  }

  if (mode === 'parent-integration') {
    return [
      `Review mode: parent-integration. This is the final integration child of ${issue.parentTicketId || 'the parent task'}.`,
      'Review the complete changeset relative to the base branch.',
      'Check that all cross-child wiring is complete end-to-end.',
      'Missing integration that spans multiple sibling children and would break the feature may be reported as CRITICAL or HIGH.'
    ];
  }

  return [];
}

function renderRoadmap(issue) {
  return `# ${issue.ticketId}: ${issue.title}

## Work Item Info
- **Key**: ${issue.ticketId}
- **Type**: ${issue.type}
- **Status**: Planning
- **Source**: ${issue.source?.type || issue.sourceType || 'manual'}
- **Source URL**: ${issue.source?.url || issue.sourceUrl || issue.jiraUrl || 'N/A'}

## References
- Confluence: ${issue.confluencePageId || 'N/A'}
- Figma: ${issue.figmaUrl || 'N/A'}

## Scope
- In scope: dry-run placeholder.
- Out of scope: production source changes during intake.

## Roadmap
- Fetch source work item details.
- Pull design context when available.
- Analyze related repo code paths.
- Produce implementation plan, tests, locale changes, edge cases, and risks.
- Decide whether this work item needs split work before implementation.

## Affected Files
- src/example.js -- dry-run placeholder.

## Tests
- Add or update focused Jest tests for changed behavior.

## Risks
- Context may need refresh if source/design/code scope grows.

## Split Decision
- Large task policy: no split needed for this dry-run placeholder.

## Implementation Plan
- Dry-run placeholder generated by Agent Hub tests.
`;
}
