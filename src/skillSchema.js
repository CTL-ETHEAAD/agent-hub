const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set(['draft', 'published', 'archived']);
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const SCHEMA_KEYS = new Set(['type', 'required', 'properties', 'items', 'enum', 'description']);
const SKILL_KEYS = new Set(['id', 'name', 'description', 'version', 'status', 'inputSchema', 'outputSchema', 'allowedTools', 'riskNotes', 'instructionPath', 'createdAt', 'updatedAt', 'publishedAt']);

export class SkillValidationError extends Error {
  constructor(message, details = [], code = 'SKILL_INVALID') {
    super(message);
    this.name = 'SkillValidationError';
    this.code = code;
    this.details = details;
    this.status = 422;
  }
}

export function normalizeSkillDefinition(input, { now = new Date().toISOString() } = {}) {
  const value = structuredClone(input || {});
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    version: Number.isInteger(value.version) ? value.version : 1,
    status: value.status || 'draft',
    inputSchema: value.inputSchema || { type: 'object', properties: {} },
    outputSchema: value.outputSchema || { type: 'object', properties: {} },
    allowedTools: Array.isArray(value.allowedTools) ? [...new Set(value.allowedTools)] : [],
    riskNotes: Array.isArray(value.riskNotes) ? value.riskNotes.map((note) => typeof note === 'string' ? note.trim() : note) : [],
    instructionPath: typeof value.instructionPath === 'string' ? value.instructionPath.trim() : '',
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
    publishedAt: value.publishedAt || null
  };
}

export function validateSkillDefinition(input) {
  const skill = normalizeSkillDefinition(input);
  const details = [];
  for (const key of Object.keys(input || {})) if (!SKILL_KEYS.has(key)) details.push(field(key, 'Unknown skill field.'));
  if (!SKILL_ID_PATTERN.test(skill.id)) details.push(field('id', 'Use lowercase letters, numbers, and hyphens.'));
  if (!skill.name) details.push(field('name', 'Name is required.'));
  if (!skill.description) details.push(field('description', 'Description is required.'));
  if (!Number.isInteger(skill.version) || skill.version < 1) details.push(field('version', 'Version must be a positive integer.'));
  if (!STATUSES.has(skill.status)) details.push(field('status', 'Unsupported skill status.'));
  if (!skill.instructionPath) details.push(field('instructionPath', 'Instruction path is required.'));
  if (skill.instructionPath.startsWith('/') || skill.instructionPath.includes('..')) details.push(field('instructionPath', 'Use a relative path inside the Skill asset directory.'));
  if (skill.allowedTools.some((tool) => typeof tool !== 'string' || !tool.trim())) details.push(field('allowedTools', 'Tools must be non-empty strings.'));
  if (skill.riskNotes.some((note) => typeof note !== 'string' || !note)) details.push(field('riskNotes', 'Risk notes must be non-empty strings.'));
  validateSchema(skill.inputSchema, 'inputSchema', details);
  validateSchema(skill.outputSchema, 'outputSchema', details);
  if (details.length) throw new SkillValidationError('Skill definition is invalid.', details);
  return skill;
}

function validateSchema(schema, path, details) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return details.push(field(path, 'Schema must be an object.'));
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) details.push(field(`${path}.${key}`, 'Unsupported schema keyword.'));
  if (!SCHEMA_TYPES.has(schema.type)) details.push(field(`${path}.type`, 'Unsupported or missing schema type.'));
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.length)) details.push(field(`${path}.enum`, 'enum must be a non-empty array.'));
  if (schema.type === 'object') {
    if (schema.properties && (typeof schema.properties !== 'object' || Array.isArray(schema.properties))) details.push(field(`${path}.properties`, 'properties must be an object.'));
    else for (const [key, child] of Object.entries(schema.properties || {})) validateSchema(child, `${path}.properties.${key}`, details);
    if (schema.required && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string'))) details.push(field(`${path}.required`, 'required must be an array of property names.'));
  }
  if (schema.type === 'array') {
    if (!schema.items) details.push(field(`${path}.items`, 'Array schema requires items.'));
    else validateSchema(schema.items, `${path}.items`, details);
  }
}

function field(path, message) { return { path, message }; }
