import { validateJsonSchema } from './agentSchema.js';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATUSES = new Set(['draft', 'published', 'archived']);
const PRIORITIES = new Set(['must', 'should', 'could']);
const VERIFICATIONS = new Set(['manual', 'test', 'trace', 'review']);
const RISK_LEVELS = new Set(['low', 'medium', 'high']);

export class SpecValidationError extends Error {
  constructor(message, details = [], code = 'SPEC_INVALID') {
    super(message);
    this.name = 'SpecValidationError';
    this.code = code;
    this.details = details;
    this.status = 422;
  }
}

export function normalizeSpec(input, { now = new Date().toISOString() } = {}) {
  const value = structuredClone(input || {});
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
    version: Number.isInteger(value.version) ? value.version : 1,
    status: value.status || 'draft',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    goal: typeof value.goal === 'string' ? value.goal.trim() : '',
    background: typeof value.background === 'string' ? value.background.trim() : '',
    requirements: Array.isArray(value.requirements) ? value.requirements.map(normalizeRequirement) : [],
    acceptanceCriteria: Array.isArray(value.acceptanceCriteria) ? value.acceptanceCriteria.map(normalizeAcceptanceCriterion) : [],
    constraints: normalizeConstraints(value.constraints),
    workflowHints: normalizeWorkflowHints(value.workflowHints),
    inputSchema: value.inputSchema || { type: 'object', properties: {} },
    metadata: value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) ? value.metadata : {},
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
    publishedAt: value.publishedAt || null
  };
}

export function validateSpec(input) {
  const spec = normalizeSpec(input);
  const details = [];
  if (!ID.test(spec.id)) details.push(issue('id', 'Use lowercase letters, numbers, and hyphens.'));
  if (!spec.name) details.push(issue('name', 'Name is required.'));
  if (!Number.isInteger(spec.version) || spec.version < 1) details.push(issue('version', 'Version must be a positive integer.'));
  if (!STATUSES.has(spec.status)) details.push(issue('status', 'Unsupported status.'));
  if (!spec.goal) details.push(issue('goal', 'Goal is required.'));
  if (!spec.requirements.length) details.push(issue('requirements', 'At least one requirement is required.'));
  if (!spec.acceptanceCriteria.length) details.push(issue('acceptanceCriteria', 'At least one acceptance criterion is required.'));
  validateRequirements(spec.requirements, details);
  validateAcceptanceCriteria(spec.acceptanceCriteria, details);
  validateConstraints(spec.constraints, details);
  validateWorkflowHints(spec.workflowHints, details);
  try { validateJsonSchema(spec.inputSchema, 'inputSchema'); } catch (error) { details.push(...error.details); }
  if (details.length) throw new SpecValidationError('Spec definition is invalid.', details);
  return spec;
}

function normalizeRequirement(value = {}) {
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    title: typeof value.title === 'string' ? value.title.trim() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    priority: value.priority || 'must'
  };
}

function normalizeAcceptanceCriterion(value = {}) {
  return {
    id: typeof value.id === 'string' ? value.id.trim().toLowerCase() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    verification: value.verification || 'manual'
  };
}

function normalizeConstraints(value = {}) {
  return {
    allowedRepos: strings(value.allowedRepos),
    allowedTools: strings(value.allowedTools),
    riskLevel: value.riskLevel || 'medium'
  };
}

function normalizeWorkflowHints(value = {}) {
  return {
    preferredWorkflowId: typeof value.preferredWorkflowId === 'string' ? value.preferredWorkflowId.trim().toLowerCase() : '',
    requiredAgents: strings(value.requiredAgents),
    requiredSkills: strings(value.requiredSkills)
  };
}

function validateRequirements(requirements, details) {
  const ids = new Set();
  for (const [index, requirement] of requirements.entries()) {
    const base = `requirements[${index}]`;
    if (!ID.test(requirement.id)) details.push(issue(`${base}.id`, 'Requirement id must use lowercase letters, numbers, and hyphens.'));
    if (ids.has(requirement.id)) details.push(issue(`${base}.id`, 'Requirement id must be unique.'));
    ids.add(requirement.id);
    if (!requirement.title) details.push(issue(`${base}.title`, 'Requirement title is required.'));
    if (!requirement.description) details.push(issue(`${base}.description`, 'Requirement description is required.'));
    if (!PRIORITIES.has(requirement.priority)) details.push(issue(`${base}.priority`, 'Priority must be must, should, or could.'));
  }
}

function validateAcceptanceCriteria(criteria, details) {
  const ids = new Set();
  for (const [index, criterion] of criteria.entries()) {
    const base = `acceptanceCriteria[${index}]`;
    if (!ID.test(criterion.id)) details.push(issue(`${base}.id`, 'Acceptance criterion id must use lowercase letters, numbers, and hyphens.'));
    if (ids.has(criterion.id)) details.push(issue(`${base}.id`, 'Acceptance criterion id must be unique.'));
    ids.add(criterion.id);
    if (!criterion.description) details.push(issue(`${base}.description`, 'Acceptance criterion description is required.'));
    if (!VERIFICATIONS.has(criterion.verification)) details.push(issue(`${base}.verification`, 'Verification must be manual, test, trace, or review.'));
  }
}

function validateConstraints(constraints, details) {
  if (!RISK_LEVELS.has(constraints.riskLevel)) details.push(issue('constraints.riskLevel', 'Risk level must be low, medium, or high.'));
  for (const [index, repo] of constraints.allowedRepos.entries()) {
    if (!ID.test(repo)) details.push(issue(`constraints.allowedRepos[${index}]`, 'Repository reference must use lowercase letters, numbers, and hyphens.'));
  }
  for (const [index, tool] of constraints.allowedTools.entries()) {
    if (!ID.test(tool)) details.push(issue(`constraints.allowedTools[${index}]`, 'Tool reference must use lowercase letters, numbers, and hyphens.'));
  }
}

function validateWorkflowHints(workflowHints, details) {
  if (workflowHints.preferredWorkflowId && !ID.test(workflowHints.preferredWorkflowId)) details.push(issue('workflowHints.preferredWorkflowId', 'Preferred workflow id must use lowercase letters, numbers, and hyphens.'));
  for (const [index, agent] of workflowHints.requiredAgents.entries()) {
    if (!ID.test(agent)) details.push(issue(`workflowHints.requiredAgents[${index}]`, 'Agent reference must use lowercase letters, numbers, and hyphens.'));
  }
  for (const [index, skill] of workflowHints.requiredSkills.entries()) {
    if (!ID.test(skill)) details.push(issue(`workflowHints.requiredSkills[${index}]`, 'Skill reference must use lowercase letters, numbers, and hyphens.'));
  }
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map((item) => item.trim().toLowerCase()).filter(Boolean) : [];
}

function issue(path, message) {
  return { path, message };
}
