import { validateValueAgainstSchema } from './agentSchema.js';
import { readAgent } from './agentStore.js';
import { cancelAgentRun, readAgentRun, startAgentRun } from './agentService.js';
import { readWorkflow } from './workflowStore.js';
import { resolveReference } from './workflowSchema.js';
import { createWorkflowRun, finishWorkflowRun, listWorkflowRuns, pauseWorkflowRun, readWorkflowRun, reconcileWorkflowRuns, updateWorkflowRun } from './workflowRunStore.js';
import { addIssue, approveIssue, proceedIssue, startAiReview, startIntake } from './orchestrator.js';
import { readIssue } from './stateStore.js';
import { executeTool } from './toolService.js';
import { readTool } from './toolStore.js';
import { commitFeature, createDraftPullRequest, pushFeature, waitForPullRequestChecks } from './deliveryService.js';
import { appendTrace } from './trace/traceStore.js';
import { cancelNodeRun, completeNodeRun, failNodeRun, setNodeRunInput, startNodeRun, waitNodeRun } from './nodeRunService.js';

export async function startWorkflowRun(workflowId, input, options = {}) {
  const workflow = await readWorkflow(workflowId, options.version, options.workflowsRoot);
  if (workflow.status === 'archived') throw domainError('Archived workflows cannot run.', 'WORKFLOW_ARCHIVED', 409);
  validateValueAgainstSchema(input, workflow.inputSchema, { label: 'input' });
  await validateAgentNodes(workflow, options);
  await validateToolNodes(workflow, options);
  await validateSubworkflowNodes(workflow, options);
  if (options.idempotencyKey) {
    const existing = (await listWorkflowRuns({ workflowId }, options.workflowRunsRoot)).find((candidate) => candidate.workflowVersion === workflow.version && candidate.idempotencyKey === options.idempotencyKey && !['failed', 'cancelled'].includes(candidate.status));
    if (existing) return existing;
  }
  let run = await createWorkflowRun({ workflow, input, idempotencyKey: options.idempotencyKey, parentRunId: options.parentRunId }, options.workflowRunsRoot);
  run = await updateWorkflowRun(run.id, { status: 'running', startedAt: new Date().toISOString() }, options.workflowRunsRoot);
  void executeWorkflow(run.id, options);
  return run;
}

export async function executeWorkflow(runId, options = {}) {
  let run = await readWorkflowRun(runId, options.workflowRunsRoot);
  const workflow = run.workflowSnapshot;
  const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of workflow.edges) { const list = outgoing.get(edge.from) || []; list.push(edge); outgoing.set(edge.from, list); }
  let node = options.resumeFrom ? nodeMap.get(options.resumeFrom) : workflow.nodes.find((item) => item.type === 'start');
  const context = { input: run.input, nodes: Object.fromEntries(Object.values(run.nodes).filter((item) => item.status === 'succeeded').map((item) => [item.id, { output: item.output }])) };

  try {
    while (node) {
      run = await markNodeRunning(runId, node, options);
      enforceWorkflowBudget(run, workflow, node);
      let output;
      let nextEdge;
      if (node.type === 'start') {
        output = run.input;
        nextEdge = outgoing.get(node.id)?.[0];
      } else if (node.type === 'agent') {
        const mappedInput = resolveMapping(node.input, context);
        await setNodeInput(runId, node.id, mappedInput, options);
        output = await runAgentNode(runId, node, mappedInput, options);
        nextEdge = outgoing.get(node.id)?.[0];
      } else if (node.type === 'tool') {
        const mappedInput = resolveMapping(node.input, context);
        await setNodeInput(runId, node.id, mappedInput, options);
        output = await runToolNode(runId, node, mappedInput, options);
        nextEdge = outgoing.get(node.id)?.[0];
      } else if (node.type === 'subworkflow') {
        const mappedInput = resolveMapping(node.input, context);
        await setNodeInput(runId, node.id, mappedInput, options);
        output = await runSubworkflowNode(runId, workflow, node, mappedInput, options);
        nextEdge = outgoing.get(node.id)?.[0];
      } else if (node.type === 'parallel') {
        const branches = outgoing.get(node.id) || [];
        const settled = await Promise.allSettled(branches.map((edge) => executeParallelBranch(runId, edge.to, node.joinId, workflow, context, outgoing, nodeMap, options)));
        const failed = settled.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        const results = settled.map((result) => result.value);
        output = Object.fromEntries(results.map((result, index) => [branches[index].label || `branch${index + 1}`, result]));
        context.nodes[node.id] = { output };
        context.nodes[node.joinId] = { output };
        await markNodeSucceeded(runId, node.id, output, options);
        node = nodeMap.get(node.joinId);
        continue;
      } else if (node.type === 'join') {
        output = node.output ? resolveMapping(node.output, context) : context.nodes[node.id]?.output;
        nextEdge = outgoing.get(node.id)?.[0];
      } else if (node.type === 'condition') {
        const value = resolveReference(node.value, context);
        output = evaluateCondition(value, node.operator, node.compare);
        nextEdge = (outgoing.get(node.id) || []).find((edge) => edge.when === output);
      } else if (node.type === 'approval') {
        const latest = await updateWorkflowRun(runId, (current) => ({ nodes: { ...current.nodes, [node.id]: { ...current.nodes[node.id], status: 'waiting', input: { prompt: node.prompt } } } }), options.workflowRunsRoot);
        await waitNodeRun(latest.nodes[node.id]?.nodeRunId, { prompt: node.prompt }, options);
        return pauseWorkflowRun(runId, node.id, options.workflowRunsRoot);
      } else if (node.type === 'feature') {
        output = await executeWithRetry(runId, node, () => executeFeatureNode(node, context), options.workflowRunsRoot);
        nextEdge = outgoing.get(node.id)?.[0];
      } else if (node.type === 'end') {
        output = resolveMapping(node.output ?? '$input', context);
        await markNodeSucceeded(runId, node.id, output, options);
        return finishWorkflowRun(runId, 'succeeded', { output }, options.workflowRunsRoot);
      }
      context.nodes[node.id] = { output };
      await markNodeSucceeded(runId, node.id, output, options);
      const latest = await readWorkflowRun(runId, options.workflowRunsRoot);
      if (latest.status === 'cancelled') return latest;
      node = nextEdge ? nodeMap.get(nextEdge.to) : null;
      if (!node) throw domainError('Workflow path ended without an end node.', 'WORKFLOW_PATH_INCOMPLETE', 500);
    }
  } catch (error) {
    const current = await readWorkflowRun(runId, options.workflowRunsRoot);
    if (current.status === 'cancelled') return current;
    const alreadyFailed = Object.values(current.nodes).some((item) => item.status === 'failed');
    if (!alreadyFailed && current.currentNodeId) await markNodeFailed(runId, current.currentNodeId, error, options);
    return finishWorkflowRun(runId, 'failed', { error: serialize(error) }, options.workflowRunsRoot);
  }
}

export async function decideWorkflowApproval(runId, { approved, note = '' } = {}, options = {}) {
  const run = await readWorkflowRun(runId, options.workflowRunsRoot);
  if (run.status !== 'waiting_approval' || !run.currentNodeId) throw domainError('Workflow is not waiting for approval.', 'WORKFLOW_NOT_WAITING_APPROVAL', 409);
  const nodeId = run.currentNodeId;
  const node = run.workflowSnapshot.nodes.find((item) => item.id === nodeId);
  const edge = run.workflowSnapshot.edges.find((item) => item.from === nodeId);
  if (!approved) {
    await markNodeFailed(runId, nodeId, domainError(note || 'Approval rejected.', 'WORKFLOW_APPROVAL_REJECTED', 409), options);
    return finishWorkflowRun(runId, 'failed', { error: { code: 'WORKFLOW_APPROVAL_REJECTED', message: note || 'Approval rejected.' } }, options.workflowRunsRoot);
  }
  const output = { approved: true, note, decidedAt: new Date().toISOString() };
  await markNodeSucceeded(runId, node.id, output, options);
  await updateWorkflowRun(runId, (current) => ({ status: 'running', currentNodeId: null, events: [...(current.events || []), { type: 'approval.approved', nodeId, note, at: output.decidedAt }] }), options.workflowRunsRoot);
  void executeWorkflow(runId, { ...options, resumeFrom: edge.to });
  return readWorkflowRun(runId, options.workflowRunsRoot);
}

export async function retryWorkflowRun(runId, options = {}) {
  const previous = await readWorkflowRun(runId, options.workflowRunsRoot);
  if (!['failed', 'cancelled'].includes(previous.status)) throw domainError('Only failed or cancelled workflows can be retried.', 'WORKFLOW_RETRY_INVALID', 409);
  await validateAgentNodes(previous.workflowSnapshot, options);
  await validateToolNodes(previous.workflowSnapshot, options);
  await validateSubworkflowNodes(previous.workflowSnapshot, options);
  let run = await createWorkflowRun({ workflow: previous.workflowSnapshot, input: previous.input }, options.workflowRunsRoot);
  run = await updateWorkflowRun(run.id, { status: 'running', startedAt: new Date().toISOString(), retryOf: previous.id }, options.workflowRunsRoot);
  void executeWorkflow(run.id, options);
  return run;
}

export async function resumeWorkflowFromFailure(runId, options = {}) {
  const previous = await readWorkflowRun(runId, options.workflowRunsRoot);
  if (previous.status !== 'failed') throw domainError('Only failed workflows can resume from a node.', 'WORKFLOW_RESUME_INVALID', 409);
  const failedNode = Object.values(previous.nodes).find((node) => node.status === 'failed');
  if (!failedNode) throw domainError('Failed node was not recorded.', 'WORKFLOW_FAILED_NODE_MISSING', 409);
  if (isInsideParallelBranch(previous.workflowSnapshot, failedNode.id)) throw domainError('Parallel branch failures must be retried from the start so every branch and Join output are rebuilt.', 'PARALLEL_RESUME_UNSAFE', 409);
  await validateAgentNodes(previous.workflowSnapshot, options);
  await validateToolNodes(previous.workflowSnapshot, options);
  await validateSubworkflowNodes(previous.workflowSnapshot, options);
  let run = await createWorkflowRun({ workflow: previous.workflowSnapshot, input: previous.input, parentRunId: previous.parentRunId }, options.workflowRunsRoot);
  const reusableNodes = Object.fromEntries(Object.entries(run.nodes).map(([id, node]) => {
    const prior = previous.nodes[id];
    return [id, prior?.status === 'succeeded' ? { ...prior } : node];
  }));
  run = await updateWorkflowRun(run.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
    retryOf: previous.id,
    resumedFromNodeId: failedNode.id,
    nodes: reusableNodes,
    events: [...run.events, { type: 'run.resumed_from_node', sourceRunId: previous.id, nodeId: failedNode.id, at: new Date().toISOString() }]
  }, options.workflowRunsRoot);
  void executeWorkflow(run.id, { ...options, resumeFrom: failedNode.id });
  return run;
}

export async function cancelWorkflowRun(runId, options = {}) {
  const run = await readWorkflowRun(runId, options.workflowRunsRoot);
  if (!['running', 'queued', 'waiting_approval'].includes(run.status)) throw domainError('Workflow run is not active.', 'WORKFLOW_RUN_NOT_ACTIVE', 409);
  const agentRunId = run.currentNodeId ? run.nodes[run.currentNodeId]?.agentRunId : null;
  const nodeRunId = run.currentNodeId ? run.nodes[run.currentNodeId]?.nodeRunId : null;
  if (agentRunId) await cancelAgentRun(agentRunId, { runsRoot: options.agentRunsRoot }).catch(() => {});
  if (nodeRunId) await cancelNodeRun(nodeRunId, options).catch(() => {});
  return finishWorkflowRun(runId, 'cancelled', { error: { code: 'WORKFLOW_CANCELLED', message: 'Cancelled by user.' } }, options.workflowRunsRoot);
}

async function validateAgentNodes(workflow, options) {
  for (const node of workflow.nodes.filter((item) => item.type === 'agent')) {
    const agent = await readAgent(node.agentId, node.agentVersion, options.agentsRoot);
    if (agent.status === 'archived') throw domainError(`Agent ${node.agentId} is archived.`, 'WORKFLOW_AGENT_ARCHIVED', 409);
  }
}

async function validateToolNodes(workflow, options) {
  for (const node of workflow.nodes.filter((item) => item.type === 'tool')) {
    const tool = await readTool(node.toolId, node.toolVersion, options.toolsRoot);
    if (tool.status === 'archived') throw domainError(`Tool ${node.toolId} is archived.`, 'WORKFLOW_TOOL_ARCHIVED', 409);
  }
}

async function validateSubworkflowNodes(workflow, options) {
  for (const node of workflow.nodes.filter((item) => item.type === 'subworkflow')) {
    if (node.workflowId === workflow.id) throw domainError('Workflow cannot directly invoke itself.', 'SUBWORKFLOW_RECURSION', 422);
    await readWorkflow(node.workflowId, node.workflowVersion, options.workflowsRoot);
  }
}

async function runAgentNode(runId, node, mappedInput, options) {
  return executeWithRetry(runId, node, async () => {
    const agentRun = await startAgentRun(node.agentId, mappedInput, { version: node.agentVersion, agentsRoot: options.agentsRoot, runsRoot: options.agentRunsRoot, logsRoot: options.agentLogsRoot, startRuntime: options.startRuntime });
    await updateWorkflowRun(runId, (current) => ({ nodes: { ...current.nodes, [node.id]: { ...current.nodes[node.id], agentRunId: agentRun.id } } }), options.workflowRunsRoot);
    const completed = await waitForAgentRun(agentRun.id, options);
    if (completed.status !== 'succeeded') throw domainError(completed.error?.message || 'Agent node failed.', completed.error?.code || 'WORKFLOW_AGENT_FAILED', 500);
    return completed.output;
  }, options.workflowRunsRoot);
}

async function runToolNode(runId, node, mappedInput, options) {
  return executeWithRetry(runId, node, async () => {
    try {
      const result = await executeTool(node.toolId, mappedInput, {
        version: node.toolVersion,
        toolsRoot: options.toolsRoot,
        policiesRoot: options.policiesRoot,
        policies: options.policies,
        fetchImpl: options.fetchImpl,
        env: options.env,
        mode: 'workflow',
        compatibilityMode: options.policyCompatibilityMode !== false,
        runContext: { runId, nodeId: node.id, workflowId: (await readWorkflowRun(runId, options.workflowRunsRoot)).workflowId, userId: options.userId || 'user_local' }
      });
      for (const event of result.auditEvents || []) await appendAudit(runId, event, options.workflowRunsRoot);
      if (result.policyDecision) {
        await appendTrace(runId, {
          nodeId: node.id,
          type: 'tool.call.completed',
          toolId: result.toolId,
          policyDecisions: [result.policyDecision.decisionId],
          riskFlags: result.policyDecision.riskLevel === 'low' ? [] : [result.policyDecision.riskLevel],
          payload: { toolId: result.toolId, toolVersion: result.toolVersion }
        }, options.tracesRoot);
      }
      return result.output;
    } catch (error) {
      for (const event of error.auditEvents || []) await appendAudit(runId, event, options.workflowRunsRoot);
      throw error;
    }
  }, options.workflowRunsRoot);
}

async function runSubworkflowNode(runId, parentWorkflow, node, mappedInput, options) {
  const depth = options.recursionDepth || 0;
  if (depth >= 5) throw domainError('Subworkflow depth limit exceeded.', 'SUBWORKFLOW_DEPTH_EXCEEDED', 409);
  const child = await startWorkflowRun(node.workflowId, mappedInput, { ...options, version: node.workflowVersion, recursionDepth: depth + 1, parentRunId: runId });
  await updateWorkflowRun(runId, (current) => ({ nodes: { ...current.nodes, [node.id]: { ...current.nodes[node.id], childWorkflowRunId: child.id } } }), options.workflowRunsRoot);
  const completed = await waitForWorkflowRun(child.id, options);
  if (completed.status !== 'succeeded') throw domainError(completed.error?.message || 'Subworkflow failed.', completed.error?.code || 'SUBWORKFLOW_FAILED', 500);
  return completed.output;
}

async function executeParallelBranch(runId, startId, joinId, workflow, context, outgoing, nodeMap, options) {
  let node = nodeMap.get(startId);
  let lastOutput;
  while (node && node.id !== joinId) {
    await markNodeRunning(runId, node, options);
    try {
      let output; let nextEdge;
      if (node.type === 'agent') { const input = resolveMapping(node.input, context); await setNodeInput(runId, node.id, input, options); output = await runAgentNode(runId, node, input, options); nextEdge = outgoing.get(node.id)?.[0]; }
      else if (node.type === 'tool') { const input = resolveMapping(node.input, context); await setNodeInput(runId, node.id, input, options); output = await runToolNode(runId, node, input, options); nextEdge = outgoing.get(node.id)?.[0]; }
      else if (node.type === 'subworkflow') { const input = resolveMapping(node.input, context); await setNodeInput(runId, node.id, input, options); output = await runSubworkflowNode(runId, workflow, node, input, options); nextEdge = outgoing.get(node.id)?.[0]; }
      else if (node.type === 'condition') { output = evaluateCondition(resolveReference(node.value, context), node.operator, node.compare); nextEdge = (outgoing.get(node.id) || []).find((edge) => edge.when === output); }
      else throw domainError(`Node type ${node.type} is not supported inside a parallel branch.`, 'PARALLEL_NODE_UNSUPPORTED', 422);
      context.nodes[node.id] = { output }; lastOutput = output;
      await markNodeSucceeded(runId, node.id, output, options);
      node = nextEdge ? nodeMap.get(nextEdge.to) : null;
    } catch (error) {
      await markNodeFailed(runId, node.id, error, options);
      throw error;
    }
  }
  if (!node || node.id !== joinId) throw domainError('Parallel branch did not reach its join node.', 'PARALLEL_JOIN_NOT_REACHED', 422);
  return lastOutput;
}

function isInsideParallelBranch(workflow, targetId) {
  const outgoing = new Map();
  for (const edge of workflow.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]);
  return workflow.nodes.filter((node) => node.type === 'parallel').some((parallel) => {
    const pending = [...(outgoing.get(parallel.id) || [])];
    const seen = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (id === parallel.joinId || seen.has(id)) continue;
      if (id === targetId) return true;
      seen.add(id);
      pending.push(...(outgoing.get(id) || []));
    }
    return false;
  });
}

async function waitForWorkflowRun(id, options) {
  while (true) {
    const run = await readWorkflowRun(id, options.workflowRunsRoot);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs || 25));
  }
}

async function waitForAgentRun(id, options) {
  while (true) {
    const run = await readAgentRun(id, options.agentRunsRoot);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs || 25));
  }
}

function resolveMapping(value, context) {
  if (typeof value === 'string') return resolveReference(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveMapping(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveMapping(item, context)]));
  return structuredClone(value);
}

function evaluateCondition(value, operator, compare) {
  if (operator === 'equals') return Object.is(value, compare);
  if (operator === 'notEquals') return !Object.is(value, compare);
  if (operator === 'exists') return value !== undefined && value !== null;
  return false;
}

function enforceWorkflowBudget(run, workflow, nextNode) {
  const elapsed = run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : 0;
  if (elapsed > workflow.limits.maxDurationMs) throw domainError('Workflow duration budget exceeded.', 'WORKFLOW_DURATION_EXCEEDED', 408);
  const agentRuns = Object.values(run.nodes).filter((node) => node.type === 'agent' && node.agentRunId).length;
  if (agentRuns >= workflow.limits.maxAgentRuns && nextNode.type === 'agent') {
    throw domainError('Workflow agent run budget exceeded.', 'WORKFLOW_AGENT_BUDGET_EXCEEDED', 409);
  }
  const toolRuns = (run.events || []).filter((event) => event.type === 'node.attempt' && run.nodes[event.nodeId]?.type === 'tool').length;
  if (toolRuns >= workflow.limits.maxToolRuns && nextNode.type === 'tool') throw domainError('Workflow tool run budget exceeded.', 'WORKFLOW_TOOL_BUDGET_EXCEEDED', 409);
}

async function waitForIssueStatus(ticketId, statuses, timeoutMs = 30 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const issue = await readIssue(ticketId);
    if (statuses.includes(issue.status)) return issue;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw domainError(`Feature ${ticketId} timed out.`, 'FEATURE_NODE_TIMEOUT', 408);
}

async function executeFeatureNode(node, context) {
  const ticketId = resolveReference(node.ticketId, context);
  let issue;
  if (node.action === 'intake') {
    const repo = resolveReference(node.repo || '$input.repo', context);
    issue = await readIssue(ticketId).catch(() => null);
    if (!issue) {
      issue = await addIssue({ ticketId, repo, title: resolveReference(node.title || '$input.title', context), confluencePageId: resolveReference(node.confluencePageId || '$input.confluencePageId', context), figmaUrl: resolveReference(node.figmaUrl || '$input.figmaUrl', context) });
    }
    if (issue.status === 'ADDED') await startIntake(issue.ticketId);
    issue = await waitForIssueStatus(ticketId, ['PLAN_READY', 'NEEDS_REFINEMENT', 'NEEDS_SPLIT', 'FAILED', 'BLOCKED'], node.timeoutMs);
  } else if (node.action === 'implement') {
    await proceedIssue(ticketId, { humanComment: resolveReference(node.humanComment || '$input.humanComment', context), allowDirty: false });
    issue = await waitForIssueStatus(ticketId, ['IMPLEMENTED', 'REVIEW_READY', 'FAILED', 'BLOCKED', 'CANCELED'], node.timeoutMs);
  } else if (node.action === 'review') {
    await startAiReview(ticketId);
    issue = await waitForIssueStatus(ticketId, ['REVIEW_READY', 'FIXING_REVIEW', 'FAILED', 'BLOCKED', 'CANCELED'], node.timeoutMs);
  } else if (node.action === 'approve') {
    issue = await approveIssue(ticketId, { approvalNote: resolveReference(node.note || '$input.approvalNote', context) || 'Approved in Feature Delivery workflow.' });
  } else if (node.action === 'commit') {
    issue = await commitFeature(ticketId, { message: resolveReference(node.message || '$input.commitMessage', context) });
  } else if (node.action === 'push') {
    issue = await pushFeature(ticketId);
  } else if (node.action === 'pr') {
    issue = await createDraftPullRequest(ticketId, { title: resolveReference(node.title || '$input.prTitle', context), body: resolveReference(node.body || '$input.prBody', context) });
  } else {
    issue = await waitForPullRequestChecks(ticketId, { timeoutMs: node.timeoutMs, intervalMs: node.intervalMs });
  }
  if (['FAILED', 'BLOCKED', 'CANCELED', 'NEEDS_REFINEMENT', 'NEEDS_SPLIT', 'FIXING_REVIEW'].includes(issue.status)) throw domainError(`Feature ${ticketId} stopped in ${issue.status}.`, 'FEATURE_NODE_BLOCKED', 409);
  return { ticketId: issue.ticketId, status: issue.status, featureFilePath: issue.featureFilePath, worktreePath: issue.worktreePath, reviewResultPath: issue.reviewResultPath || '', commitSha: issue.commitSha || '', pushedAt: issue.pushedAt || '', pullRequest: issue.pullRequest || null, ciStatus: issue.ciStatus || '' };
}

async function executeWithRetry(runId, node, operation, root) {
  const maxAttempts = node.retry?.maxAttempts || 1;
  const delayMs = node.retry?.delayMs || 0;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await appendAudit(runId, { type: 'node.attempt', nodeId: node.id, attempt, maxAttempts, at: new Date().toISOString() }, root);
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) throw error;
      await appendAudit(runId, { type: 'node.retry_scheduled', nodeId: node.id, attempt, delayMs, error: serialize(error), at: new Date().toISOString() }, root);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function appendAudit(id, event, root) {
  return updateWorkflowRun(id, (run) => ({ events: [...(run.events || []), event] }), root);
}

async function markNodeRunning(id, node, options) {
  const workflowRun = await readWorkflowRun(id, options.workflowRunsRoot);
  const maxAttempts = node.retry?.maxAttempts || 1;
  const nodeRun = await startNodeRun({ workflowRun, node, attempt: 1, maxAttempts }, options);
  const now = new Date().toISOString();
  return updateWorkflowRun(id, (run) => ({
    currentNodeId: node.id,
    nodes: { ...run.nodes, [node.id]: { ...run.nodes[node.id], status: 'running', nodeRunId: nodeRun.id, startedAt: now } },
    events: [...(run.events || []), { type: 'node.started', nodeId: node.id, nodeType: node.type, nodeRunId: nodeRun.id, at: now }]
  }), options.workflowRunsRoot);
}

async function setNodeInput(id, nodeId, input, options) {
  const run = await updateWorkflowRun(id, (current) => ({ nodes: { ...current.nodes, [nodeId]: { ...current.nodes[nodeId], input } } }), options.workflowRunsRoot);
  await setNodeRunInput(run.nodes[nodeId]?.nodeRunId, input, options);
  return run;
}

async function markNodeSucceeded(id, nodeId, output, options) {
  const now = new Date().toISOString();
  const run = await updateWorkflowRun(id, (current) => ({
    currentNodeId: null,
    nodes: { ...current.nodes, [nodeId]: { ...current.nodes[nodeId], status: 'succeeded', output, completedAt: now, durationMs: current.nodes[nodeId].startedAt ? Math.max(0, new Date(now) - new Date(current.nodes[nodeId].startedAt)) : null } },
    events: [...(current.events || []), { type: 'node.succeeded', nodeId, nodeRunId: current.nodes[nodeId]?.nodeRunId || null, at: now }]
  }), options.workflowRunsRoot);
  await completeNodeRun(run.nodes[nodeId]?.nodeRunId, output, options);
  return run;
}

async function markNodeFailed(id, nodeId, error, options) {
  const now = new Date().toISOString();
  const serialized = serialize(error);
  const run = await updateWorkflowRun(id, (current) => ({
    nodes: { ...current.nodes, [nodeId]: { ...current.nodes[nodeId], status: 'failed', error: serialized, completedAt: now, durationMs: current.nodes[nodeId].startedAt ? Math.max(0, new Date(now) - new Date(current.nodes[nodeId].startedAt)) : null } },
    events: [...(current.events || []), { type: 'node.failed', nodeId, nodeRunId: current.nodes[nodeId]?.nodeRunId || null, error: serialized, at: now }]
  }), options.workflowRunsRoot);
  await failNodeRun(run.nodes[nodeId]?.nodeRunId, error, options);
  return run;
}
function serialize(error) { return { code: error.code || 'WORKFLOW_RUN_FAILED', message: error.message, details: error.details || [] }; }
function domainError(message, code, status) { const error = new Error(message); error.code = code; error.status = status; return error; }

export { listWorkflowRuns, readWorkflowRun, reconcileWorkflowRuns };
