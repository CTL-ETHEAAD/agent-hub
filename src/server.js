import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  addIssue,
  addReviewComment,
  approveSplitPlan,
  approveIssue,
  cleanIssueWorktree,
  deleteIssue,
  deleteReviewComment,
  executeSplitPlan,
  getArtifact,
  getDiff,
  getChangedFiles,
  getLog,
  getTakeoverInfo,
  markIssueManual,
  markIssueManualDone,
  markContextRefreshRequired,
  proceedIssue,
  pushIssueBranch,
  refreshContext,
  reconcileStaleAgents,
  runSplitWorkflow,
  retryIssue,
  splitIssue,
  startIssueLoop,
  startAiReview,
  startIntake,
  stopIssue
} from './orchestrator.js';
import { listRepos } from './repos.js';
import { listIssues, readIssue } from './stateStore.js';
import { getClaudeUsage } from './usage.js';
import {
  archiveAgent,
  cloneAgent,
  createAgent,
  createDraftVersion,
  listAgents,
  listAgentVersions,
  publishAgent,
  readAgent,
  updateDraft
} from './agentStore.js';
import {
  cancelAgentRun,
  listAgentRuns,
  readAgentRun,
  readAgentRunLog,
  reconcileAgentRuns,
  startAgentRun
} from './agentService.js';
import {
  archiveWorkflow,
  cloneWorkflow,
  createWorkflow,
  createWorkflowDraftVersion,
  listWorkflows,
  publishWorkflow,
  readWorkflow,
  updateWorkflowDraft
} from './workflowStore.js';
import { listNodeContracts } from './workflowNodeContract.js';
import {
  cancelWorkflowRun,
  decideWorkflowApproval,
  listWorkflowRuns,
  readWorkflowRun,
  reconcileWorkflowRuns,
  resumeWorkflowFromFailure,
  retryWorkflowRun,
  startWorkflowRun
} from './workflowService.js';
import {
  archiveTool,
  cloneTool,
  createTool,
  createToolDraftVersion,
  listTools,
  publishTool,
  readTool,
  updateToolDraft
} from './toolStore.js';
import { executeTool } from './toolService.js';
import {
  archiveSkill,
  createSkill,
  createSkillDraftVersion,
  listSkills,
  listSkillVersions,
  publishSkill,
  readSkill,
  updateSkillDraft
} from './skillStore.js';
import {
  archivePolicy,
  createPolicy,
  createPolicyDraftVersion,
  listPolicies,
  publishPolicy,
  readPolicy,
  updatePolicyDraft
} from './policy/policyStore.js';
import { listTraces } from './trace/traceStore.js';
import { initializeBuiltinAssets } from './builtinAssets.js';
import { listNodeRuns, readNodeRun } from './nodeRunStore.js';
import { listWorkers, readWorker } from './workerStore.js';

const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const IS_LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']).has(HOST);
const AUTH_TOKEN = process.env.AGENT_HUB_AUTH_TOKEN || '';
const PUBLIC_ROOT = path.resolve(import.meta.dirname, '..', 'public');
const WORKFLOW_EXAMPLES_ROOT = path.resolve(import.meta.dirname, '..', 'examples', 'workflows');

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      if (!IS_LOOPBACK && req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) return json(res, { error: { code: 'UNAUTHORIZED', message: 'Bearer authentication is required.' } }, 401);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res, { error: { code: 'ORIGIN_DENIED', message: 'Request origin is not allowed.' } }, 403);
    }

    if (url.pathname === '/api/repos' && req.method === 'GET') {
      return json(res, await listRepos());
    }
    if (url.pathname === '/api/system/initialize-builtin-assets' && req.method === 'POST') return json(res, await initializeBuiltinAssets(), 201);

    if ((url.pathname === '/api/work-items' || url.pathname === '/api/issues') && req.method === 'GET') {
      return json(res, await listIssues());
    }

    if (url.pathname === '/api/usage/claude' && req.method === 'GET') {
      return json(res, await getClaudeUsage({ force: url.searchParams.get('force') === 'true' }));
    }

    if ((url.pathname === '/api/work-items' || url.pathname === '/api/issues') && req.method === 'POST') {
      const body = await readJson(req);
      const issue = await addIssue(body);
      if (body.autoIntake === false) {
        return json(res, issue, 201);
      }

      return json(res, await startIntake(issue.ticketId), 201);
    }

    if (url.pathname === '/api/agents' && req.method === 'GET') {
      return json(res, await listAgents({ includeArchived: url.searchParams.get('includeArchived') === 'true' }));
    }

    if (url.pathname === '/api/agents' && req.method === 'POST') {
      return json(res, await createAgent(await readJson(req)), 201);
    }

    const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)(?:\/([^/]+))?$/);
    if (agentMatch) {
      const [, agentId, action] = agentMatch;
      if (!action && req.method === 'GET') {
        return json(res, { agent: await readAgent(agentId), versions: await listAgentVersions(agentId) });
      }
      if (!action && req.method === 'PATCH') return json(res, await updateDraft(agentId, await readJson(req)));
      if (!action && req.method === 'DELETE') return json(res, await archiveAgent(agentId));
      if (action === 'clone' && req.method === 'POST') return json(res, await cloneAgent(agentId, await readJson(req)), 201);
      if (action === 'publish' && req.method === 'POST') return json(res, await publishAgent(agentId));
      if (action === 'new-version' && req.method === 'POST') return json(res, await createDraftVersion(agentId), 201);
      if (action === 'runs' && req.method === 'POST') return json(res, await startAgentRun(agentId, await readJson(req)), 202);
      if (action === 'runs' && req.method === 'GET') return json(res, await listAgentRuns({ agentId }));
    }

    const agentRunMatch = url.pathname.match(/^\/api\/agent-runs\/([^/]+)(?:\/([^/]+))?$/);
    if (agentRunMatch) {
      const [, runId, action] = agentRunMatch;
      if (!action && req.method === 'GET') return json(res, await readAgentRun(runId));
      if (action === 'log' && req.method === 'GET') return text(res, await readAgentRunLog(runId));
      if (action === 'traces' && req.method === 'GET') return json(res, await listTraces(runId));
      if (action === 'cancel' && req.method === 'POST') return json(res, await cancelAgentRun(runId));
    }

    if (url.pathname === '/api/skills' && req.method === 'GET') return json(res, await listSkills({ includeArchived: url.searchParams.get('includeArchived') === 'true' }));
    if (url.pathname === '/api/skills' && req.method === 'POST') return json(res, await createSkill(await readJson(req)), 201);
    const skillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)(?:\/([^/]+))?$/);
    if (skillMatch) {
      const [, skillId, action] = skillMatch;
      if (!action && req.method === 'GET') return json(res, { skill: await readSkill(skillId), versions: await listSkillVersions(skillId) });
      if (!action && req.method === 'PATCH') return json(res, await updateSkillDraft(skillId, await readJson(req)));
      if (!action && req.method === 'DELETE') return json(res, await archiveSkill(skillId));
      if (action === 'publish' && req.method === 'POST') return json(res, await publishSkill(skillId));
      if (action === 'new-version' && req.method === 'POST') return json(res, await createSkillDraftVersion(skillId), 201);
    }

    if (url.pathname === '/api/workflows' && req.method === 'GET') {
      return json(res, await listWorkflows({ includeArchived: url.searchParams.get('includeArchived') === 'true' }));
    }
    if (url.pathname === '/api/workflow-node-contracts' && req.method === 'GET') return json(res, listNodeContracts());
    if (url.pathname === '/api/workflow-templates' && req.method === 'GET') {
      const files = ['review-pipeline.json', 'work-item-planning.json'];
      const templates = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(WORKFLOW_EXAMPLES_ROOT, file), 'utf8'))));
      return json(res, templates);
    }
    if (url.pathname === '/api/workflows' && req.method === 'POST') return json(res, await createWorkflow(await readJson(req)), 201);
    const workflowMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)(?:\/([^/]+))?$/);
    if (workflowMatch) {
      const [, workflowId, action] = workflowMatch;
      if (!action && req.method === 'GET') return json(res, await readWorkflow(workflowId));
      if (!action && req.method === 'PATCH') return json(res, await updateWorkflowDraft(workflowId, await readJson(req)));
      if (!action && req.method === 'DELETE') return json(res, await archiveWorkflow(workflowId));
      if (action === 'clone' && req.method === 'POST') return json(res, await cloneWorkflow(workflowId, await readJson(req)), 201);
      if (action === 'publish' && req.method === 'POST') return json(res, await publishWorkflow(workflowId));
      if (action === 'new-version' && req.method === 'POST') return json(res, await createWorkflowDraftVersion(workflowId), 201);
      if (action === 'runs' && req.method === 'POST') return json(res, await startWorkflowRun(workflowId, await readJson(req), { idempotencyKey: req.headers['idempotency-key'] || '' }), 202);
      if (action === 'runs' && req.method === 'GET') return json(res, await listWorkflowRuns({ workflowId }));
    }
    const workflowRunMatch = url.pathname.match(/^\/api\/workflow-runs\/([^/]+)(?:\/([^/]+))?$/);
    if (workflowRunMatch) {
      const [, runId, action] = workflowRunMatch;
      if (!action && req.method === 'GET') return json(res, await readWorkflowRun(runId));
      if (action === 'node-runs' && req.method === 'GET') return json(res, await listNodeRuns({ workflowRunId: runId }));
      if (action === 'approval' && req.method === 'POST') return json(res, await decideWorkflowApproval(runId, await readJson(req)));
      if (action === 'retry' && req.method === 'POST') return json(res, await retryWorkflowRun(runId), 202);
      if (action === 'resume' && req.method === 'POST') return json(res, await resumeWorkflowFromFailure(runId), 202);
      if (action === 'traces' && req.method === 'GET') return json(res, await listTraces(runId));
      if (action === 'cancel' && req.method === 'POST') return json(res, await cancelWorkflowRun(runId));
    }
    const nodeRunMatch = url.pathname.match(/^\/api\/node-runs\/([^/]+)$/);
    if (nodeRunMatch && req.method === 'GET') return json(res, await readNodeRun(nodeRunMatch[1]));

    if (url.pathname === '/api/workers' && req.method === 'GET') return json(res, await listWorkers({ status: url.searchParams.get('status') || undefined, role: url.searchParams.get('role') || undefined }));
    const workerMatch = url.pathname.match(/^\/api\/workers\/([^/]+)$/);
    if (workerMatch && req.method === 'GET') return json(res, await readWorker(workerMatch[1]));

    if (url.pathname === '/api/policies' && req.method === 'GET') return json(res, await listPolicies({ includeArchived: url.searchParams.get('includeArchived') === 'true' }));
    if (url.pathname === '/api/policies' && req.method === 'POST') return json(res, await createPolicy(await readJson(req)), 201);
    const policyMatch = url.pathname.match(/^\/api\/policies\/([^/]+)(?:\/([^/]+))?$/);
    if (policyMatch) {
      const [, policyId, action] = policyMatch;
      if (!action && req.method === 'GET') return json(res, await readPolicy(policyId));
      if (!action && req.method === 'PATCH') return json(res, await updatePolicyDraft(policyId, await readJson(req)));
      if (!action && req.method === 'DELETE') return json(res, await archivePolicy(policyId));
      if (action === 'publish' && req.method === 'POST') return json(res, await publishPolicy(policyId));
      if (action === 'new-version' && req.method === 'POST') return json(res, await createPolicyDraftVersion(policyId), 201);
    }

    if (url.pathname === '/api/tools' && req.method === 'GET') return json(res, await listTools({ includeArchived: url.searchParams.get('includeArchived') === 'true' }));
    if (url.pathname === '/api/tools' && req.method === 'POST') return json(res, await createTool(await readJson(req)), 201);
    const toolMatch = url.pathname.match(/^\/api\/tools\/([^/]+)(?:\/([^/]+))?$/);
    if (toolMatch) {
      const [, toolId, action] = toolMatch;
      if (!action && req.method === 'GET') return json(res, await readTool(toolId));
      if (!action && req.method === 'PATCH') return json(res, await updateToolDraft(toolId, await readJson(req)));
      if (!action && req.method === 'DELETE') return json(res, await archiveTool(toolId));
      if (action === 'clone' && req.method === 'POST') return json(res, await cloneTool(toolId, await readJson(req)), 201);
      if (action === 'publish' && req.method === 'POST') return json(res, await publishTool(toolId));
      if (action === 'new-version' && req.method === 'POST') return json(res, await createToolDraftVersion(toolId), 201);
      if (action === 'test' && req.method === 'POST') return json(res, await executeTool(toolId, await readJson(req)));
    }

    const issueMatch = url.pathname.match(/^\/api\/(?:work-items|issues)\/([^/]+)(?:\/([^/]+))?$/);
    if (issueMatch) {
      const [, ticketId, action] = issueMatch;

      if (!action && req.method === 'GET') {
        return json(res, await readIssue(ticketId));
      }

      if (action === 'intake' && req.method === 'POST') {
        return json(res, await startIntake(ticketId));
      }

      if (action === 'proceed' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, await proceedIssue(ticketId, {
          humanComment: body.humanComment || '',
          allowDirty: body.allowDirty === true
        }));
      }

      if (action === 'loop' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, await startIssueLoop(ticketId, {
          maxIterations: body.maxIterations,
          acceptanceCriteria: body.acceptanceCriteria || ''
        }));
      }

      if (action === 'approve' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, await approveIssue(ticketId, { approvalNote: body.approvalNote || '' }));
      }

      if (action === 'push' && req.method === 'POST') {
        return json(res, await pushIssueBranch(ticketId));
      }

      if (action === 'review' && req.method === 'POST') {
        return json(res, await startAiReview(ticketId));
      }

      if (action === 'retry' && req.method === 'POST') {
        return json(res, await retryIssue(ticketId));
      }

      if (action === 'stop' && req.method === 'POST') {
        return json(res, await stopIssue(ticketId));
      }

      if (action === 'takeover' && req.method === 'GET') {
        return text(res, await getTakeoverInfo(ticketId));
      }

      if (action === 'takeover' && req.method === 'POST') {
        return json(res, await markIssueManual(ticketId));
      }

      if (action === 'manual-done' && req.method === 'POST') {
        return json(res, await markIssueManualDone(ticketId));
      }

      if (action === 'clean-worktree' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, await cleanIssueWorktree(ticketId, { force: body.force === true }));
      }

      if (!action && req.method === 'DELETE') {
        await deleteIssue(ticketId);
        return json(res, { deleted: ticketId });
      }

      if (action === 'split' && req.method === 'POST') {
        return json(res, await splitIssue(ticketId));
      }

      if (action === 'approve-split' && req.method === 'POST') {
        return json(res, await approveSplitPlan(ticketId));
      }

      if (action === 'execute-split' && req.method === 'POST') {
        const body = await readJson(req);
        return json(res, await executeSplitPlan(ticketId, { resetExisting: body.resetExisting === true }));
      }

      if (action === 'run-workflow' && req.method === 'POST') {
        return json(res, await runSplitWorkflow(ticketId));
      }

      if (action === 'refresh-context' && req.method === 'POST') {
        return json(res, await refreshContext(ticketId));
      }

      if (action === 'regenerate-plan' && req.method === 'POST') {
        return json(res, await startIntake(ticketId));
      }

      if (action === 'resume' && req.method === 'POST') {
        await refreshContext(ticketId);
        return json(res, await proceedIssue(ticketId, { force: true }));
      }

      if (action === 'require-context-refresh' && req.method === 'POST') {
        return json(res, await markContextRefreshRequired(ticketId));
      }

      if (action === 'diff' && req.method === 'GET') {
        return text(res, await getDiff(ticketId, { file: url.searchParams.get('file') || '' }));
      }

      if (action === 'changed-files' && req.method === 'GET') {
        const issue = await readIssue(ticketId);
        return json(res, await getChangedFiles(issue));
      }

      if (action === 'review-comment' && req.method === 'POST') {
        return json(res, await addReviewComment(ticketId, await readJson(req)));
      }

      if (action === 'review-comment' && req.method === 'DELETE') {
        const body = await readJson(req);
        return json(res, await deleteReviewComment(ticketId, body.commentId || ''));
      }

      if (action === 'plan' && req.method === 'GET') {
        const issue = await readIssue(ticketId);
        return text(res, await readFile(issue.featureFilePath, 'utf8').catch(() => 'Plan file not found yet.'));
      }

      if (action === 'review-result' && req.method === 'GET') {
        const issue = await readIssue(ticketId);
        if (!issue.reviewResultPath) {
          return text(res, 'Review result not found yet.');
        }
        return text(res, await readFile(issue.reviewResultPath, 'utf8').catch(() => 'Review result not found yet.'));
      }

      if (action === 'artifact' && req.method === 'GET') {
        return text(res, await getArtifact(ticketId, url.searchParams.get('name') || 'finalSummary'));
      }

      if (action === 'log' && req.method === 'GET') {
        return text(res, await getLog(ticketId, url.searchParams.get('kind') || 'intake'));
      }
    }

    return staticFile(res, url.pathname);
  } catch (error) {
    return json(res, {
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message,
        details: error.details || []
      }
    }, error.status || 500);
  }
});

if (!IS_LOOPBACK && (process.env.AGENT_HUB_ALLOW_REMOTE !== 'true' || !AUTH_TOKEN)) throw new Error('Remote listening requires AGENT_HUB_ALLOW_REMOTE=true and AGENT_HUB_AUTH_TOKEN.');
await reconcileStaleAgents();
await reconcileAgentRuns();
await reconcileWorkflowRuns();
setInterval(() => {
  reconcileStaleAgents().catch((error) => {
    console.error(`Agent reconciliation failed: ${error.message}`);
  });
}, 5000).unref();
server.listen(PORT, HOST, () => {
  console.log(`Agent Hub listening on http://${HOST}:${PORT}`);
});

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      const error = new Error('Request body is too large.');
      error.code = 'REQUEST_TOO_LARGE';
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const error = new Error('Request body is not valid JSON.');
    error.code = 'INVALID_JSON';
    error.status = 400;
    throw error;
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function text(res, data, status = 200) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(data);
}

async function staticFile(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_ROOT, safePath);
  if (!filePath.startsWith(PUBLIC_ROOT)) {
    return text(res, 'Not found', 404);
  }

  const content = await readFile(filePath).catch(() => null);
  if (!content) {
    return text(res, 'Not found', 404);
  }

  const ext = path.extname(filePath);
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  }[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-store'
  });
  res.end(content);
}
