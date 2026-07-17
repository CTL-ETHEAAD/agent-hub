import type { JsonObject, JsonValue, NodeRunStatus } from './common.js';

export type NodeRunKind =
  | 'start'
  | 'agent'
  | 'tool'
  | 'subworkflow'
  | 'parallel'
  | 'join'
  | 'condition'
  | 'approval'
  | 'feature'
  | 'end';

export interface NodeRunError {
  code: string;
  message: string;
  details?: JsonValue;
}

export interface NodeRunRef {
  kind: 'inline' | 'artifact';
  value?: JsonValue;
  uri?: string;
}

export interface NodeRunEvent {
  type: string;
  at: string;
  status?: NodeRunStatus;
  attempt?: number;
  workerId?: string;
  leaseExpiresAt?: string | null;
  error?: NodeRunError | null;
  payload?: JsonObject;
}

export interface NodeRun {
  id: string;
  workflowRunId: string;
  workflowId: string;
  workflowVersion: number;
  nodeId: string;
  nodeType: NodeRunKind;
  nodeSnapshot: JsonObject;
  status: NodeRunStatus;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
  input: JsonValue | null;
  inputRef: NodeRunRef | null;
  output: JsonValue | null;
  outputRef: NodeRunRef | null;
  error: NodeRunError | null;
  workerId: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  events: NodeRunEvent[];
}
