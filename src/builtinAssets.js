import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createAgent, publishAgent, readAgent } from './agentStore.js';
import { createSkill, publishSkill, readSkill } from './skillStore.js';
import { createWorkflow, publishWorkflow, readWorkflow } from './workflowStore.js';

const EXAMPLES_ROOT = path.resolve(import.meta.dirname, '..', 'examples');

export async function initializeBuiltinAssets(options = {}) {
  const groups = [
    ['skills', createSkill, publishSkill, readSkill, options.skillsRoot],
    ['agents', createAgent, publishAgent, readAgent, options.agentsRoot],
    ['workflows', createWorkflow, publishWorkflow, readWorkflow, options.workflowsRoot]
  ];
  const result = { created: [], existing: [] };
  for (const [directory, create, publish, read, root] of groups) {
    for (const file of (await readdir(path.join(EXAMPLES_ROOT, directory))).filter((name) => name.endsWith('.json')).sort()) {
      const definition = JSON.parse(await readFile(path.join(EXAMPLES_ROOT, directory, file), 'utf8'));
      try {
        await read(definition.id, undefined, root);
        result.existing.push(`${directory}/${definition.id}`);
      } catch (error) {
        if (!['AGENT_NOT_FOUND', 'SKILL_NOT_FOUND', 'WORKFLOW_NOT_FOUND'].includes(error.code)) throw error;
        await create(definition, root); await publish(definition.id, root);
        result.created.push(`${directory}/${definition.id}`);
      }
    }
  }
  return result;
}
