import type { JsonValue } from './common.js';

export interface TraceEvent {
  id: string;
  runId: string;
  timestamp: string;
  type: string;
  nodeId?: string;
  agentId?: string;
  toolId?: string;
  durationMs?: number;
  payload?: JsonValue;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: string;
  actor?: string;
  runId?: string;
  payload: JsonValue;
}
