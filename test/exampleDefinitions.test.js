import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateAgentDefinition } from '../src/agentSchema.js';
import { validateSkillDefinition } from '../src/skillSchema.js';
import { validateWorkflow } from '../src/workflowSchema.js';

const EXAMPLES_ROOT = path.resolve(import.meta.dirname, '..', 'examples');

test('all Agent, Skill, and Workflow examples satisfy their public contracts', async () => {
  for (const [directory, validate] of [
    ['agents', validateAgentDefinition],
    ['skills', validateSkillDefinition],
    ['workflows', validateWorkflow]
  ]) {
    const files = await readdir(path.join(EXAMPLES_ROOT, directory));
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      const value = JSON.parse(await readFile(path.join(EXAMPLES_ROOT, directory, file), 'utf8'));
      assert.doesNotThrow(() => validate(value), `${directory}/${file} must be valid`);
    }
  }
});
