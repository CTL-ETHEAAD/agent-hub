import { isIP } from 'node:net';
import { validateJsonSchema } from './agentSchema.js';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set(['draft', 'published', 'archived']);
const TYPES = new Set(['http', 'mcp']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export class ToolValidationError extends Error {
  constructor(message, details = [], code = 'TOOL_INVALID') {
    super(message);
    this.name = 'ToolValidationError';
    this.details = details;
    this.code = code;
    this.status = 422;
  }
}

export function normalizeTool(input, { now = new Date().toISOString() } = {}) {
  const value = structuredClone(input || {});
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    version: Number.isInteger(value.version) ? value.version : 1,
    status: value.status || 'draft',
    type: value.type || 'http',
    inputSchema: value.inputSchema || { type: 'object', properties: {} },
    outputSchema: value.outputSchema || { type: 'object', properties: {} },
    config: value.config || {},
    secretEnv: Array.isArray(value.secretEnv) ? [...new Set(value.secretEnv)] : [],
    timeoutMs: value.timeoutMs ?? 30_000,
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
    publishedAt: value.publishedAt || null
  };
}

export function validateTool(input) {
  const tool = normalizeTool(input);
  const details = [];
  if (!ID.test(tool.id)) details.push(item('id', 'Use lowercase letters, numbers, and hyphens.'));
  if (!tool.name) details.push(item('name', 'Name is required.'));
  if (!TYPES.has(tool.type)) details.push(item('type', 'Unsupported tool type.'));
  if (!STATUSES.has(tool.status)) details.push(item('status', 'Unsupported tool status.'));
  if (!Number.isInteger(tool.version) || tool.version < 1) details.push(item('version', 'Version must be a positive integer.'));
  if (!Number.isInteger(tool.timeoutMs) || tool.timeoutMs < 100 || tool.timeoutMs > 300_000) details.push(item('timeoutMs', 'Timeout must be between 100 and 300000 ms.'));
  if (tool.secretEnv.some((name) => !/^[A-Z][A-Z0-9_]*$/.test(name))) details.push(item('secretEnv', 'Secret names must be uppercase environment variable names.'));
  try { validateJsonSchema(tool.inputSchema, 'inputSchema'); } catch (error) { details.push(...error.details); }
  try { validateJsonSchema(tool.outputSchema, 'outputSchema'); } catch (error) { details.push(...error.details); }
  if (tool.type === 'http') validateHttpConfig(tool, details);
  if (tool.type === 'mcp') validateMcpConfig(tool, details);
  if (details.length) throw new ToolValidationError('Tool definition is invalid.', details);
  return tool;
}

function validateHttpConfig(tool, details) {
  const config = tool.config;
  let url;
  try { url = new URL(config.url || ''); } catch { details.push(item('config.url', 'HTTP tool requires a valid URL.')); return; }
  if (url.protocol !== 'https:') details.push(item('config.url', 'Only HTTPS endpoints are allowed.'));
  if (url.username || url.password) details.push(item('config.url', 'Credentials must not be embedded in URLs.'));
  if (isIP(url.hostname)) details.push(item('config.url', 'IP-literal endpoints are not allowed.'));
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) details.push(item('config.url', 'Local and internal hostnames are not allowed.'));
  if (!Array.isArray(config.allowedHosts) || !config.allowedHosts.includes(url.hostname)) details.push(item('config.allowedHosts', 'Endpoint hostname must be explicitly allowlisted.'));
  if (!METHODS.has(String(config.method || 'GET').toUpperCase())) details.push(item('config.method', 'Unsupported HTTP method.'));
  if (config.headers && (typeof config.headers !== 'object' || Array.isArray(config.headers))) details.push(item('config.headers', 'Headers must be an object.'));
  for (const [name, value] of Object.entries(config.headers || {})) {
    const secret = typeof value === 'string' ? value.match(/^\$env\.([A-Z][A-Z0-9_]*)$/)?.[1] : null;
    if (String(value).startsWith('$env.') && (!secret || !tool.secretEnv.includes(secret))) details.push(item('config.headers', 'Secret header must reference a declared secretEnv value.'));
    if (/^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(name) && !secret) details.push(item(`config.headers.${name}`, 'Sensitive headers must use a declared environment Secret reference.'));
  }
}

function validateMcpConfig(tool, details) {
  if (typeof tool.config.server !== 'string' || !tool.config.server.trim()) details.push(item('config.server', 'MCP tool requires a server name.'));
  if (typeof tool.config.tool !== 'string' || !tool.config.tool.trim()) details.push(item('config.tool', 'MCP tool requires a tool name.'));
}

function item(path, message) { return { path, message }; }
