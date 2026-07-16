import { validateJsonSchema } from './agentSchema.js';
import { analyzeWorkflowContracts, NODE_CONTRACT_VERSION } from './workflowNodeContract.js';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID = /^[a-zA-Z0-9_-]+$/;
const TYPES = new Set(['start', 'agent', 'tool', 'condition', 'approval', 'feature', 'parallel', 'join', 'subworkflow', 'end']);
const STATUSES = new Set(['draft', 'published', 'archived']);
const OPERATORS = new Set(['equals', 'notEquals', 'exists']);

export class WorkflowValidationError extends Error {
  constructor(message, details = [], code = 'WORKFLOW_INVALID') {
    super(message);
    this.name = 'WorkflowValidationError';
    this.code = code;
    this.details = details;
    this.status = 422;
  }
}

export function normalizeWorkflow(input, { now = new Date().toISOString() } = {}) {
  const value = structuredClone(input || {});
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    version: Number.isInteger(value.version) ? value.version : 1,
    status: value.status || 'draft',
    contractVersion: Number.isInteger(value.contractVersion) ? value.contractVersion : NODE_CONTRACT_VERSION,
    inputSchema: value.inputSchema || { type: 'object', properties: {} },
    nodes: Array.isArray(value.nodes) ? value.nodes : [],
    edges: Array.isArray(value.edges) ? value.edges : [],
    limits: {
      maxDurationMs: value.limits?.maxDurationMs ?? 3_600_000,
      maxAgentRuns: value.limits?.maxAgentRuns ?? 20,
      maxToolRuns: value.limits?.maxToolRuns ?? 50
    },
    ui: { positions: value.ui?.positions || {} },
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
    publishedAt: value.publishedAt || null
  };
}

export function validateWorkflow(input) {
  const workflow = normalizeWorkflow(input);
  const details = [];
  if (!ID.test(workflow.id)) details.push(issue('id', 'Use lowercase letters, numbers, and hyphens.'));
  if (!workflow.name) details.push(issue('name', 'Name is required.'));
  if (!Number.isInteger(workflow.version) || workflow.version < 1) details.push(issue('version', 'Version must be a positive integer.'));
  if (!STATUSES.has(workflow.status)) details.push(issue('status', 'Unsupported status.'));
  if (workflow.contractVersion !== NODE_CONTRACT_VERSION) details.push(issue('contractVersion', `Only Node Contract v${NODE_CONTRACT_VERSION} is supported.`));
  if (!Number.isInteger(workflow.limits.maxDurationMs) || workflow.limits.maxDurationMs < 1_000 || workflow.limits.maxDurationMs > 86_400_000) details.push(issue('limits.maxDurationMs', 'maxDurationMs must be between 1000 and 86400000.'));
  if (!Number.isInteger(workflow.limits.maxAgentRuns) || workflow.limits.maxAgentRuns < 0 || workflow.limits.maxAgentRuns > 100) details.push(issue('limits.maxAgentRuns', 'maxAgentRuns must be between 0 and 100.'));
  if (!Number.isInteger(workflow.limits.maxToolRuns) || workflow.limits.maxToolRuns < 0 || workflow.limits.maxToolRuns > 500) details.push(issue('limits.maxToolRuns', 'maxToolRuns must be between 0 and 500.'));
  if (workflow.nodes.length > 100) details.push(issue('nodes', 'Workflow cannot exceed 100 nodes.'));
  for (const [nodeId, position] of Object.entries(workflow.ui.positions)) {
    if (!NODE_ID.test(nodeId) || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) details.push(issue(`ui.positions.${nodeId}`, 'Position requires finite x and y values.'));
  }
  try { validateJsonSchema(workflow.inputSchema, 'inputSchema'); } catch (error) { details.push(...error.details); }

  const ids = new Set();
  for (const [index, node] of workflow.nodes.entries()) {
    const base = `nodes[${index}]`;
    if (!NODE_ID.test(node?.id || '')) details.push(issue(`${base}.id`, 'Invalid node id.'));
    if (ids.has(node?.id)) details.push(issue(`${base}.id`, 'Node id must be unique.'));
    ids.add(node?.id);
    if (!TYPES.has(node?.type)) details.push(issue(`${base}.type`, 'Unsupported node type.'));
    if (node?.type === 'agent' && !ID.test(node.agentId || '')) details.push(issue(`${base}.agentId`, 'Agent node requires a valid agentId.'));
    if (node?.type === 'agent' && (node.input === null || typeof node.input !== 'object' || Array.isArray(node.input))) details.push(issue(`${base}.input`, 'Agent input mapping must be an object.'));
    if (node?.type === 'tool' && !ID.test(node.toolId || '')) details.push(issue(`${base}.toolId`, 'Tool node requires a valid toolId.'));
    if (node?.type === 'tool' && (node.input === null || typeof node.input !== 'object' || Array.isArray(node.input))) details.push(issue(`${base}.input`, 'Tool input mapping must be an object.'));
    if (node?.type === 'parallel' && !NODE_ID.test(node.joinId || '')) details.push(issue(`${base}.joinId`, 'Parallel node requires a joinId.'));
    if (node?.type === 'subworkflow' && !ID.test(node.workflowId || '')) details.push(issue(`${base}.workflowId`, 'Subworkflow node requires a workflowId.'));
    if (node?.type === 'subworkflow' && (node.input === null || typeof node.input !== 'object' || Array.isArray(node.input))) details.push(issue(`${base}.input`, 'Subworkflow input mapping must be an object.'));
    if (node?.type === 'condition') {
      if (typeof node.value !== 'string' || !node.value.startsWith('$')) details.push(issue(`${base}.value`, 'Condition value must be a reference.'));
      if (!OPERATORS.has(node.operator)) details.push(issue(`${base}.operator`, 'Unsupported condition operator.'));
    }
    if (node?.type === 'approval' && typeof node.prompt !== 'string') details.push(issue(`${base}.prompt`, 'Approval node requires a prompt.'));
    if (node?.type === 'feature' && (typeof node.ticketId !== 'string' || !node.ticketId.startsWith('$'))) details.push(issue(`${base}.ticketId`, 'Feature node ticketId must be a reference.'));
    if (node?.type === 'feature' && !['intake', 'implement', 'review', 'approve', 'commit', 'push', 'pr', 'ci'].includes(node.action)) details.push(issue(`${base}.action`, 'Unsupported Feature action.'));
    if (node?.retry !== undefined) {
      if (!Number.isInteger(node.retry?.maxAttempts) || node.retry.maxAttempts < 1 || node.retry.maxAttempts > 5) details.push(issue(`${base}.retry.maxAttempts`, 'maxAttempts must be between 1 and 5.'));
      if (!Number.isInteger(node.retry?.delayMs) || node.retry.delayMs < 0 || node.retry.delayMs > 60000) details.push(issue(`${base}.retry.delayMs`, 'delayMs must be between 0 and 60000.'));
    }
  }
  const starts = workflow.nodes.filter((node) => node.type === 'start');
  const ends = workflow.nodes.filter((node) => node.type === 'end');
  if (starts.length !== 1) details.push(issue('nodes', 'Workflow requires exactly one start node.'));
  if (ends.length < 1) details.push(issue('nodes', 'Workflow requires at least one end node.'));
  const outgoing = new Map();
  const incoming = new Map();
  for (const [index, edge] of workflow.edges.entries()) {
    if (!ids.has(edge?.from)) details.push(issue(`edges[${index}].from`, 'Unknown source node.'));
    if (!ids.has(edge?.to)) details.push(issue(`edges[${index}].to`, 'Unknown target node.'));
    if (edge?.from === edge?.to) details.push(issue(`edges[${index}]`, 'Self edges are not allowed.'));
    const list = outgoing.get(edge?.from) || [];
    list.push(edge);
    outgoing.set(edge?.from, list);
    incoming.set(edge?.to, [...(incoming.get(edge?.to) || []), edge]);
  }
  for (const node of workflow.nodes) {
    const edges = outgoing.get(node.id) || [];
    if (node.type === 'end' && edges.length) details.push(issue(`nodes.${node.id}`, 'End nodes cannot have outgoing edges.'));
    if (!['condition', 'parallel', 'end'].includes(node.type) && edges.length !== 1) details.push(issue(`nodes.${node.id}`, 'Node requires exactly one outgoing edge.'));
    if (node.type === 'condition') {
      const branches = new Set(edges.map((edge) => edge.when));
      if (edges.length !== 2 || !branches.has(true) || !branches.has(false)) details.push(issue(`nodes.${node.id}`, 'Condition requires true and false edges.'));
    }
    if (node.type === 'parallel' && edges.length < 2) details.push(issue(`nodes.${node.id}`, 'Parallel node requires at least two outgoing branches.'));
    if (node.type === 'parallel' && !ids.has(node.joinId)) details.push(issue(`nodes.${node.id}.joinId`, 'Parallel joinId must reference a node.'));
    if (node.type === 'parallel' && workflow.nodes.find((candidate) => candidate.id === node.joinId)?.type !== 'join') details.push(issue(`nodes.${node.id}.joinId`, 'Parallel joinId must reference a Join node.'));
    if (node.type === 'parallel') {
      const labels = edges.map((edge) => edge.label).filter(Boolean);
      if (new Set(labels).size !== labels.length) details.push(issue(`nodes.${node.id}`, 'Parallel branch labels must be unique.'));
    }
    if (node.type === 'join' && (incoming.get(node.id) || []).length < 2) details.push(issue(`nodes.${node.id}`, 'Join node requires at least two incoming branches.'));
  }
  if (!details.length && starts[0]) detectCycleAndReachability(starts[0].id, workflow.nodes, outgoing, details);
  if (!details.length) details.push(...analyzeWorkflowContracts(workflow).errors);
  if (details.length) throw new WorkflowValidationError('Workflow definition is invalid.', details);
  return workflow;
}

export function resolveReference(reference, context) {
  if (typeof reference !== 'string' || !reference.startsWith('$')) return structuredClone(reference);
  const parts = reference.slice(1).split('.');
  let value = context;
  for (const part of parts) value = value?.[part];
  return structuredClone(value);
}

function detectCycleAndReachability(start, nodes, outgoing, details) {
  const visiting = new Set();
  const visited = new Set();
  const walk = (id) => {
    if (visiting.has(id)) { details.push(issue('edges', 'Workflow graph contains a cycle.')); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) || []) walk(edge.to);
    visiting.delete(id);
    visited.add(id);
  };
  walk(start);
  for (const node of nodes) if (!visited.has(node.id)) details.push(issue(`nodes.${node.id}`, 'Node is unreachable from start.'));
}

function issue(path, message) { return { path, message }; }
