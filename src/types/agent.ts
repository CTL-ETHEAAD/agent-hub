import type { JsonObject, JsonSchema, JsonValue, RunStatus, Usage, VersionedAsset } from './common.js';

export type FilesystemPermission = 'deny' | 'read-only' | 'workspace-write';
export type NetworkPermission = 'deny' | 'allow';

export interface AgentPermissions {
  filesystem: FilesystemPermission;
  network: NetworkPermission;
  gitWrite: boolean;
}

export interface AgentLimits {
  timeoutMs: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxCostUsd?: number;
}

export interface AgentRuntimeConfig {
  provider: string;
  model: string;
  timeoutMs: number;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface AssetReference {
  id: string;
  version?: number;
}

export interface AgentDefinition extends VersionedAsset {
  description?: string;
  systemPrompt: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  runtime: AgentRuntimeConfig;
  permissions: AgentPermissions;
  limits: AgentLimits;
  skills: AssetReference[];
  tools: AssetReference[];
}

export interface AgentRun {
  id: string;
  agentId: string;
  agentVersion: number;
  status: RunStatus;
  input: JsonValue;
  output?: JsonValue;
  error?: string;
  pid?: string | number;
  rootRunId?: string;
  parentRunId?: string;
  workflowRunId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  usage?: Usage;
}

export interface RuntimeResult {
  code: number;
  output: JsonValue;
  usage?: Usage;
  error?: string;
}

export interface RuntimeHandle {
  pid: string | number;
  cancel(): void | Promise<void>;
  done: Promise<RuntimeResult>;
}

export interface RuntimeContext {
  agent: AgentDefinition;
  input: JsonValue;
  run: AgentRun;
}

export type AgentRuntimeAdapter = (context: RuntimeContext) => Promise<RuntimeHandle>;

export type AgentInput = JsonObject;
