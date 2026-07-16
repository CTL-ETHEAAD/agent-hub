import { validateValueAgainstSchema } from './agentSchema.js';
import { readTool } from './toolStore.js';
import { prepareGovernedAction } from './kernel/executionKernel.js';

export async function executeTool(toolId, input, options = {}) {
  const tool = await readTool(toolId, options.version, options.toolsRoot);
  if (tool.status === 'archived') throw error('Archived tools cannot run.', 'TOOL_ARCHIVED', 409);
  validateValueAgainstSchema(input, tool.inputSchema, { label: 'input' });
  const governance = await evaluateToolGovernance(tool, options);
  if (governance?.decision?.effect === 'requires_approval') {
    const approval = error('Tool execution requires approval.', 'POLICY_APPROVAL_REQUIRED', 409);
    approval.policyDecision = governance.decision;
    approval.auditEvents = governance.events;
    throw approval;
  }
  if (tool.type === 'mcp') throw error('MCP execution requires a configured runtime adapter.', 'MCP_RUNTIME_NOT_CONFIGURED', 501);
  const output = await executeHttpTool(tool, input, options.fetchImpl || fetch, options.env || process.env);
  validateValueAgainstSchema(output, tool.outputSchema, { label: 'output' });
  return { toolId: tool.id, toolVersion: tool.version, output, policyDecision: governance?.decision || null, auditEvents: governance?.events || [] };
}

async function evaluateToolGovernance(tool, options) {
  if ((options.mode || 'test') === 'test' && !options.policyContext) return null;
  const runContext = options.runContext || {};
  return prepareGovernedAction({
    runId: runContext.runId || 'wrun_00000000-0000-0000-0000-000000000000',
    nodeId: runContext.nodeId || 'tool-test',
    subject: {
      userId: runContext.userId || 'user_local',
      agentId: runContext.agentId || '',
      workflowId: runContext.workflowId || ''
    },
    action: tool.type === 'mcp' ? 'mcp.call' : 'tool.call',
    resource: { type: 'tool', id: tool.id, version: tool.version },
    context: { tool: publicToolContext(tool) }
  }, {
    policyOptions: {
      policiesRoot: options.policiesRoot,
      policies: options.policies,
      compatibilityMode: options.compatibilityMode !== false
    },
    evaluateAction: options.evaluateAction
  });
}

function publicToolContext(tool) {
  return {
    type: tool.type,
    config: tool.type === 'http' ? { method: tool.config.method || 'GET', allowedHosts: tool.config.allowedHosts || [] } : { server: tool.config.server, tool: tool.config.tool },
    secretEnv: tool.secretEnv?.length ? tool.secretEnv.map(() => '[DECLARED]') : [],
    attestation: tool.attestation || tool.config?.attestation || null
  };
}

export async function executeHttpTool(tool, input, fetchImpl, env) {
  const url = renderTemplate(tool.config.url, input);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !tool.config.allowedHosts.includes(parsed.hostname)) throw error('Resolved endpoint is not allowed.', 'TOOL_ENDPOINT_NOT_ALLOWED', 403);
  const headers = Object.fromEntries(Object.entries(tool.config.headers || {}).map(([name, value]) => [name, resolveHeader(value, tool.secretEnv, env)]));
  const method = String(tool.config.method || 'GET').toUpperCase();
  const bodyValue = tool.config.body === undefined ? undefined : renderValue(tool.config.body, input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tool.timeoutMs);
  timer.unref();
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: bodyValue === undefined || method === 'GET' ? undefined : JSON.stringify(bodyValue),
      redirect: 'error',
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw error(`HTTP tool returned ${response.status}.`, 'TOOL_HTTP_ERROR', 502, { status: response.status, body: text.slice(0, 500) });
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) return JSON.parse(text || 'null');
    return { text };
  } finally {
    clearTimeout(timer);
  }
}

function renderValue(value, input) {
  if (typeof value === 'string') return renderTemplate(value, input);
  if (Array.isArray(value)) return value.map((item) => renderValue(item, input));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderValue(item, input)]));
  return value;
}

function renderTemplate(template, input) {
  return String(template).replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_, path) => {
    const value = path.split('.').reduce((current, key) => current?.[key], input);
    if (value === undefined || value === null) throw error(`Missing template value: ${path}`, 'TOOL_TEMPLATE_VALUE_MISSING', 422);
    return encodeURIComponent(String(value));
  });
}

function resolveHeader(value, declared, env) {
  const name = typeof value === 'string' ? value.match(/^\$env\.([A-Z][A-Z0-9_]*)$/)?.[1] : null;
  if (!name) return String(value);
  if (!declared.includes(name)) throw error('Secret is not declared by this tool.', 'TOOL_SECRET_NOT_DECLARED', 403);
  if (!env[name]) throw error(`Required secret ${name} is unavailable.`, 'TOOL_SECRET_MISSING', 422);
  return env[name];
}

function error(message, code, status, details) { const value = new Error(message); value.code = code; value.status = status; value.details = details ? [details] : []; return value; }
