export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type AssetStatus = 'draft' | 'published' | 'archived';
export type RunStatus =
  | 'queued'
  | 'claimed'
  | 'starting'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type NodeRunStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface VersionedAsset {
  id: string;
  name: string;
  version: number;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  archivedAt?: string;
  compatibility?: SchemaCompatibilityReport;
}

export interface SchemaCompatibilityChange {
  direction: 'input' | 'output';
  path: string;
  kind: 'required-added' | 'required-removed' | 'property-removed' | 'type-changed' | 'enum-narrowed' | 'additional-properties-restricted';
  breaking: boolean;
  message: string;
}

export interface SchemaCompatibilityReport {
  previousVersion: number | null;
  breaking: boolean;
  changes: SchemaCompatibilityChange[];
  checkedAt: string;
}

export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  default?: JsonValue;
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}
