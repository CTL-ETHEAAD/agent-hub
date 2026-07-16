import type { JsonSchema } from './types/common.js';
import type { ContractDiagnostic, NodeContract, WorkflowContractAnalysis } from './types/nodeContract.js';

export const NODE_CONTRACT_VERSION = 1;

type RuntimeNodeContract = Omit<NodeContract, 'type'>;
type WorkflowNodeLike = {
  id: string;
  type: string;
  input?: Record<string, unknown>;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  value?: unknown;
  output?: unknown;
};
type WorkflowLike = {
  inputSchema?: JsonSchema;
  nodes: WorkflowNodeLike[];
  edges: Array<{ from: string; to: string }>;
};
type ReferenceValue = { path: string; reference: string };

const CONTRACTS: Readonly<Record<string, RuntimeNodeContract>> = Object.freeze({
  start: contract('none', 'control', 0, 1),
  agent: contract('control', 'control', 1, 1, { configurableInput: true, risk: 'model' }),
  tool: contract('control', 'control', 1, 1, { configurableInput: true, risk: 'external-side-effect' }),
  condition: contract('control', 'branch', 1, 2),
  approval: contract('control', 'control', 1, 1, { risk: 'human-gate' }),
  feature: contract('control', 'control', 1, 1, { configurableInput: true, risk: 'repository-write' }),
  parallel: contract('control', 'branch', 1, Infinity),
  join: contract('branch', 'control', 2, 1),
  subworkflow: contract('control', 'control', 1, 1, { configurableInput: true }),
  end: contract('control', 'none', 1, 0)
});

export function getNodeContract(type: string): RuntimeNodeContract | null {
  const value = CONTRACTS[type];
  return value ? structuredClone(value) : null;
}

export function listNodeContracts(): NodeContract[] {
  return Object.entries(CONTRACTS).map(([type, value]) => ({ type, ...structuredClone(value) }));
}

export function analyzeWorkflowContracts(workflow: WorkflowLike): WorkflowContractAnalysis {
  const errors: ContractDiagnostic[] = [];
  const warnings: ContractDiagnostic[] = [];
  const nodes = new Map(workflow.nodes.map((node, index) => [node.id, { node, index }]));
  const predecessors = buildPredecessors(workflow.nodes, workflow.edges);

  for (const [index, node] of workflow.nodes.entries()) {
    const contractValue = CONTRACTS[node.type];
    if (!contractValue) continue;
    validateRequiredMappings(node, index, errors);
    for (const { path, reference } of collectReferences(node)) {
      validateReference({ reference, path: `nodes[${index}].${path}`, node, workflow, nodes, predecessors, errors, warnings });
    }
  }

  return { version: NODE_CONTRACT_VERSION, errors, warnings };
}

function contract(inputPort: RuntimeNodeContract['inputPort'], outputPort: RuntimeNodeContract['outputPort'], minIncoming: number, maxOutgoing: number, extra: Partial<RuntimeNodeContract> = {}): RuntimeNodeContract {
  return { inputPort, outputPort, minIncoming, maxOutgoing, ...extra };
}

function validateRequiredMappings(node: WorkflowNodeLike, index: number, errors: ContractDiagnostic[]): void {
  if (!node.inputSchema?.required?.length) return;
  const mapping = node.input;
  for (const key of node.inputSchema.required) {
    if (!mapping || !Object.hasOwn(mapping, key)) errors.push(issue(`nodes[${index}].input.${key}`, `Required input '${key}' is not mapped.`));
  }
}

function collectReferences(node: WorkflowNodeLike): ReferenceValue[] {
  const values: ReferenceValue[] = [];
  if (node.input) walk(node.input, 'input', values);
  if (node.type === 'condition') walk(node.value, 'value', values);
  if (node.type === 'end') walk(node.output, 'output', values);
  return values;
}

function walk(value: unknown, path: string, values: ReferenceValue[]): void {
  if (typeof value === 'string' && value.startsWith('$')) values.push({ path, reference: value });
  else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`, values));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, `${path}.${key}`, values));
}

function validateReference({ reference, path, node, workflow, nodes, predecessors, errors, warnings }: {
  reference: string;
  path: string;
  node: WorkflowNodeLike;
  workflow: WorkflowLike;
  nodes: Map<string, { node: WorkflowNodeLike; index: number }>;
  predecessors: Map<string, Set<string>>;
  errors: ContractDiagnostic[];
  warnings: ContractDiagnostic[];
}): void {
  const parts = reference.slice(1).split('.');
  if (parts.some((part) => !part)) {
    errors.push(issue(path, `Reference '${reference}' is malformed.`));
    return;
  }
  if (parts[0] === 'input') {
    const property = parts[1];
    const properties = workflow.inputSchema?.properties;
    if (property && properties && Object.keys(properties).length && !Object.hasOwn(properties, property)) {
      errors.push(issue(path, `Reference '${reference}' points to an unknown workflow input property.`));
    }
    return;
  }
  if (parts[0] !== 'nodes' || parts.length < 3 || parts[2] !== 'output') {
    errors.push(issue(path, `Reference '${reference}' must start with $input or $nodes.<nodeId>.output.`));
    return;
  }
  const sourceId = parts[1];
  if (!sourceId) {
    errors.push(issue(path, `Reference '${reference}' is missing a source node id.`));
    return;
  }
  const source = nodes.get(sourceId)?.node;
  if (!source) {
    errors.push(issue(path, `Reference '${reference}' points to an unknown node.`));
    return;
  }
  if (sourceId === node.id) {
    errors.push(issue(path, 'A node cannot reference its own output.'));
    return;
  }
  if (!predecessors.get(node.id)?.has(sourceId)) {
    errors.push(issue(path, `Node '${sourceId}' is not upstream of '${node.id}'.`));
    return;
  }
  const outputProperty = parts[3];
  const outputProperties = source.outputSchema?.properties;
  if (outputProperty && outputProperties && Object.keys(outputProperties).length && !Object.hasOwn(outputProperties, outputProperty)) {
    errors.push(issue(path, `Reference '${reference}' points to an unknown output property.`));
  } else if (outputProperty && !source.outputSchema) {
    warnings.push(issue(path, `Node '${sourceId}' has no outputSchema, so '${outputProperty}' cannot be checked statically.`));
  }
}

function buildPredecessors(nodes: WorkflowNodeLike[], edges: Array<{ from: string; to: string }>): Map<string, Set<string>> {
  const incoming = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) if (incoming.has(edge.to)) incoming.get(edge.to)?.push(edge.from);
  const result = new Map<string, Set<string>>();
  const visit = (id: string, visiting: Set<string> = new Set()): Set<string> => {
    if (result.has(id)) return result.get(id)!;
    if (visiting.has(id)) return new Set<string>();
    const nextVisiting = new Set(visiting).add(id);
    const values = new Set<string>();
    for (const parent of incoming.get(id) || []) {
      values.add(parent);
      for (const ancestor of visit(parent, nextVisiting)) values.add(ancestor);
    }
    result.set(id, values);
    return values;
  };
  for (const node of nodes) visit(node.id);
  return result;
}

function issue(path: string, message: string): ContractDiagnostic {
  return { path, message, source: 'node-contract-v1' };
}
