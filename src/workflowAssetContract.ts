import type { JsonSchema } from './types/common.js';
import type { ContractDiagnostic } from './types/nodeContract.js';

type Asset = { id: string; version: number; inputSchema?: JsonSchema; outputSchema?: JsonSchema };
type AssetNode = {
  id: string;
  type: string;
  agentId?: string;
  agentVersion?: number;
  toolId?: string;
  toolVersion?: number;
  workflowId?: string;
  workflowVersion?: number;
  input?: Record<string, unknown>;
};
type AssetWorkflow = { nodes: AssetNode[] };

export interface WorkflowAssetResolver {
  resolveAgent(id: string, version?: number): Promise<Asset>;
  resolveTool(id: string, version?: number): Promise<Asset>;
  resolveWorkflow(id: string, version?: number): Promise<Asset>;
}

export interface WorkflowAssetAnalysis {
  errors: ContractDiagnostic[];
  warnings: ContractDiagnostic[];
  resolvedSchemas: Record<string, { inputSchema?: JsonSchema; outputSchema?: JsonSchema }>;
}

export async function analyzeWorkflowAssets(workflow: AssetWorkflow, resolver: WorkflowAssetResolver): Promise<WorkflowAssetAnalysis> {
  const errors: ContractDiagnostic[] = [];
  const warnings: ContractDiagnostic[] = [];
  const resolvedSchemas: WorkflowAssetAnalysis['resolvedSchemas'] = {};

  await Promise.all(workflow.nodes.map(async (node, index) => {
    const reference = assetReference(node);
    if (!reference) return;
    try {
      const asset = await reference.resolve(resolver);
      resolvedSchemas[node.id] = {
        ...(asset.inputSchema ? { inputSchema: asset.inputSchema } : {}),
        ...(asset.outputSchema ? { outputSchema: asset.outputSchema } : {})
      };
      for (const key of asset.inputSchema?.required || []) {
        if (!node.input || !Object.hasOwn(node.input, key)) errors.push(issue(`nodes[${index}].input.${key}`, `Required ${reference.kind} input '${key}' is not mapped.`));
      }
    } catch (error) {
      errors.push(issue(`nodes[${index}].${reference.field}`, `${reference.kind} '${reference.id}'${reference.version ? ` v${reference.version}` : ''} could not be resolved: ${error instanceof Error ? error.message : String(error)}`));
    }
  }));

  return { errors, warnings, resolvedSchemas };
}

function assetReference(node: AssetNode): {
  kind: 'Agent' | 'Tool' | 'Workflow';
  field: 'agentId' | 'toolId' | 'workflowId';
  id: string;
  version?: number;
  resolve(resolver: WorkflowAssetResolver): Promise<Asset>;
} | null {
  if (node.type === 'agent' && node.agentId) return { kind: 'Agent', field: 'agentId', id: node.agentId, ...(node.agentVersion ? { version: node.agentVersion } : {}), resolve: (resolver) => resolver.resolveAgent(node.agentId!, node.agentVersion) };
  if (node.type === 'tool' && node.toolId) return { kind: 'Tool', field: 'toolId', id: node.toolId, ...(node.toolVersion ? { version: node.toolVersion } : {}), resolve: (resolver) => resolver.resolveTool(node.toolId!, node.toolVersion) };
  if (node.type === 'subworkflow' && node.workflowId) return { kind: 'Workflow', field: 'workflowId', id: node.workflowId, ...(node.workflowVersion ? { version: node.workflowVersion } : {}), resolve: (resolver) => resolver.resolveWorkflow(node.workflowId!, node.workflowVersion) };
  return null;
}

function issue(path: string, message: string): ContractDiagnostic {
  return { path, message, source: 'node-contract-v1' };
}
