import type { JsonSchema, JsonValue, VersionedAsset } from './common.js';

export type ToolType = 'http' | 'mcp' | 'local';

export interface HttpToolConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  allowedHosts: string[];
  headers?: Record<string, string>;
}

export interface McpToolConfig {
  server: string;
  tool: string;
}

export interface LocalToolConfig {
  handler: string;
}

export interface ToolDefinition extends VersionedAsset {
  description?: string;
  type: ToolType;
  config: HttpToolConfig | McpToolConfig | LocalToolConfig;
  secretEnv: string[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface ToolExecutionResult {
  output: JsonValue;
  statusCode?: number;
  durationMs?: number;
}
