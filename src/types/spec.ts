import type { JsonObject, JsonSchema, VersionedAsset } from './common.js';

export interface SpecRequirement {
  id: string;
  title: string;
  description: string;
  priority: 'must' | 'should' | 'could';
}

export interface SpecAcceptanceCriterion {
  id: string;
  description: string;
  verification: 'manual' | 'test' | 'trace' | 'review';
}

export interface SpecConstraints {
  allowedRepos: string[];
  allowedTools: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface SpecWorkflowHints {
  preferredWorkflowId?: string;
  requiredAgents: string[];
  requiredSkills: string[];
}

export interface SpecDefinition extends VersionedAsset {
  description?: string;
  goal: string;
  background?: string;
  requirements: SpecRequirement[];
  acceptanceCriteria: SpecAcceptanceCriterion[];
  constraints: SpecConstraints;
  workflowHints: SpecWorkflowHints;
  inputSchema: JsonSchema;
  metadata?: JsonObject;
}
