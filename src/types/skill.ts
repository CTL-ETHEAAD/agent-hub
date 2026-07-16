import type { JsonSchema, VersionedAsset } from './common.js';

export interface SkillDefinition extends VersionedAsset {
  description: string;
  instructionPath: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  allowedTools: string[];
  riskNotes: string[];
}
