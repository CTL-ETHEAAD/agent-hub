#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  approveSplitPlan,
  cleanIssueWorktree,
  executeSplitPlan,
  getTakeoverInfo,
  markIssueManual,
  markIssueManualDone,
  proceedIssue,
  splitIssue,
  startIssueLoop,
  stopIssue
} from './orchestrator.js';
import { listIssues, readIssue } from './stateStore.js';
import { runSchedulerOnce, runWorkerLoop, runWorkerOnce } from './workerRuntime.js';

const command = process.argv[2] || 'list';
const arg = process.argv[3];
const flags = new Set(process.argv.slice(4));
if (arg?.startsWith('--')) flags.add(arg);

try {
  if (command === 'list') {
    await printList();
  } else if (command === 'show') {
    requireTicket(arg);
    await printIssue(arg);
  } else if (command === 'logs') {
    requireTicket(arg);
    await printLog(arg, process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'intake', flags.has('--follow'));
  } else if (command === 'watch') {
    await watchList();
  } else if (command === 'stop') {
    requireTicket(arg);
    await stopCli(arg);
  } else if (command === 'takeover') {
    requireTicket(arg);
    await takeoverCli(arg);
  } else if (command === 'manual-done') {
    requireTicket(arg);
    await manualDoneCli(arg);
  } else if (command === 'clean-worktree') {
    requireTicket(arg);
    await cleanWorktreeCli(arg);
  } else if (command === 'split') {
    requireTicket(arg);
    await splitCli(arg);
  } else if (command === 'approve-split') {
    requireTicket(arg);
    await approveSplitCli(arg);
  } else if (command === 'execute-split') {
    requireTicket(arg);
    await executeSplitCli(arg);
  } else if (command === 'proceed') {
    requireTicket(arg);
    await proceedCli(arg);
  } else if (command === 'loop') {
    requireTicket(arg);
    await loopCli(arg);
  } else if (command === 'proceed-ready') {
    await printProceedReady();
  } else if (command === 'worker') {
    await workerCli();
  } else if (command === 'scheduler') {
    await schedulerCli();
  } else {
    printHelp();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function printList() {
  const issues = await listIssues();
  if (!issues.length) {
    console.log('No issues yet.');
    return;
  }

  const rows = issues.map((issue) => ({
    ticket: issue.ticketId,
    repo: issue.repo,
    status: issue.status,
    context: `${issue.contextHealth?.size || 'Low'} / ${issue.contextHealth?.risk || 'Context OK'}`,
    agent: issue.activeAgent ? `${issue.activeAgent.kind}:${issue.activeAgent.pid}` : '-',
    updated: issue.updatedAt
  }));

  console.table(rows);
}

async function printIssue(ticketId) {
  const issue = await readIssue(ticketId);
  console.log(JSON.stringify(issue, null, 2));
}

async function printLog(ticketId, kind, follow = false) {
  const issue = await readIssue(ticketId);
  const logPath = issue.logs?.[kind] || issue.activeAgent?.logPath;
  if (!logPath) {
    console.log(`${kind} log has not been written yet.`);
    return;
  }

  if (!follow) {
    console.log(await readFile(logPath, 'utf8').catch(() => `${kind} log not found at ${logPath}.`));
    return;
  }

  await followFile(logPath);
}

async function watchList() {
  while (true) {
    process.stdout.write('\x1Bc');
    console.log(`Agent Hub Status  ${new Date().toLocaleString()}`);
    console.log('');
    await printList();
    await delay(3000);
  }
}

async function stopCli(ticketId) {
  const issue = await stopIssue(ticketId);
  console.log(`${issue.ticketId} stopped. Status: ${issue.status}`);
}

async function cleanWorktreeCli(ticketId) {
  if (!flags.has('--force')) {
    throw new Error(`Refusing to clean ${ticketId} without --force.`);
  }
  const issue = await cleanIssueWorktree(ticketId, { force: true });
  console.log(issue.cleanResult || `${issue.ticketId} worktree cleaned.`);
}

async function takeoverCli(ticketId) {
  const result = await markIssueManual(ticketId);
  console.log(result.takeoverInfo || await getTakeoverInfo(ticketId));
}

async function manualDoneCli(ticketId) {
  const issue = await markIssueManualDone(ticketId);
  console.log(`${issue.ticketId} marked manual done. Status: ${issue.status}`);
}

async function splitCli(ticketId) {
  const issue = await splitIssue(ticketId);
  console.log(`${issue.ticketId} split plan generated. Status: ${issue.status}`);
  if (issue.contextHealth?.splitSuggestionPath) {
    console.log(`Split plan: ${issue.contextHealth.splitSuggestionPath}`);
  }
}

async function approveSplitCli(ticketId) {
  const issue = await approveSplitPlan(ticketId);
  console.log(`${issue.ticketId} split approved. Status: ${issue.status}`);
}

async function executeSplitCli(ticketId) {
  const issue = await executeSplitPlan(ticketId, { resetExisting: flags.has('--reset-existing') });
  console.log(`${issue.ticketId} split execute result. Status: ${issue.status}`);
  if (issue.splitChildren?.length) {
    console.log(`Children: ${issue.splitChildren.join(', ')}`);
  }
  if (issue.lastError) {
    console.log(issue.lastError);
  }
}

async function proceedCli(ticketId) {
  const issue = await proceedIssue(ticketId, { allowDirty: flags.has('--allow-dirty') });
  console.log(`${issue.ticketId} proceed result. Status: ${issue.status}`);
  if (issue.activeAgent) {
    console.log(`Agent: ${issue.activeAgent.kind} pid ${issue.activeAgent.pid || 'unknown'}`);
  }
  if (issue.lastError) {
    console.log(issue.lastError);
  }
}

async function loopCli(ticketId) {
  const maxFlag = [...flags].find((flag) => flag.startsWith('--max='));
  const maxIterations = maxFlag ? Number(maxFlag.slice('--max='.length)) : 3;
  const issue = await startIssueLoop(ticketId, { maxIterations });
  console.log(`${issue.ticketId} loop started. Iteration: ${issue.loop?.iteration}/${issue.loop?.maxIterations}`);
  if (issue.activeAgent) {
    console.log(`Agent: ${issue.activeAgent.kind} pid ${issue.activeAgent.pid || 'unknown'}`);
  }
}

async function printProceedReady() {
  const ready = (await listIssues()).filter((issue) => issue.status === 'PLAN_READY' && !issue.activeAgent && issue.buttons?.proceed);
  if (!ready.length) {
    console.log('No issues are ready to proceed.');
    return;
  }

  console.table(ready.map((issue) => ({
    ticket: issue.ticketId,
    repo: issue.repo,
    title: issue.title,
    dependsOn: issue.dependsOn?.join(', ') || '-',
    worktree: issue.worktreePath
  })));
}

async function workerCli() {
  const options = {
    workerId: getFlagValue('--id') || undefined,
    concurrencySlots: Number(getFlagValue('--concurrency') || 1),
    leaseMs: Number(getFlagValue('--lease-ms') || 30_000),
    intervalMs: Number(getFlagValue('--interval-ms') || 1000)
  };
  if (flags.has('--once')) {
    const result = await runWorkerOnce(options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  await runWorkerLoop(options);
}

async function schedulerCli() {
  const result = await runSchedulerOnce({
    staleAfterMs: Number(getFlagValue('--stale-after-ms') || 60_000)
  });
  console.log(JSON.stringify({
    interruptedNodeRuns: result.interruptedNodeRuns.length,
    staleWorkers: result.staleWorkers.length
  }, null, 2));
}

async function followFile(filePath) {
  let offset = 0;
  while (true) {
    const info = await stat(filePath).catch(() => null);
    if (!info) {
      process.stdout.write(`Waiting for ${filePath}...\n`);
      await delay(1000);
      continue;
    }

    if (info.size < offset) {
      offset = 0;
    }
    if (info.size > offset) {
      const content = await readFile(filePath, 'utf8');
      process.stdout.write(content.slice(offset));
      offset = info.size;
    }
    await delay(1000);
  }
}

function requireTicket(ticketId) {
  if (!ticketId) {
    throw new Error('Ticket ID is required.');
  }
}

function getFlagValue(name) {
  const match = [...flags].find((flag) => flag.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}

function printHelp() {
  console.log(`Usage:
  npm run hub -- list
  npm run hub -- watch
  npm run hub -- proceed-ready
  npm run hub -- show demo-task-1
  npm run hub -- logs demo-task-1 [intake|implementation|review]
  npm run hub -- stop demo-task-1
  npm run hub -- takeover demo-task-1
  npm run hub -- clean-worktree demo-task-1 --force
  npm run hub -- proceed demo-task-1 [--allow-dirty]
  npm run hub -- worker [--once] [--id=worker-local] [--concurrency=2]
  npm run hub -- scheduler
`);
}
