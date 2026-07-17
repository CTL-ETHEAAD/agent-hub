import {
  createNodeRun,
  readNodeRun,
  transitionNodeRun,
  updateNodeRun
} from './nodeRunStore.js';

export async function startNodeRun({ workflowRun, node, input = null, attempt = 1, maxAttempts = 1 }, options = {}) {
  const idempotencyKey = buildNodeRunKey(workflowRun.id, node.id, attempt);
  let run = await createNodeRun({ workflowRun, node, input, attempt, maxAttempts, idempotencyKey }, options.nodeRunsRoot);
  if (run.status === 'queued') run = await transitionNodeRun(run.id, 'running', {}, options.nodeRunsRoot);
  return run;
}

export async function setNodeRunInput(nodeRunId, input, options = {}) {
  if (!nodeRunId) return null;
  return updateNodeRun(nodeRunId, { input: structuredClone(input), inputRef: { kind: 'inline', value: structuredClone(input) } }, options.nodeRunsRoot);
}

export async function waitNodeRun(nodeRunId, { prompt = '' } = {}, options = {}) {
  if (!nodeRunId) return null;
  if (prompt) await setNodeRunInput(nodeRunId, { prompt }, options);
  return transitionNodeRun(nodeRunId, 'waiting', {}, options.nodeRunsRoot);
}

export async function completeNodeRun(nodeRunId, output, options = {}) {
  if (!nodeRunId) return null;
  return transitionNodeRun(nodeRunId, 'succeeded', {
    output: structuredClone(output),
    outputRef: { kind: 'inline', value: structuredClone(output) }
  }, options.nodeRunsRoot);
}

export async function failNodeRun(nodeRunId, error, options = {}) {
  if (!nodeRunId) return null;
  return transitionNodeRun(nodeRunId, 'failed', { error: serialize(error) }, options.nodeRunsRoot);
}

export async function cancelNodeRun(nodeRunId, options = {}) {
  if (!nodeRunId) return null;
  const run = await readNodeRun(nodeRunId, options.nodeRunsRoot);
  if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return run;
  return transitionNodeRun(nodeRunId, 'cancelled', {
    error: { code: 'NODE_RUN_CANCELLED', message: 'Cancelled by user.' }
  }, options.nodeRunsRoot);
}

export function buildNodeRunKey(workflowRunId, nodeId, attempt = 1) {
  return `${workflowRunId}:${nodeId}:attempt:${attempt}`;
}

function serialize(error) {
  if (!error) return { code: 'NODE_RUN_FAILED', message: 'Node run failed.' };
  return { code: error.code || 'NODE_RUN_FAILED', message: error.message || String(error), details: error.details || [] };
}
