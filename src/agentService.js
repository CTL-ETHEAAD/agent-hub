import { readFile } from 'node:fs/promises';
import { readAgent } from './agentStore.js';
import { validateValueAgainstSchema } from './agentSchema.js';
import { createAgentRun, listAgentRuns, readAgentRun, reconcileAgentRuns, transitionAgentRun } from './agentRunStore.js';
import { startAgentRuntime } from './agentRuntime.js';
import { appendTrace } from './trace/traceStore.js';

const activeRuns = new Map();

export async function startAgentRun(agentId, input, options = {}) {
  const agent = await readAgent(agentId, options.version, options.agentsRoot);
  if (agent.status === 'archived') {
    const error = new Error('Archived agents cannot run.');
    error.code = 'AGENT_ARCHIVED';
    error.status = 409;
    throw error;
  }
  validateValueAgainstSchema(input, agent.inputSchema, { label: 'input' });
  let run = await createAgentRun({
    agent,
    input,
    rootRunId: options.rootRunId || '',
    parentRunId: options.parentRunId || '',
    depth: options.depth || 0,
    delegationReason: options.delegationReason || ''
  }, options.runsRoot, options.logsRoot);
  await recordTrace(run, 'agent.run.queued', { agentId: agent.id, agentVersion: agent.version }, options);
  try {
    const runtime = await (options.startRuntime || startAgentRuntime)({ agent, input, run });
    run = await transitionAgentRun(run.id, 'running', { pid: runtime.pid }, options.runsRoot);
    await recordTrace(run, 'agent.run.started', { agentId: agent.id, agentVersion: agent.version }, options);
    activeRuns.set(run.id, runtime);
    void runtime.done.then(async (result) => {
      activeRuns.delete(run.id);
      const current = await readAgentRun(run.id, options.runsRoot).catch(() => null);
      if (!current || current.status === 'cancelled') return;
      if (result.code === 0) {
        try {
          validateValueAgainstSchema(result.output, agent.outputSchema, { label: 'output' });
          const completed = await transitionAgentRun(run.id, 'succeeded', { output: result.output, usage: result.usage || current.usage }, options.runsRoot);
          await recordTrace(completed, 'agent.run.completed', { agentId: agent.id, agentVersion: agent.version, latencyMs: completed.durationMs, payload: { status: completed.status, usage: completed.usage } }, options);
        } catch (error) {
          const failed = await transitionAgentRun(run.id, 'failed', { error: serializeError(error) }, options.runsRoot);
          await recordTrace(failed, 'agent.run.failed', { agentId: agent.id, agentVersion: agent.version, latencyMs: failed.durationMs, payload: { error: failed.error } }, options);
        }
      } else {
        const failed = await transitionAgentRun(run.id, 'failed', { error: { code: result.errorCode || 'AGENT_RUNTIME_FAILED', message: result.error || 'Agent runtime failed.' } }, options.runsRoot);
        await recordTrace(failed, 'agent.run.failed', { agentId: agent.id, agentVersion: agent.version, latencyMs: failed.durationMs, payload: { error: failed.error } }, options);
      }
    });
    return run;
  } catch (error) {
    const failed = await transitionAgentRun(run.id, 'failed', { error: serializeError(error) }, options.runsRoot);
    await recordTrace(failed, 'agent.run.failed', { agentId: agent.id, agentVersion: agent.version, latencyMs: failed.durationMs, payload: { error: failed.error } }, options);
    return failed;
  }
}

export async function cancelAgentRun(id, options = {}) {
  const run = await readAgentRun(id, options.runsRoot);
  if (run.status !== 'queued' && run.status !== 'running') {
    const error = new Error(`Run is already ${run.status}.`);
    error.code = 'AGENT_RUN_NOT_ACTIVE';
    error.status = 409;
    throw error;
  }
  activeRuns.get(id)?.cancel?.();
  activeRuns.delete(id);
  const cancelled = await transitionAgentRun(id, 'cancelled', {}, options.runsRoot);
  await recordTrace(cancelled, 'agent.run.cancelled', { agentId: cancelled.agentId, agentVersion: cancelled.agentVersion, latencyMs: cancelled.durationMs }, options);
  return cancelled;
}

export { listAgentRuns, readAgentRun, reconcileAgentRuns };

export async function readAgentRunLog(id, options = {}) {
  const run = await readAgentRun(id, options.runsRoot);
  return readFile(run.logPath, 'utf8').catch(() => '');
}

function serializeError(error) {
  return { code: error.code || 'AGENT_RUN_FAILED', message: error.message, details: error.details || [] };
}

async function recordTrace(run, type, event, options) {
  await appendTrace(run.id, { type, ...event }, options.tracesRoot).catch(() => {});
}
