import type { JsonObject, JsonSchema, JsonValue, RunStatus, VersionedAsset } from './common.js';

interface NodeBase {
  id: string;
  name?: string;
}

export interface StartNode extends NodeBase { type: 'start' }
export interface EndNode extends NodeBase { type: 'end'; output?: JsonValue }
export interface AgentNode extends NodeBase { type: 'agent'; agentId: string; agentVersion?: number; input?: JsonObject }
export interface ToolNode extends NodeBase { type: 'tool'; toolId: string; toolVersion?: number; input?: JsonObject }
export interface ConditionNode extends NodeBase { type: 'condition'; value: JsonValue; operator: 'equals' | 'notEquals' | 'truthy' | 'exists'; compare?: JsonValue }
export interface ParallelNode extends NodeBase { type: 'parallel' }
export interface JoinNode extends NodeBase { type: 'join'; strategy?: 'wait-all' | 'fail-fast' | 'partial' }
export interface ApprovalNode extends NodeBase { type: 'approval'; prompt: string }
export interface SubworkflowNode extends NodeBase { type: 'subworkflow'; workflowId: string; workflowVersion?: number; input?: JsonObject }
export interface FeatureNode extends NodeBase { type: 'feature'; action: string; [key: string]: JsonValue | undefined }

export type WorkflowNode = StartNode | EndNode | AgentNode | ToolNode | ConditionNode | ParallelNode | JoinNode | ApprovalNode | SubworkflowNode | FeatureNode;

export interface WorkflowEdge {
  from: string;
  to: string;
  when?: JsonValue;
}

export interface WorkflowDefinition extends VersionedAsset {
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  limits: { maxDurationMs: number; maxAgentRuns: number };
  ui?: { positions: Record<string, { x: number; y: number }> };
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: RunStatus;
  input: JsonValue;
  output?: JsonValue;
  currentNodeId?: string;
  parentRunId?: string;
  idempotencyKey?: string;
  nodes: Record<string, { status: RunStatus; output?: JsonValue; error?: string; attempts: number }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
