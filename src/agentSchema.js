const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set(['draft', 'published', 'archived']);
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const FILESYSTEM_PERMISSIONS = new Set(['deny', 'read-only', 'workspace-write']);
const NETWORK_PERMISSIONS = new Set(['deny', 'allow']);
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const SCHEMA_KEYS = new Set(['type', 'required', 'properties', 'items', 'enum', 'description']);
const MAX_PROMPT_LENGTH = 100_000;
const MAX_SCHEMA_LENGTH = 100_000;
const AGENT_KEYS = new Set(['id', 'name', 'description', 'version', 'status', 'systemPrompt', 'runtime', 'inputSchema', 'outputSchema', 'skills', 'tools', 'permissions', 'limits', 'createdAt', 'updatedAt', 'publishedAt']);

export class AgentValidationError extends Error {
  constructor(message, details = [], code = 'AGENT_INVALID') {
    super(message);
    this.name = 'AgentValidationError';
    this.code = code;
    this.details = details;
    this.status = 422;
  }
}

export function normalizeAgentDefinition(input, { now = new Date().toISOString() } = {}) {
  const value = structuredClone(input || {});
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    version: Number.isInteger(value.version) ? value.version : 1,
    status: value.status || 'draft',
    systemPrompt: typeof value.systemPrompt === 'string' ? value.systemPrompt : '',
    runtime: {
      provider: value.runtime?.provider || 'claude-code',
      model: value.runtime?.model || '',
      baseUrl: typeof value.runtime?.baseUrl === 'string' ? value.runtime.baseUrl.trim() : '',
      apiKeyEnv: typeof value.runtime?.apiKeyEnv === 'string' ? value.runtime.apiKeyEnv.trim() : '',
      timeoutMs: value.runtime?.timeoutMs ?? 600_000
    },
    inputSchema: value.inputSchema || { type: 'object', properties: {} },
    outputSchema: value.outputSchema || { type: 'object', properties: {} },
    skills: Array.isArray(value.skills) ? value.skills.map((skill) => ({
      id: typeof skill?.id === 'string' ? skill.id.trim().toLowerCase() : '',
      version: Number.isInteger(skill?.version) ? skill.version : 1
    })) : [],
    tools: Array.isArray(value.tools) ? [...new Set(value.tools)] : [],
    permissions: {
      filesystem: value.permissions?.filesystem || 'deny',
      network: value.permissions?.network || 'deny',
      gitWrite: value.permissions?.gitWrite === true
    },
    limits: {
      maxTurns: value.limits?.maxTurns ?? 20,
      maxCostUsd: value.limits?.maxCostUsd ?? 1
    },
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
    publishedAt: value.publishedAt || null
  };
}

export function validateAgentDefinition(input) {
  const agent = normalizeAgentDefinition(input);
  const details = [];
  for (const key of Object.keys(input || {})) {
    if (!AGENT_KEYS.has(key)) details.push(field(key, 'Unknown agent field.'));
  }
  if (!AGENT_ID_PATTERN.test(agent.id)) details.push(field('id', 'Use lowercase letters, numbers, and hyphens.'));
  if (!agent.name) details.push(field('name', 'Name is required.'));
  if (!agent.systemPrompt.trim()) details.push(field('systemPrompt', 'System prompt is required.'));
  if (agent.systemPrompt.length > MAX_PROMPT_LENGTH) details.push(field('systemPrompt', 'System prompt is too large.'));
  if (!Number.isInteger(agent.version) || agent.version < 1) details.push(field('version', 'Version must be a positive integer.'));
  if (!STATUSES.has(agent.status)) details.push(field('status', 'Unsupported agent status.'));
  if (!PROVIDER_ID_PATTERN.test(agent.runtime.provider)) details.push(field('runtime.provider', 'Use a registered provider id.'));
  if (agent.runtime.baseUrl && !/^https:\/\//.test(agent.runtime.baseUrl)) details.push(field('runtime.baseUrl', 'Base URL must use HTTPS.'));
  if (agent.runtime.apiKeyEnv && !/^[A-Z][A-Z0-9_]*$/.test(agent.runtime.apiKeyEnv)) details.push(field('runtime.apiKeyEnv', 'Use an environment variable name.'));
  if (!Number.isInteger(agent.runtime.timeoutMs) || agent.runtime.timeoutMs < 1_000 || agent.runtime.timeoutMs > 3_600_000) {
    details.push(field('runtime.timeoutMs', 'Timeout must be between 1000 and 3600000 ms.'));
  }
  if (!FILESYSTEM_PERMISSIONS.has(agent.permissions.filesystem)) details.push(field('permissions.filesystem', 'Unsupported filesystem permission.'));
  if (!NETWORK_PERMISSIONS.has(agent.permissions.network)) details.push(field('permissions.network', 'Unsupported network permission.'));
  if (!Number.isInteger(agent.limits.maxTurns) || agent.limits.maxTurns < 1 || agent.limits.maxTurns > 100) {
    details.push(field('limits.maxTurns', 'maxTurns must be between 1 and 100.'));
  }
  if (typeof agent.limits.maxCostUsd !== 'number' || agent.limits.maxCostUsd <= 0 || agent.limits.maxCostUsd > 100) {
    details.push(field('limits.maxCostUsd', 'maxCostUsd must be between 0 and 100.'));
  }
  if (agent.tools.some((tool) => typeof tool !== 'string' || !tool.trim())) details.push(field('tools', 'Tools must be non-empty strings.'));
  if (agent.skills.some((skill) => !AGENT_ID_PATTERN.test(skill.id) || !Number.isInteger(skill.version) || skill.version < 1)) {
    details.push(field('skills', 'Skills must use a valid id and positive integer version.'));
  }
  if (new Set(agent.skills.map((skill) => `${skill.id}@${skill.version}`)).size !== agent.skills.length) details.push(field('skills', 'Skill references must be unique.'));
  validateSchemaDefinition(agent.inputSchema, 'inputSchema', details);
  validateSchemaDefinition(agent.outputSchema, 'outputSchema', details);
  if (JSON.stringify(agent.inputSchema).length > MAX_SCHEMA_LENGTH) details.push(field('inputSchema', 'Schema is too large.'));
  if (JSON.stringify(agent.outputSchema).length > MAX_SCHEMA_LENGTH) details.push(field('outputSchema', 'Schema is too large.'));
  if (details.length) throw new AgentValidationError('Agent definition is invalid.', details);
  return agent;
}

export function validateValueAgainstSchema(value, schema, { label = 'value' } = {}) {
  const details = [];
  validateSchemaDefinition(schema, 'schema', details);
  if (!details.length) validateSchemaValue(value, schema, label, details);
  if (details.length) throw new AgentValidationError(`${label} does not match schema.`, details, label === 'output' ? 'AGENT_OUTPUT_INVALID' : 'AGENT_INPUT_INVALID');
  return value;
}

export function validateJsonSchema(schema, label = 'schema') {
  const details = [];
  validateSchemaDefinition(schema, label, details);
  if (details.length) throw new AgentValidationError(`${label} is invalid.`, details);
  return schema;
}

function validateSchemaDefinition(schema, path, details) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    details.push(field(path, 'Schema must be an object.'));
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYS.has(key)) details.push(field(`${path}.${key}`, 'Unsupported schema keyword.'));
  }
  if (!SCHEMA_TYPES.has(schema.type)) details.push(field(`${path}.type`, 'Unsupported or missing schema type.'));
  if (schema.enum && (!Array.isArray(schema.enum) || schema.enum.length === 0)) details.push(field(`${path}.enum`, 'enum must be a non-empty array.'));
  if (schema.type === 'object') {
    if (schema.properties && (typeof schema.properties !== 'object' || Array.isArray(schema.properties))) {
      details.push(field(`${path}.properties`, 'properties must be an object.'));
    } else {
      for (const [key, child] of Object.entries(schema.properties || {})) validateSchemaDefinition(child, `${path}.properties.${key}`, details);
    }
    if (schema.required && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string'))) {
      details.push(field(`${path}.required`, 'required must be an array of property names.'));
    }
  }
  if (schema.type === 'array') {
    if (!schema.items) details.push(field(`${path}.items`, 'Array schema requires items.'));
    else validateSchemaDefinition(schema.items, `${path}.items`, details);
  }
}

function validateSchemaValue(value, schema, path, details) {
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) details.push(field(path, 'Value is not in enum.'));
  const typeMatches = {
    object: value !== null && typeof value === 'object' && !Array.isArray(value),
    array: Array.isArray(value),
    string: typeof value === 'string',
    number: typeof value === 'number' && Number.isFinite(value),
    integer: Number.isInteger(value),
    boolean: typeof value === 'boolean',
    null: value === null
  }[schema.type];
  if (!typeMatches) {
    details.push(field(path, `Expected ${schema.type}.`));
    return;
  }
  if (schema.type === 'object') {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) details.push(field(`${path}.${key}`, 'Required value is missing.'));
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validateSchemaValue(value[key], child, `${path}.${key}`, details);
    }
  }
  if (schema.type === 'array') value.forEach((item, index) => validateSchemaValue(item, schema.items, `${path}[${index}]`, details));
}

function field(path, message) {
  return { path, message };
}
