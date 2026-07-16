const repoSelect = document.querySelector('#repoSelect');
const repoGroups = document.querySelector('#repoGroups');
const kanbanBoard = document.querySelector('#kanbanBoard');
const hiddenColumns = document.querySelector('#hiddenColumns');
const summaryStrip = document.querySelector('#summaryStrip');
const detailTabs = document.querySelector('#detailTabs');
const output = document.querySelector('#output');
const outputTitle = document.querySelector('#outputTitle');
const detailsDrawer = document.querySelector('#detailsDrawer');
const drawerSubtitle = document.querySelector('#drawerSubtitle');
const drawerStatusDot = document.querySelector('#drawerStatusDot');
const drawerContext = document.querySelector('#drawerContext');
const drawerActions = document.querySelector('#drawerActions');
const boardSearch = document.querySelector('#boardSearch');
const boardCount = document.querySelector('#boardCount');
let appFeedback = document.querySelector('#appFeedback');
const approveDialog = document.querySelector('#approveDialog');
const approveForm = document.querySelector('#approveForm');
const approveTitle = document.querySelector('#approveTitle');
const approveChecklist = document.querySelector('#approveChecklist');
const approvalNote = document.querySelector('#approvalNote');
const loopDialog = document.querySelector('#loopDialog');
const loopForm = document.querySelector('#loopForm');
const loopTitle = document.querySelector('#loopTitle');
const loopMaxIterations = document.querySelector('#loopMaxIterations');
const loopAcceptanceCriteria = document.querySelector('#loopAcceptanceCriteria');
const loopValidationCommand = document.querySelector('#loopValidationCommand');
const agentsWorkspace = document.querySelector('#agentsWorkspace');
const agentGrid = document.querySelector('#agentGrid');
const agentEditorDialog = document.querySelector('#agentEditorDialog');
const agentEditorForm = document.querySelector('#agentEditorForm');
const agentPlaygroundDialog = document.querySelector('#agentPlaygroundDialog');
const workflowsWorkspace = document.querySelector('#workflowsWorkspace');
const workflowGrid = document.querySelector('#workflowGrid');
const workflowEditorDialog = document.querySelector('#workflowEditorDialog');
const workflowEditorForm = document.querySelector('#workflowEditorForm');
const workflowRunDialog = document.querySelector('#workflowRunDialog');
const workflowVisualBuilder = document.querySelector('#workflowVisualBuilder');
const workflowTemplateDialog = document.querySelector('#workflowTemplateDialog');
const toolsWorkspace = document.querySelector('#toolsWorkspace');
const toolGrid = document.querySelector('#toolGrid');
const toolEditorDialog = document.querySelector('#toolEditorDialog');
const toolEditorForm = document.querySelector('#toolEditorForm');
const toolTestDialog = document.querySelector('#toolTestDialog');
let agents = [];
let workflows = [];
let tools = [];
let activeWorkspace = 'issues';
let editingAgentId = '';
let playgroundAgent = null;
let activeAgentRunId = '';
let editingWorkflowId = '';
let runningWorkflow = null;
let editingToolId = '';
let testingTool = null;
let selectedCanvasNodeId = '';
let connectionSourceNodeId = '';

const columns = [
  {
    id: 'backlog',
    title: 'Backlog',
    tone: 'neutral',
    statuses: ['ADDED', 'FAILED', 'BLOCKED', 'INTERRUPTED', 'CANCELED', 'CONTEXT_REFRESH_REQUIRED']
  },
  {
    id: 'todo',
    title: 'Todo',
    tone: 'slate',
    statuses: ['PLAN_READY', 'NEEDS_REFINEMENT', 'NEEDS_SPLIT', 'SPLIT_PLAN_READY', 'SPLIT_APPROVED']
  },
  {
    id: 'waiting',
    title: 'Waiting',
    tone: 'orange',
    statuses: ['WAITING_FOR_DEPENDENCY', 'WAITING_FOR_SIBLINGS']
  },
  {
    id: 'in-progress',
    title: 'In Progress',
    tone: 'yellow',
    statuses: ['CONTEXT_ANALYZING', 'INTAKE_RUNNING', 'IMPLEMENTING', 'IMPLEMENTED', 'AI_REVIEW_RUNNING', 'RESUMING', 'SPLIT_EXECUTED', 'MANUAL']
  },
  {
    id: 'human-review',
    title: 'Human Review',
    tone: 'rose',
    statuses: ['REVIEW_READY', 'FIXING_REVIEW', 'MANUAL_DONE', 'INTEGRATION_READY', 'INTEGRATION_REQUIRED']
  },
  {
    id: 'done',
    title: 'Done',
    tone: 'green',
    statuses: ['DONE']
  }
];

const statusOverviewGroups = [
  { title: 'Needs refinement', statuses: ['NEEDS_REFINEMENT'], tone: 'orange' },
  { title: 'Needs split', statuses: ['NEEDS_SPLIT'], tone: 'orange' },
  { title: 'Split plan ready', statuses: ['SPLIT_PLAN_READY'], tone: 'orange' },
  { title: 'Split approved', statuses: ['SPLIT_APPROVED'], tone: 'yellow' },
  { title: 'Waiting for siblings', statuses: ['WAITING_FOR_SIBLINGS'], tone: 'yellow' },
  { title: 'Manual takeover', statuses: ['MANUAL'], tone: 'yellow' },
  { title: 'Integration ready', statuses: ['INTEGRATION_READY'], tone: 'rose' },
  { title: 'Integration required', statuses: ['INTEGRATION_REQUIRED'], tone: 'orange' },
  { title: 'Context refresh', statuses: ['CONTEXT_REFRESH_REQUIRED'], tone: 'yellow' },
  { title: 'Canceled', statuses: ['CANCELED'], tone: 'gray' },
  { title: 'Duplicate', statuses: ['DUPLICATE'], tone: 'gray' }
];

let repos = [];
let issues = [];
let claudeUsage = null;
const savedUiState = loadUiState();
let refreshInFlight = false;
const expandedGroups = new Set();
let displayPanelOpen = savedUiState.displayPanelOpen || false;
let selectedIssueId = savedUiState.selectedIssueId || '';
let selectedDetailTab = savedUiState.selectedDetailTab || 'overview';
let activeSummaryFilter = savedUiState.activeSummaryFilter || '';
let searchQuery = savedUiState.searchQuery || '';
let selectedDiffFile = '';
let pendingDiffLine = 0;

document.querySelector('#refreshButton').addEventListener('click', refresh);
document.querySelector('#initializeAssetsButton').addEventListener('click', async () => { try { const result = await request('/api/system/initialize-builtin-assets', { method: 'POST' }); showFeedback(`Initialized ${result.created.length} bundled assets; ${result.existing.length} already existed.`, 'success'); await refresh(); } catch (error) { showFeedback(error.message, 'error'); } });
document.querySelectorAll('[data-workspace]').forEach((button) => button.addEventListener('click', () => switchWorkspace(button.dataset.workspace)));
document.querySelector('#createAgentButton').addEventListener('click', () => openAgentEditor());
document.querySelector('[data-close-agent-dialog]').addEventListener('click', () => agentEditorDialog.close());
document.querySelector('[data-close-playground]').addEventListener('click', () => agentPlaygroundDialog.close());
document.querySelector('#runAgentButton').addEventListener('click', runAgentFromPlayground);
document.querySelector('#cancelAgentRunButton').addEventListener('click', cancelActiveAgentRun);
agentEditorForm.addEventListener('submit', saveAgentDraft);
document.querySelector('#createWorkflowButton').addEventListener('click', () => openWorkflowEditor());
document.querySelector('[data-close-workflow-dialog]').addEventListener('click', () => workflowEditorDialog.close());
document.querySelector('[data-close-workflow-run]').addEventListener('click', () => workflowRunDialog.close());
document.querySelector('#runWorkflowButton').addEventListener('click', runSelectedWorkflow);
workflowEditorForm.addEventListener('submit', saveWorkflowDraft);
workflowEditorForm.elements.definition.addEventListener('input', renderVisualBuilderFromJson);
document.querySelectorAll('[data-add-node]').forEach((button) => button.addEventListener('click', () => addVisualNode(button.dataset.addNode)));
document.querySelector('#createFromTemplateButton').addEventListener('click', openTemplatePicker);
document.querySelector('#createToolButton').addEventListener('click', () => openToolEditor());
document.querySelector('[data-close-tool-dialog]').addEventListener('click', () => toolEditorDialog.close());
document.querySelector('[data-close-tool-test]').addEventListener('click', () => toolTestDialog.close());
document.querySelector('#executeToolButton').addEventListener('click', executeSelectedTool);
toolEditorForm.addEventListener('submit', saveToolDraft);
boardSearch.value = searchQuery;
document.querySelector('.board-layout').classList.toggle('rail-open', displayPanelOpen);
document.querySelector('.board-tools button:last-child').classList.toggle('active', displayPanelOpen);
boardSearch.addEventListener('input', () => {
  searchQuery = boardSearch.value.trim().toLowerCase();
  persistUiState();
  renderBoard();
});
document.querySelector('.board-tools button:last-child').addEventListener('click', () => {
  displayPanelOpen = !displayPanelOpen;
  document.querySelector('.board-layout').classList.toggle('rail-open', displayPanelOpen);
  document.querySelector('.board-tools button:last-child').classList.toggle('active', displayPanelOpen);
  persistUiState();
});
document.querySelector('#clearOutputButton').addEventListener('click', () => {
  outputTitle.textContent = 'Details';
  setOutput('Select a work item action to inspect plan, diff, or review output.');
  detailTabs.innerHTML = '';
  drawerContext.innerHTML = '';
  drawerActions.innerHTML = '';
  selectedIssueId = '';
  selectedDetailTab = 'overview';
  detailsDrawer.classList.remove('open', 'review-workspace');
  detailsDrawer.setAttribute('aria-hidden', 'true');
  persistUiState();
  renderBoard();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && detailsDrawer.classList.contains('open')) {
    document.querySelector('#clearOutputButton').click();
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if (key === 'q') {
    activeSummaryFilter = activeSummaryFilter === 'Review' ? '' : 'Review';
    persistUiState();
    renderSummaryStrip();
    renderBoard();
    return;
  }
  const visible = filterIssuesBySummary(issues);
  if ((key === 'j' || key === 'k') && visible.length) {
    event.preventDefault();
    const current = visible.findIndex((issue) => issue.ticketId === selectedIssueId);
    const delta = key === 'j' ? 1 : -1;
    const next = current < 0 ? 0 : Math.min(visible.length - 1, Math.max(0, current + delta));
    openIssueWorkspace(visible[next]);
    return;
  }
  const issue = issues.find((item) => item.ticketId === selectedIssueId);
  if (!issue) return;
  if (key === 'd' && issue.buttons?.viewDiff) {
    selectedDetailTab = 'diff';
    persistUiState();
    void renderSelectedDetail();
  } else if (key === 'r' && issue.buttons?.codeReviewResult) {
    selectedDetailTab = 'review';
    persistUiState();
    void renderSelectedDetail();
  } else if (key === 'a' && issue.status === 'REVIEW_READY') {
    void handleAction(issue.ticketId, 'approve');
  } else if (key === 'f' && isReviewIssue(issue)) {
    drawerContext.querySelector('#drawerReviewNote')?.focus();
  }
});

document.querySelector('#issueForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const label = data.externalId || data.ticketId;
  try {
    showFeedback(`Adding ${label}...`, 'info');
    await request('/api/work-items', {
      method: 'POST',
      body: JSON.stringify(data)
    });
    form.reset();
    await forceRefresh();
    showFeedback(`${label} added.`, 'success');
  } catch (error) {
    showActionError(label || 'New Work Item', error);
  }
});

// Used by the auto-poll interval — skips if a refresh is already running.
async function refresh() {
  if (refreshInFlight) {
    return;
  }

  await forceRefresh();
}

async function forceRefresh() {
  refreshInFlight = true;
  try {
    [repos, issues, claudeUsage] = await Promise.all([
      request('/api/repos'),
      request('/api/work-items'),
      request('/api/usage/claude').catch((error) => ({
        available: false,
        error: error.message || String(error)
      }))
    ]);
    renderRepoSelect();
    renderSummaryStrip();
    renderBoard();
    renderRightRail();
    if (selectedIssueId) {
      void renderSelectedDetail({ preserveContent: true });
    }
    if (activeWorkspace === 'agents') await refreshAgents();
    if (activeWorkspace === 'workflows') await refreshWorkflows();
    if (activeWorkspace === 'tools') await refreshTools();
  } finally {
    refreshInFlight = false;
  }
}

function switchWorkspace(workspace) {
  activeWorkspace = workspace;
  document.querySelectorAll('[data-workspace]').forEach((button) => button.classList.toggle('active', button.dataset.workspace === workspace));
  document.querySelector('.project-bar').hidden = workspace !== 'issues';
  summaryStrip.hidden = workspace !== 'issues';
  document.querySelector('.board-shell').hidden = workspace !== 'issues';
  agentsWorkspace.hidden = workspace !== 'agents';
  workflowsWorkspace.hidden = workspace !== 'workflows';
  toolsWorkspace.hidden = workspace !== 'tools';
  document.querySelector('.app-shell').classList.toggle('agents-mode', workspace !== 'issues');
  if (workspace === 'agents') void refreshAgents();
  if (workspace === 'workflows') void refreshWorkflows();
  if (workspace === 'tools') void refreshTools();
}

async function refreshAgents() {
  agents = await request('/api/agents');
  renderAgents();
}

function renderAgents() {
  agentGrid.innerHTML = agents.length ? agents.map((agent) => `
    <article class="agent-card">
      <header><div class="agent-icon">${escapeHtml(agent.name.slice(0, 1).toUpperCase())}</div><span class="status-badge">${escapeHtml(agent.status)}</span></header>
      <h2>${escapeHtml(agent.name)}</h2>
      <p>${escapeHtml(agent.description || 'No description yet.')}</p>
      <div class="agent-meta"><span>v${agent.version}</span><span>${escapeHtml(agent.runtime.provider)}</span><span>${escapeHtml(agent.permissions.filesystem)}</span></div>
      <footer>
        ${agent.status === 'draft' ? `<button data-agent-action="edit" data-agent-id="${agent.id}">Edit</button><button data-agent-action="publish" data-agent-id="${agent.id}">Publish</button>` : `<button data-agent-action="new-version" data-agent-id="${agent.id}">New version</button>`}
        <button class="btn-primary" data-agent-action="run" data-agent-id="${agent.id}">Run</button>
        <button data-agent-action="clone" data-agent-id="${agent.id}">Clone</button>
        <button data-agent-action="archive" data-agent-id="${agent.id}">Archive</button>
      </footer>
    </article>`).join('') : '<div class="empty-agents"><h2>No agents yet</h2><p>Create the first reusable capability for your workflow.</p></div>';
  agentGrid.querySelectorAll('[data-agent-action]').forEach((button) => button.addEventListener('click', () => handleAgentAction(button.dataset.agentId, button.dataset.agentAction)));
}

async function handleAgentAction(id, action) {
  try {
    const agent = agents.find((item) => item.id === id);
    if (action === 'edit') return openAgentEditor(agent);
    if (action === 'run') return openAgentPlayground(agent);
    if (action === 'publish') await request(`/api/agents/${id}/publish`, { method: 'POST' });
    if (action === 'new-version') await request(`/api/agents/${id}/new-version`, { method: 'POST' });
    if (action === 'archive') await request(`/api/agents/${id}`, { method: 'DELETE' });
    if (action === 'clone') {
      const cloneId = window.prompt('New agent ID', `${id}-copy`);
      if (!cloneId) return;
      await request(`/api/agents/${id}/clone`, { method: 'POST', body: JSON.stringify({ id: cloneId }) });
    }
    await refreshAgents();
  } catch (error) { showFeedback(error.message, 'error'); }
}

function openAgentEditor(agent = null) {
  editingAgentId = agent?.id || '';
  document.querySelector('#agentEditorTitle').textContent = agent ? `Edit ${agent.name}` : 'New Agent';
  const form = agentEditorForm.elements;
  form.id.value = agent?.id || '';
  form.id.disabled = Boolean(agent);
  form.name.value = agent?.name || '';
  form.description.value = agent?.description || '';
  form.systemPrompt.value = agent?.systemPrompt || '';
  form.model.value = agent?.runtime.model || '';
  form.provider.value = agent?.runtime.provider || 'claude-code';
  form.timeoutMs.value = agent?.runtime.timeoutMs || 600000;
  form.filesystem.value = agent?.permissions.filesystem || 'deny';
  form.tools.value = (agent?.tools || []).join(', ');
  form.inputSchema.value = JSON.stringify(agent?.inputSchema || { type: 'object', properties: {} }, null, 2);
  form.outputSchema.value = JSON.stringify(agent?.outputSchema || { type: 'object', properties: {} }, null, 2);
  document.querySelector('#agentEditorError').textContent = '';
  agentEditorDialog.showModal();
}

async function saveAgentDraft(event) {
  event.preventDefault();
  const form = agentEditorForm.elements;
  try {
    const payload = {
      id: editingAgentId || form.id.value,
      name: form.name.value,
      description: form.description.value,
      systemPrompt: form.systemPrompt.value,
      runtime: { provider: form.provider.value || 'claude-code', model: form.model.value, timeoutMs: Number(form.timeoutMs.value) },
      inputSchema: JSON.parse(form.inputSchema.value),
      outputSchema: JSON.parse(form.outputSchema.value),
      tools: form.tools.value.split(',').map((item) => item.trim()).filter(Boolean),
      permissions: { filesystem: form.filesystem.value, network: 'deny', gitWrite: false }
    };
    await request(editingAgentId ? `/api/agents/${editingAgentId}` : '/api/agents', { method: editingAgentId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    agentEditorDialog.close();
    await refreshAgents();
  } catch (error) { document.querySelector('#agentEditorError').textContent = error.message; }
}

function openAgentPlayground(agent) {
  playgroundAgent = agent;
  activeAgentRunId = '';
  document.querySelector('#agentPlaygroundTitle').textContent = agent.name;
  document.querySelector('#agentPlaygroundMeta').textContent = `v${agent.version} · ${agent.status}`;
  document.querySelector('#agentRunInput').value = JSON.stringify(exampleFromSchema(agent.inputSchema), null, 2);
  document.querySelector('#agentRunOutput').textContent = 'Ready.';
  document.querySelector('#cancelAgentRunButton').disabled = true;
  agentPlaygroundDialog.showModal();
}

async function runAgentFromPlayground() {
  try {
    const input = JSON.parse(document.querySelector('#agentRunInput').value);
    const run = await request(`/api/agents/${playgroundAgent.id}/runs`, { method: 'POST', body: JSON.stringify(input) });
    activeAgentRunId = run.id;
    document.querySelector('#cancelAgentRunButton').disabled = false;
    await pollAgentRun(run.id);
  } catch (error) { document.querySelector('#agentRunOutput').textContent = error.message; }
}

async function pollAgentRun(id) {
  const run = await request(`/api/agent-runs/${id}`);
  document.querySelector('#agentRunOutput').textContent = JSON.stringify({ status: run.status, output: run.output, error: run.error, usage: run.usage, durationMs: run.durationMs }, null, 2);
  if (['queued', 'running'].includes(run.status) && activeAgentRunId === id) return window.setTimeout(() => void pollAgentRun(id), 1000);
  document.querySelector('#cancelAgentRunButton').disabled = true;
  activeAgentRunId = '';
}

async function cancelActiveAgentRun() {
  if (!activeAgentRunId) return;
  await request(`/api/agent-runs/${activeAgentRunId}/cancel`, { method: 'POST' });
  await pollAgentRun(activeAgentRunId);
}

function exampleFromSchema(schema) {
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, value]) => [key, exampleFromSchema(value)]));
  if (schema.type === 'array') return [];
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'string') return '';
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  return null;
}

async function refreshWorkflows() {
  workflows = await request('/api/workflows');
  renderWorkflows();
}

function renderWorkflows() {
  workflowGrid.innerHTML = workflows.length ? workflows.map((workflow) => `
    <article class="agent-card workflow-card">
      <header><div class="agent-icon">W</div><span class="status-badge">${escapeHtml(workflow.status)}</span></header>
      <h2>${escapeHtml(workflow.name)}</h2><p>${escapeHtml(workflow.description || 'No description yet.')}</p>
      <div class="agent-meta"><span>v${workflow.version}</span><span>${workflow.nodes.length} nodes</span><span>${workflow.edges.length} edges</span></div>
      <div class="mini-flow">${workflow.nodes.map((node) => `<span class="node-${node.type}">${escapeHtml(node.id)}</span>`).join('<i>→</i>')}</div>
      <footer>
        ${workflow.status === 'draft' ? `<button data-workflow-action="edit" data-workflow-id="${workflow.id}">Edit</button><button data-workflow-action="publish" data-workflow-id="${workflow.id}">Publish</button>` : `<button data-workflow-action="new-version" data-workflow-id="${workflow.id}">New version</button>`}
        <button class="btn-primary" data-workflow-action="run" data-workflow-id="${workflow.id}">Run</button>
        <button data-workflow-action="clone" data-workflow-id="${workflow.id}">Clone</button>
        <button data-workflow-action="archive" data-workflow-id="${workflow.id}">Archive</button>
      </footer>
    </article>`).join('') : '<div class="empty-agents"><h2>No workflows yet</h2><p>Connect your first agents into a repeatable flow.</p></div>';
  workflowGrid.querySelectorAll('[data-workflow-action]').forEach((button) => button.addEventListener('click', () => handleWorkflowAction(button.dataset.workflowId, button.dataset.workflowAction)));
}

async function handleWorkflowAction(id, action) {
  try {
    const workflow = workflows.find((item) => item.id === id);
    if (action === 'edit') return openWorkflowEditor(workflow);
    if (action === 'run') return openWorkflowRunner(workflow);
    if (action === 'publish') await request(`/api/workflows/${id}/publish`, { method: 'POST' });
    if (action === 'new-version') await request(`/api/workflows/${id}/new-version`, { method: 'POST' });
    if (action === 'archive') await request(`/api/workflows/${id}`, { method: 'DELETE' });
    if (action === 'clone') {
      const cloneId = window.prompt('New workflow ID', `${id}-copy`);
      if (!cloneId) return;
      await request(`/api/workflows/${id}/clone`, { method: 'POST', body: JSON.stringify({ id: cloneId }) });
    }
    await refreshWorkflows();
  } catch (error) { showFeedback(error.message, 'error'); }
}

function emptyWorkflowDefinition(id = 'my-workflow', name = 'My Workflow') {
  return { id, name, description: '', inputSchema: { type: 'object', properties: {} }, nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end', output: '$input' }], edges: [{ from: 'start', to: 'end' }] };
}

function openWorkflowEditor(workflow = null) {
  editingWorkflowId = workflow?.id || '';
  const form = workflowEditorForm.elements;
  form.id.value = workflow?.id || '';
  form.id.disabled = Boolean(workflow);
  form.name.value = workflow?.name || '';
  form.description.value = workflow?.description || '';
  form.definition.value = JSON.stringify(workflow || emptyWorkflowDefinition(), null, 2);
  document.querySelector('#workflowEditorTitle').textContent = workflow ? `Edit ${workflow.name}` : 'New Workflow';
  document.querySelector('#workflowEditorError').textContent = '';
  renderVisualBuilder(workflow || emptyWorkflowDefinition());
  workflowEditorDialog.showModal();
}

function renderVisualBuilderFromJson() {
  try { renderVisualBuilder(JSON.parse(workflowEditorForm.elements.definition.value)); }
  catch { workflowVisualBuilder.innerHTML = '<p class="visual-builder-error">Fix the JSON to restore the visual preview.</p>'; }
}

function renderVisualBuilder(definition) {
  ensureCanvasPositions(definition);
  const paths = definition.edges.map((edge) => renderCanvasEdge(edge, definition.ui.positions)).join('');
  workflowVisualBuilder.innerHTML = `<svg class="workflow-canvas-svg" viewBox="0 0 1200 700" aria-hidden="true"><defs><marker id="canvasArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="arrow-head"/></marker></defs>${paths}</svg>${definition.nodes.map((node) => {
    const position = definition.ui.positions[node.id];
    return `<div class="visual-node-wrap" data-canvas-node="${escapeHtml(node.id)}" style="left:${position.x}px;top:${position.y}px">
      ${node.type !== 'start' ? `<button type="button" class="node-port input" title="Connect here" data-input-port="${escapeHtml(node.id)}"></button>` : ''}
      <button type="button" class="visual-node node-${node.type} ${selectedCanvasNodeId === node.id ? 'selected' : ''}" data-edit-visual-node="${escapeHtml(node.id)}"><span>${escapeHtml(node.type)}</span><strong>${escapeHtml(node.id)}</strong>${node.agentId ? `<small>${escapeHtml(node.agentId)}</small>` : node.toolId ? `<small>${escapeHtml(node.toolId)}</small>` : node.workflowId ? `<small>${escapeHtml(node.workflowId)}</small>` : node.joinId ? `<small>join: ${escapeHtml(node.joinId)}</small>` : node.action ? `<small>${escapeHtml(node.action)}</small>` : ''}</button>
      ${node.type !== 'end' ? `<button type="button" class="node-port output ${connectionSourceNodeId === node.id ? 'connecting' : ''}" title="Start connection" data-output-port="${escapeHtml(node.id)}"></button>` : ''}
    </div>`;
  }).join('')}`;
  workflowVisualBuilder.querySelectorAll('[data-edit-visual-node]').forEach((button) => button.addEventListener('click', () => editVisualNode(button.dataset.editVisualNode)));
  workflowVisualBuilder.querySelectorAll('[data-output-port]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); connectionSourceNodeId = button.dataset.outputPort; renderVisualBuilder(definition); }));
  workflowVisualBuilder.querySelectorAll('[data-input-port]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); connectCanvasNodes(connectionSourceNodeId, button.dataset.inputPort); }));
  workflowVisualBuilder.querySelectorAll('[data-canvas-node]').forEach((element) => attachCanvasDrag(element));
}

function editVisualNode(nodeId) {
  try {
    const definition = JSON.parse(workflowEditorForm.elements.definition.value);
    const node = definition.nodes.find((item) => item.id === nodeId);
    selectedCanvasNodeId = nodeId;
    const references = ['$input', ...definition.nodes.filter((item) => item.id !== nodeId).map((item) => `$nodes.${item.id}.output`)];
    document.querySelector('#workflowNodeInspector').innerHTML = `<h3>${escapeHtml(node.id)}</h3><p>${escapeHtml(node.type)} node</p><div class="reference-helper"><span>Insert reference</span>${references.map((reference) => `<button type="button" data-insert-reference="${escapeHtml(reference)}">${escapeHtml(reference)}</button>`).join('')}</div><textarea id="canvasNodeJson">${escapeHtml(JSON.stringify(node, null, 2))}</textarea><footer><button type="button" data-delete-inspected ${['start', 'end'].includes(node.type) ? 'disabled' : ''}>Delete</button><button type="button" class="btn-primary" data-save-inspected>Apply</button></footer>`;
    document.querySelector('[data-save-inspected]').addEventListener('click', () => saveInspectedNode(nodeId));
    document.querySelector('[data-delete-inspected]').addEventListener('click', () => removeCanvasNode(nodeId));
    document.querySelectorAll('[data-insert-reference]').forEach((button) => button.addEventListener('click', () => insertNodeReference(button.dataset.insertReference)));
    renderVisualBuilder(definition);
  } catch (error) { document.querySelector('#workflowEditorError').textContent = error.message; }
}

function insertNodeReference(reference) {
  const editor = document.querySelector('#canvasNodeJson');
  const start = editor.selectionStart; const end = editor.selectionEnd;
  editor.value = `${editor.value.slice(0, start)}${reference}${editor.value.slice(end)}`;
  editor.focus(); editor.selectionStart = editor.selectionEnd = start + reference.length;
}

function ensureCanvasPositions(definition) {
  definition.ui ||= { positions: {} };
  definition.ui.positions ||= {};
  definition.nodes.forEach((node, index) => {
    const row = Math.floor(index / 3);
    const columnInRow = index % 3;
    const column = row % 2 === 0 ? columnInRow : 2 - columnInRow;
    definition.ui.positions[node.id] ||= { x: 40 + column * 205, y: 55 + row * 145 };
  });
  workflowEditorForm.elements.definition.value = JSON.stringify(definition, null, 2);
}

function renderCanvasEdge(edge, positions) {
  const from = positions[edge.from]; const to = positions[edge.to];
  if (!from || !to) return '';
  const x1 = from.x + 155; const y1 = from.y + 38; const x2 = to.x; const y2 = to.y + 38; const bend = Math.max(50, Math.abs(x2 - x1) / 2);
  const label = edge.when === true ? 'true' : edge.when === false ? 'false' : edge.label || '';
  return `<path marker-end="url(#canvasArrow)" d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 5}">${label}</text>`;
}

function attachCanvasDrag(element) {
  const handle = element.querySelector('.visual-node');
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const startX = event.clientX; const startY = event.clientY; const left = parseFloat(element.style.left); const top = parseFloat(element.style.top);
    handle.setPointerCapture(event.pointerId);
    const move = (next) => { element.style.left = `${Math.max(0, left + next.clientX - startX)}px`; element.style.top = `${Math.max(0, top + next.clientY - startY)}px`; };
    const up = (next) => { handle.releasePointerCapture(next.pointerId); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); persistCanvasPosition(element.dataset.canvasNode, parseFloat(element.style.left), parseFloat(element.style.top)); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

function persistCanvasPosition(nodeId, x, y) {
  const definition = JSON.parse(workflowEditorForm.elements.definition.value); definition.ui ||= { positions: {} }; definition.ui.positions[nodeId] = { x, y }; syncWorkflowDefinition(definition);
}

function connectCanvasNodes(from, to) {
  try {
    if (!from || from === to) return;
    const definition = JSON.parse(workflowEditorForm.elements.definition.value);
    const source = definition.nodes.find((node) => node.id === from);
    let when;
    let label;
    if (source.type === 'condition') { const answer = window.prompt('Condition branch: true or false', 'true'); if (!['true', 'false'].includes(answer)) return; when = answer === 'true'; }
    if (source.type === 'parallel') label = window.prompt('Branch label (optional)', '') || undefined;
    definition.edges = source.type === 'parallel'
      ? definition.edges.filter((edge) => !(edge.from === from && edge.to === to))
      : definition.edges.filter((edge) => !(edge.from === from && (source.type !== 'condition' || edge.when === when)) && !(edge.from === from && edge.to === to));
    definition.edges.push({ from, to, ...(source.type === 'condition' ? { when } : {}), ...(label ? { label } : {}) });
    connectionSourceNodeId = ''; syncWorkflowDefinition(definition);
  } catch (error) { document.querySelector('#workflowEditorError').textContent = error.message; }
}

function saveInspectedNode(nodeId) {
  try { const definition = JSON.parse(workflowEditorForm.elements.definition.value); const index = definition.nodes.findIndex((node) => node.id === nodeId); const next = JSON.parse(document.querySelector('#canvasNodeJson').value); definition.nodes[index] = next; if (next.id !== nodeId) { definition.edges = definition.edges.map((edge) => ({ ...edge, from: edge.from === nodeId ? next.id : edge.from, to: edge.to === nodeId ? next.id : edge.to })); definition.ui.positions[next.id] = definition.ui.positions[nodeId]; delete definition.ui.positions[nodeId]; selectedCanvasNodeId = next.id; } syncWorkflowDefinition(definition); editVisualNode(next.id); } catch (error) { document.querySelector('#workflowEditorError').textContent = error.message; }
}

function removeCanvasNode(nodeId) { const definition = JSON.parse(workflowEditorForm.elements.definition.value); definition.nodes = definition.nodes.filter((node) => node.id !== nodeId); definition.edges = definition.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId); delete definition.ui?.positions?.[nodeId]; selectedCanvasNodeId = ''; document.querySelector('#workflowNodeInspector').innerHTML = '<div class="inspector-empty">Select a node to configure it.</div>'; syncWorkflowDefinition(definition); }

function addVisualNode(type) {
  try {
    const definition = JSON.parse(workflowEditorForm.elements.definition.value);
    const end = definition.nodes.find((node) => node.type === 'end');
    const incoming = definition.edges.find((edge) => edge.to === end.id);
    const id = uniqueNodeId(definition, type);
    const node = type === 'agent'
      ? { id, type, agentId: agents[0]?.id || 'choose-agent', input: {} }
      : type === 'tool'
        ? { id, type, toolId: tools[0]?.id || 'choose-tool', input: {} }
      : type === 'condition'
        ? { id, type, value: '$input.value', operator: 'exists' }
      : type === 'parallel'
        ? { id, type, joinId: 'join' }
      : type === 'join'
        ? { id, type }
      : type === 'subworkflow'
        ? { id, type, workflowId: workflows.find((workflow) => workflow.id !== definition.id)?.id || 'choose-workflow', input: '$input' }
      : type === 'approval'
        ? { id, type, prompt: 'Review the previous step before continuing.' }
        : { id, type, action: 'intake', ticketId: '$input.ticketId', repo: '$input.repo' };
    definition.nodes.splice(definition.nodes.indexOf(end), 0, node);
    if (!['condition', 'parallel'].includes(type) && incoming) {
      definition.edges = definition.edges.filter((edge) => edge !== incoming);
      definition.edges.push({ from: incoming.from, to: id }, { from: id, to: end.id });
    }
    definition.ui ||= { positions: {} };
    definition.ui.positions[id] = { x: 440, y: 280 };
    syncWorkflowDefinition(definition);
  } catch (error) { document.querySelector('#workflowEditorError').textContent = error.message; }
}

async function refreshTools() {
  tools = await request('/api/tools');
  renderTools();
}

function renderTools() {
  toolGrid.innerHTML = tools.length ? tools.map((tool) => `
    <article class="agent-card tool-card"><header><div class="agent-icon">T</div><span class="status-badge">${escapeHtml(tool.status)}</span></header><h2>${escapeHtml(tool.name)}</h2><p>${escapeHtml(tool.description || 'No description yet.')}</p><div class="agent-meta"><span>v${tool.version}</span><span>${escapeHtml(tool.type)}</span><span>${tool.type === 'http' ? escapeHtml(tool.config.method || 'GET') : escapeHtml(tool.config.server || 'MCP')}</span></div><footer>${tool.status === 'draft' ? `<button data-tool-action="edit" data-tool-id="${tool.id}">Edit</button><button data-tool-action="publish" data-tool-id="${tool.id}">Publish</button>` : `<button data-tool-action="new-version" data-tool-id="${tool.id}">New version</button>`}<button class="btn-primary" data-tool-action="test" data-tool-id="${tool.id}">Test</button><button data-tool-action="clone" data-tool-id="${tool.id}">Clone</button><button data-tool-action="archive" data-tool-id="${tool.id}">Archive</button></footer></article>`).join('') : '<div class="empty-agents"><h2>No tools yet</h2><p>Create an allowlisted HTTP Tool or register an MCP capability.</p></div>';
  toolGrid.querySelectorAll('[data-tool-action]').forEach((button) => button.addEventListener('click', () => handleToolAction(button.dataset.toolId, button.dataset.toolAction)));
}

async function handleToolAction(id, action) {
  try {
    const tool = tools.find((item) => item.id === id);
    if (action === 'edit') return openToolEditor(tool);
    if (action === 'test') return openToolTest(tool);
    if (action === 'publish') await request(`/api/tools/${id}/publish`, { method: 'POST' });
    if (action === 'new-version') await request(`/api/tools/${id}/new-version`, { method: 'POST' });
    if (action === 'archive') await request(`/api/tools/${id}`, { method: 'DELETE' });
    if (action === 'clone') { const newId = window.prompt('New tool ID', `${id}-copy`); if (!newId) return; await request(`/api/tools/${id}/clone`, { method: 'POST', body: JSON.stringify({ id: newId }) }); }
    await refreshTools();
  } catch (error) { showFeedback(error.message, 'error'); }
}

function openToolEditor(tool = null) {
  editingToolId = tool?.id || '';
  const form = toolEditorForm.elements;
  form.id.value = tool?.id || ''; form.id.disabled = Boolean(tool); form.name.value = tool?.name || ''; form.type.value = tool?.type || 'http'; form.timeoutMs.value = tool?.timeoutMs || 30000; form.description.value = tool?.description || ''; form.config.value = JSON.stringify(tool?.config || { url: 'https://api.example.com/items/{{id}}', method: 'GET', allowedHosts: ['api.example.com'], headers: {} }, null, 2); form.secretEnv.value = (tool?.secretEnv || []).join(', '); form.inputSchema.value = JSON.stringify(tool?.inputSchema || { type: 'object', properties: {} }, null, 2); form.outputSchema.value = JSON.stringify(tool?.outputSchema || { type: 'object', properties: {} }, null, 2);
  document.querySelector('#toolEditorTitle').textContent = tool ? `Edit ${tool.name}` : 'New Tool'; document.querySelector('#toolEditorError').textContent = ''; toolEditorDialog.showModal();
}

async function saveToolDraft(event) {
  event.preventDefault(); const form = toolEditorForm.elements;
  try {
    const payload = { id: editingToolId || form.id.value, name: form.name.value, type: form.type.value, timeoutMs: Number(form.timeoutMs.value), description: form.description.value, config: JSON.parse(form.config.value), secretEnv: form.secretEnv.value.split(',').map((item) => item.trim()).filter(Boolean), inputSchema: JSON.parse(form.inputSchema.value), outputSchema: JSON.parse(form.outputSchema.value) };
    await request(editingToolId ? `/api/tools/${editingToolId}` : '/api/tools', { method: editingToolId ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); toolEditorDialog.close(); await refreshTools();
  } catch (error) { document.querySelector('#toolEditorError').textContent = error.message; }
}

function openToolTest(tool) { testingTool = tool; document.querySelector('#toolTestTitle').textContent = tool.name; document.querySelector('#toolTestMeta').textContent = `v${tool.version} · ${tool.type}`; document.querySelector('#toolTestInput').value = JSON.stringify(exampleFromSchema(tool.inputSchema), null, 2); document.querySelector('#toolTestOutput').textContent = 'Ready.'; toolTestDialog.showModal(); }
async function executeSelectedTool() { try { const input = JSON.parse(document.querySelector('#toolTestInput').value); const result = await request(`/api/tools/${testingTool.id}/test`, { method: 'POST', body: JSON.stringify(input) }); document.querySelector('#toolTestOutput').textContent = JSON.stringify(result, null, 2); } catch (error) { document.querySelector('#toolTestOutput').textContent = error.message; } }

function uniqueNodeId(definition, type) {
  let index = 1;
  while (definition.nodes.some((node) => node.id === `${type}-${index}`)) index += 1;
  return `${type}-${index}`;
}

function moveVisualNode(nodeId, direction) {
  try {
    const definition = JSON.parse(workflowEditorForm.elements.definition.value);
    const sequence = linearNodeSequence(definition);
    const index = sequence.indexOf(nodeId);
    const target = direction === 'left' ? index - 1 : index + 1;
    if (index <= 0 || target <= 0 || target >= sequence.length - 1) return;
    [sequence[index], sequence[target]] = [sequence[target], sequence[index]];
    definition.nodes.sort((a, b) => sequence.indexOf(a.id) - sequence.indexOf(b.id));
    definition.edges = sequence.slice(0, -1).map((from, edgeIndex) => ({ from, to: sequence[edgeIndex + 1] }));
    syncWorkflowDefinition(definition);
  } catch (error) { document.querySelector('#workflowEditorError').textContent = error.message; }
}

function removeVisualNode(nodeId) {
  try {
    const definition = JSON.parse(workflowEditorForm.elements.definition.value);
    const sequence = linearNodeSequence(definition).filter((id) => id !== nodeId);
    definition.nodes = definition.nodes.filter((node) => node.id !== nodeId).sort((a, b) => sequence.indexOf(a.id) - sequence.indexOf(b.id));
    definition.edges = sequence.slice(0, -1).map((from, edgeIndex) => ({ from, to: sequence[edgeIndex + 1] }));
    syncWorkflowDefinition(definition);
  } catch (error) { document.querySelector('#workflowEditorError').textContent = error.message; }
}

function linearNodeSequence(definition) {
  if (definition.nodes.some((node) => node.type === 'condition')) throw new Error('Reorder branched workflows through JSON.');
  const sequence = [];
  let current = definition.nodes.find((node) => node.type === 'start')?.id;
  while (current) {
    if (sequence.includes(current)) throw new Error('Cannot edit a cyclic workflow visually.');
    sequence.push(current);
    current = definition.edges.find((edge) => edge.from === current)?.to;
  }
  if (sequence.length !== definition.nodes.length) throw new Error('Visual reorder requires one linear path.');
  return sequence;
}

function syncWorkflowDefinition(definition) {
  workflowEditorForm.elements.definition.value = JSON.stringify(definition, null, 2);
  renderVisualBuilder(definition);
}

async function openTemplatePicker() {
  try {
    const templates = await request('/api/workflow-templates');
    const list = document.querySelector('#workflowTemplateList');
    list.innerHTML = templates.map((template, index) => `<button type="button" data-template-index="${index}"><strong>${escapeHtml(template.name)}</strong><span>${escapeHtml(template.description || '')}</span><small>${template.nodes.length} nodes</small></button>`).join('');
    list.querySelectorAll('[data-template-index]').forEach((button) => button.addEventListener('click', () => {
      workflowTemplateDialog.close();
      const template = structuredClone(templates[Number(button.dataset.templateIndex)]);
      template.id = `${template.id}-${Date.now().toString().slice(-5)}`;
      template.name = `${template.name} Copy`;
      openWorkflowEditor(template);
      editingWorkflowId = '';
      workflowEditorForm.elements.id.disabled = false;
    }));
    workflowTemplateDialog.showModal();
  } catch (error) { showFeedback(error.message, 'error'); }
}

async function saveWorkflowDraft(event) {
  event.preventDefault();
  const form = workflowEditorForm.elements;
  try {
    const definition = JSON.parse(form.definition.value);
    const payload = { ...definition, id: editingWorkflowId || form.id.value, name: form.name.value, description: form.description.value };
    await request(editingWorkflowId ? `/api/workflows/${editingWorkflowId}` : '/api/workflows', { method: editingWorkflowId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    workflowEditorDialog.close();
    await refreshWorkflows();
  } catch (error) { document.querySelector('#workflowEditorError').textContent = error.message; }
}

function openWorkflowRunner(workflow) {
  runningWorkflow = workflow;
  document.querySelector('#workflowRunTitle').textContent = workflow.name;
  document.querySelector('#workflowRunMeta').textContent = `v${workflow.version} · ${workflow.nodes.length} nodes`;
  document.querySelector('#workflowRunInput').value = JSON.stringify(exampleFromSchema(workflow.inputSchema), null, 2);
  document.querySelector('#workflowRunOutput').textContent = 'Ready.';
  document.querySelector('#workflowNodeTimeline').innerHTML = '';
  workflowRunDialog.showModal();
}

async function runSelectedWorkflow() {
  try {
    const input = JSON.parse(document.querySelector('#workflowRunInput').value);
    const idempotencyKey = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const run = await request(`/api/workflows/${runningWorkflow.id}/runs`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) });
    await pollWorkflowRun(run.id);
  } catch (error) { document.querySelector('#workflowRunOutput').textContent = error.message; }
}

async function pollWorkflowRun(id) {
  const run = await request(`/api/workflow-runs/${id}`);
  document.querySelector('#workflowNodeTimeline').innerHTML = Object.values(run.nodes).map((node) => `<div class="workflow-node-run ${node.status}"><strong>${escapeHtml(node.id)}</strong><span>${escapeHtml(node.type)}</span><em>${escapeHtml(node.status)}</em></div>`).join('');
  document.querySelector('#workflowRunOutput').textContent = JSON.stringify({ status: run.status, currentNodeId: run.currentNodeId, output: run.output, error: run.error, durationMs: run.durationMs, events: run.events }, null, 2);
  const actions = document.querySelector('#workflowRunActions');
  actions.innerHTML = run.status === 'waiting_approval'
    ? '<button type="button" data-workflow-decision="reject">Reject</button><button class="btn-primary" type="button" data-workflow-decision="approve">Approve</button>'
    : run.status === 'failed'
      ? '<button type="button" data-workflow-retry>Retry from start</button><button class="btn-primary" type="button" data-workflow-resume>Resume failed node</button>'
      : run.status === 'cancelled'
        ? '<button class="btn-primary" type="button" data-workflow-retry>Retry as new run</button>'
      : run.status === 'running'
        ? '<button type="button" data-workflow-cancel>Cancel run</button>'
        : '';
  actions.querySelectorAll('[data-workflow-decision]').forEach((button) => button.addEventListener('click', async () => {
    const approved = button.dataset.workflowDecision === 'approve';
    const note = window.prompt(approved ? 'Approval note' : 'Reason for rejection', '') ?? '';
    await request(`/api/workflow-runs/${id}/approval`, { method: 'POST', body: JSON.stringify({ approved, note }) });
    await pollWorkflowRun(id);
  }));
  actions.querySelector('[data-workflow-retry]')?.addEventListener('click', async () => {
    const retry = await request(`/api/workflow-runs/${id}/retry`, { method: 'POST' });
    await pollWorkflowRun(retry.id);
  });
  actions.querySelector('[data-workflow-resume]')?.addEventListener('click', async () => {
    const resumed = await request(`/api/workflow-runs/${id}/resume`, { method: 'POST' });
    await pollWorkflowRun(resumed.id);
  });
  actions.querySelector('[data-workflow-cancel]')?.addEventListener('click', async () => {
    await request(`/api/workflow-runs/${id}/cancel`, { method: 'POST' });
    await pollWorkflowRun(id);
  });
  if (['queued', 'running'].includes(run.status)) window.setTimeout(() => void pollWorkflowRun(id), 800);
}

function renderRepoSelect() {
  const current = repoSelect.value;
  repoSelect.innerHTML = repos
    .map((repo) => `<option value="${escapeHtml(repo.repo)}">${escapeHtml(repo.repo)}</option>`)
    .join('');

  if (current) {
    repoSelect.value = current;
  }
}

function renderBoard() {
  const visibleIssues = filterIssuesBySummary(issues);
  boardCount.textContent = `${visibleIssues.length} work item${visibleIssues.length === 1 ? '' : 's'}`;
  kanbanBoard.innerHTML = columns.map((column) => {
    const columnIssues = visibleIssues.filter((issue) => column.statuses.includes(issue.status));
    return `
      <section class="board-column ${column.tone}">
        <header class="column-heading">
          <div>
            <span class="state-dot"></span>
            <strong>${escapeHtml(column.title)}</strong>
            <span>${columnIssues.length}</span>
          </div>
        </header>
        <div class="column-cards">
          ${columnIssues.length ? columnIssues.map(renderIssueCard).join('') : renderEmptyColumn(column.id)}
        </div>
      </section>
    `;
  }).join('');

  kanbanBoard.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const card = button.closest('article.issue-card');
      const humanComment = card?.querySelector('.human-comment')?.value?.trim() || '';
      void handleAction(button.dataset.ticket, button.dataset.action, humanComment);
    });
  });

  kanbanBoard.querySelectorAll('.more-actions').forEach((menu) => {
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  });

  kanbanBoard.querySelectorAll('article.issue-card').forEach((card) => {
    const openCard = () => {
      const issue = issues.find((item) => item.ticketId === card.dataset.ticket);
      if (issue) openIssueWorkspace(issue);
    };
    card.addEventListener('click', openCard);
    card.addEventListener('keydown', (event) => {
      if (event.target === card && event.key === 'Enter') openCard();
    });
  });
}

function renderSummaryStrip() {
  const active = issues.filter((issue) => Boolean(issue.activeAgent)).length;
  const waiting = issues.filter((issue) => ['WAITING_FOR_DEPENDENCY', 'WAITING_FOR_SIBLINGS'].includes(issue.status)).length;
  const review = issues.filter(isReviewIssue).length;
  const failed = issues.filter((issue) => ['FAILED', 'BLOCKED', 'INTERRUPTED'].includes(issue.status)).length;
  const contextRisk = issues.filter((issue) => ['Needs Split', 'Large Context'].includes(issue.contextHealth?.risk)).length;
  const usage = renderUsagePills();

  summaryStrip.innerHTML = [
    ['Active', active, 'active'],
    ['Waiting', waiting, 'waiting'],
    ['Review', review, 'review'],
    ['Failed', failed, 'failed'],
    ['Context Risk', contextRisk, 'context']
  ].map(([label, value, tone]) => `
    <button class="summary-pill ${tone} ${activeSummaryFilter === label ? 'selected' : ''}" type="button" data-summary="${escapeHtml(label)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </button>
  `).join('') + usage;

  summaryStrip.querySelectorAll('[data-summary]').forEach((button) => {
    button.addEventListener('click', () => {
      activeSummaryFilter = activeSummaryFilter === button.dataset.summary ? '' : button.dataset.summary;
      persistUiState();
      renderSummaryStrip();
      renderBoard();
    });
  });
}

function renderUsagePills() {
  if (!claudeUsage) {
    return '';
  }

  if (!claudeUsage.available) {
    return `
      <div class="summary-pill usage unavailable" title="${escapeHtml(claudeUsage.error || 'ccusage unavailable')}">
        <span>Claude Usage</span>
        <strong>N/A</strong>
      </div>
    `;
  }

  const today = claudeUsage.today;
  const month = claudeUsage.month;
  const activeBlock = claudeUsage.activeBlock;
  return [
    today ? usagePill('Today used', formatTokens(today.totalTokens), `${formatCost(today.totalCost)} · ${today.modelsUsed?.join(', ') || 'Claude'}`) : '',
    month ? usagePill('Month used', formatTokens(month.totalTokens), `${formatCost(month.totalCost)} · ${month.modelsUsed?.join(', ') || 'Claude'}`) : '',
    activeBlock ? usagePill(
      'Block used',
      formatTokens(activeBlock.totalTokens),
      `${Math.round(activeBlock.remainingMinutes || 0)}m left · ${formatCost(activeBlock.totalCost)} now · ${formatCost(activeBlock.projectedCost)} projected`
    ) : ''
  ].filter(Boolean).join('');
}

function usagePill(label, value, title) {
  return `
    <div class="summary-pill usage" title="${escapeHtml(title)}">
      <span>${escapeHtml(label)}</span>
      <div>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(title)}</small>
      </div>
    </div>
  `;
}

function filterIssuesBySummary(items) {
  let filtered = items;
  if (activeSummaryFilter === 'Active') {
    filtered = items.filter((issue) => Boolean(issue.activeAgent));
  } else if (activeSummaryFilter === 'Waiting') {
    filtered = items.filter((issue) => ['WAITING_FOR_DEPENDENCY', 'WAITING_FOR_SIBLINGS'].includes(issue.status));
  } else if (activeSummaryFilter === 'Review') {
    filtered = items.filter((issue) => ['REVIEW_READY', 'FIXING_REVIEW', 'INTEGRATION_REQUIRED'].includes(issue.status));
  } else if (activeSummaryFilter === 'Failed') {
    filtered = items.filter((issue) => ['FAILED', 'BLOCKED', 'INTERRUPTED', 'CANCELED'].includes(issue.status));
  } else if (activeSummaryFilter === 'Context Risk') {
    filtered = items.filter((issue) => ['Needs Split', 'Large Context'].includes(issue.contextHealth?.risk));
  }
  if (!searchQuery) return filtered;
  return filtered.filter((issue) => [issue.ticketId, issue.title, issue.repo, issue.type, issue.status]
    .some((value) => String(value || '').toLowerCase().includes(searchQuery)));
}

function renderRightRail() {
  hiddenColumns.innerHTML = statusOverviewGroups.map((group) => {
    const groupIssues = issues.filter((issue) => group.statuses.includes(issue.status));
    const count = groupIssues.length;
    const isExpanded = expandedGroups.has(group.title);
    const issueList = isExpanded && count > 0
      ? `<div class="rail-group-issues">${groupIssues.map((i) => `
          <div class="rail-issue">
            <span class="rail-issue-id">${escapeHtml(i.ticketId)}</span>
            <span class="rail-issue-title">${escapeHtml(i.title)}</span>
          </div>`).join('')}</div>`
      : '';
    return `
      <div class="rail-group">
        <div class="rail-row ${group.tone} rail-row-toggle" data-group="${escapeHtml(group.title)}">
          <span class="state-dot"></span>
          <strong>${escapeHtml(group.title)}</strong>
          <span>${count} <span class="rail-chevron">${isExpanded ? '▴' : '▾'}</span></span>
        </div>
        ${issueList}
      </div>
    `;
  }).join('');

  hiddenColumns.querySelectorAll('.rail-row-toggle').forEach((row) => {
    row.addEventListener('click', () => {
      const title = row.dataset.group;
      if (expandedGroups.has(title)) {
        expandedGroups.delete(title);
      } else {
        expandedGroups.add(title);
      }
      renderRightRail();
    });
  });

  repoGroups.innerHTML = repos.map((repo) => {
    const count = issues.filter((issue) => issue.repo === repo.repo).length;
    return `
      <div class="rail-row">
        <span class="repo-mark">${escapeHtml(repo.repo.slice(0, 2).toUpperCase())}</span>
        <strong>${escapeHtml(repo.repo)}</strong>
        <span>${count}</span>
      </div>
    `;
  }).join('');
}

function renderIssueCard(issue) {
  const buttons = issue.buttons || {};
  const primaryActions = getPrimaryActions(issue, buttons);
  const quickViewActions = getQuickViewActions(issue, buttons);
  const utilityActions = getUtilityActions(issue, buttons, primaryActions, quickViewActions);

  return `
    <article class="issue-card ${selectedIssueId === issue.ticketId ? 'selected' : ''} ${isReviewIssue(issue) ? 'review-card' : ''}" data-ticket="${escapeHtml(issue.ticketId)}" tabindex="0">
      <div class="card-kicker">
        <span>${escapeHtml(issue.ticketId)}</span>
        <span class="status-badge ${escapeHtml(statusTone(issue.status))}">${escapeHtml(labelForStatus(issue.status))}</span>
      </div>
      <header>
        <div class="issue-title">
          <span class="state-ring ${escapeHtml(statusTone(issue.status))}"></span>
          <strong>${escapeHtml(issue.title)}</strong>
        </div>
      </header>
      <div class="card-meta">
        <span>${escapeHtml(issue.type)}</span>
        <span>${escapeHtml(issue.repo)}</span>
        <span>${escapeHtml(formatUpdated(issue.updatedAt))}</span>
        ${issue.pushedAt ? `<span class="pushed-badge">pushed ${escapeHtml(formatUpdated(issue.pushedAt))}</span>` : ''}
        ${issue.reviewMode ? `<span class="review-mode-badge review-mode-${escapeHtml(issue.reviewMode)}">${escapeHtml(issue.reviewMode)}</span>` : ''}
        ${issue.executionMode && issue.executionMode !== 'parallel' ? `<span class="execution-mode-badge execution-mode-${escapeHtml(issue.executionMode)}">${escapeHtml(issue.executionMode)}</span>` : ''}
      </div>
      <div class="agent-line">
        ${issue.activeAgent ? `Agent ${escapeHtml(issue.activeAgent.kind)} · pid ${escapeHtml(String(issue.activeAgent.pid))}` : escapeHtml(issue.status)}
      </div>
      ${renderLoopProgress(issue)}
      ${renderIssueBadges(issue)}
      ${issue.status === 'WAITING_FOR_DEPENDENCY' && issue.dependsOn?.length
        ? `<div class="blocked-by-line">Blocked by ${escapeHtml(issue.dependsOn.join(', '))}</div>`
        : ''}
      ${issue.status === 'WAITING_FOR_SIBLINGS'
        ? `<div class="blocked-by-line">Waiting for siblings ${escapeHtml((issue.reviewRouting?.pendingSiblings || issue.blocks || []).join(', ') || 'to finish')}</div>`
        : ''}
      ${issue.workflowActive ? `<div class="blocked-by-line">Workflow active${issue.workflowCurrentChild ? ` · running ${escapeHtml(issue.workflowCurrentChild)}` : ''}</div>` : ''}
      ${renderSplitProgress(issue)}
      ${renderProgress(issue)}
      ${issue.lastError ? `<div class="error-line">${escapeHtml(issue.lastError)}</div>` : ''}
      <div class="actions action-strip">
        ${primaryActions.map(([action, label]) => actionButton(issue, action, label, 'primary')).join('')}
        ${quickViewActions.map(([action, label]) => actionButton(issue, action, label, 'secondary')).join('')}
        ${issue.activeAgent ? actionButton(issue, 'stop', 'Stop', 'danger') : ''}
        ${utilityActions.length ? `
          <details class="more-actions">
            <summary>More</summary>
            <div class="more-action-list">
              ${utilityActions.map(([action, label]) => actionButton(issue, action, label, action === 'delete' ? 'danger' : 'secondary')).join('')}
            </div>
          </details>
        ` : ''}
      </div>
    </article>
  `;
}

function renderIssueBadges(issue) {
  const health = issue.contextHealth || {};
  const badges = [
    [`Context ${health.size || 'Low'}`, riskClass(health.risk || 'Context OK')],
    issue.owns?.length ? [`Owns ${issue.owns.length}`, 'split'] : null,
    issue.dependsOn?.length ? [`Depends ${issue.dependsOn.length}`, 'waiting'] : null,
    issue.worktreeStatus?.dirtyCount ? [`Dirty ${issue.worktreeStatus.dirtyCount}`, 'risk-high'] : null,
    issue.reviewRouting?.hasDependencyFinding ? ['Dependency review', 'waiting'] : null,
    issue.loop ? [`Loop ${issue.loop.iteration || 0}/${issue.loop.maxIterations || 3}`, issue.loop.enabled ? 'waiting' : 'split'] : null
  ].filter(Boolean);

  if (!badges.length) return '';
  return `<div class="issue-badges">${badges.map(([label, tone]) => `<span class="${escapeHtml(tone)}">${escapeHtml(label)}</span>`).join('')}</div>`;
}

function isReviewIssue(issue) {
  return ['REVIEW_READY', 'FIXING_REVIEW', 'MANUAL_DONE', 'INTEGRATION_READY', 'INTEGRATION_REQUIRED'].includes(issue.status);
}

async function renderSelectedDetail(options = {}) {
  if (!selectedIssueId) {
    detailTabs.innerHTML = '';
    return;
  }

  const issue = issues.find((item) => item.ticketId === selectedIssueId);
  if (!issue) {
    detailsDrawer.classList.remove('open', 'review-workspace');
    detailsDrawer.setAttribute('aria-hidden', 'true');
    return;
  }

  detailsDrawer.classList.add('open');
  detailsDrawer.classList.toggle('review-workspace', isReviewIssue(issue) && ['review', 'diff'].includes(selectedDetailTab));
  detailsDrawer.setAttribute('aria-hidden', 'false');
  drawerSubtitle.textContent = `${issue.repo} / ${labelForStatus(issue.status)}`;
  drawerStatusDot.className = `state-dot ${statusTone(issue.status)}`;
  const draftNote = drawerContext.querySelector('#drawerReviewNote')?.value;
  const previousTarget = drawerContext.querySelector('#inlineCommentTarget');
  const inlineDraft = {
    file: previousTarget?.dataset.file || '',
    line: Number(previousTarget?.dataset.line) || 0,
    body: drawerContext.querySelector('#inlineCommentBody')?.value || ''
  };
  drawerContext.innerHTML = renderDrawerContext(issue, draftNote, inlineDraft);
  if (issue.buttons?.viewDiff) void renderChangedFiles(issue);
  bindReviewCommentControls(issue);
  drawerActions.innerHTML = renderDrawerActions(issue);
  drawerActions.querySelectorAll('[data-drawer-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const note = drawerContext.querySelector('#drawerReviewNote')?.value?.trim() || '';
      void handleAction(issue.ticketId, button.dataset.drawerAction, note);
    });
  });
  renderDetailTabs();

  const viewKey = `${issue.ticketId}:${selectedDetailTab}:${issue.updatedAt || ''}`;
  outputTitle.textContent = selectedDetailTab === 'diff' && selectedDiffFile
    ? `${issue.ticketId} / ${selectedDiffFile}`
    : `${issue.ticketId} ${selectedDetailTab}`;
  if (options.preserveContent && output.dataset.viewKey === viewKey) return;
  output.dataset.viewKey = viewKey;
  if (selectedDetailTab === 'overview') {
    setOutput(renderIssueOverview(issue));
    return;
  }
  if (selectedDetailTab === 'context') {
    setOutput(renderIssueContext(issue));
    return;
  }
  if (selectedDetailTab === 'split') {
    try {
      setOutput(await renderSplitDetail(issue));
    } catch (error) {
      showActionError(issue.ticketId, error);
    }
    return;
  }
  if (selectedDetailTab === 'loop') {
    setOutput(renderLoopDetail(issue));
    return;
  }

  const action = {
    plan: 'plan',
    logs: logActionForIssue(issue),
    diff: 'diff',
    review: 'review-result'
  }[selectedDetailTab];

  setOutput('Loading...');
  try {
    setOutput(await loadDetailAction(issue.ticketId, action), selectedDetailTab);
  } catch (error) {
    showActionError(issue.ticketId, error);
  }
}

async function renderChangedFiles(issue) {
  const container = drawerContext.querySelector('#changedFilesList');
  if (!container) return;
  try {
    const files = await request(`/api/work-items/${issue.ticketId}/changed-files`);
    if (!files.length) {
      container.innerHTML = '<span class="file-list-empty">No changed files</span>';
      return;
    }
    container.innerHTML = files.map((file) => {
      const parts = file.split('/');
      const name = parts.pop();
      const directory = parts.join('/');
      return `
        <button class="changed-file ${selectedDiffFile === file ? 'active' : ''}" type="button" data-diff-file="${escapeHtml(file)}" title="${escapeHtml(file)}">
          <span>${escapeHtml(name)}</span>
          ${directory ? `<small>${escapeHtml(directory)}</small>` : ''}
        </button>
      `;
    }).join('');
    container.querySelectorAll('[data-diff-file]').forEach((button) => {
      button.addEventListener('click', () => void openDiffFile(issue.ticketId, button.dataset.diffFile));
    });
  } catch (error) {
    container.innerHTML = `<span class="file-list-empty">${escapeHtml(error.message)}</span>`;
  }
}

async function openDiffFile(ticketId, file, line = 0) {
  selectedDiffFile = file;
  pendingDiffLine = Number(line) || 0;
  selectedDetailTab = 'diff';
  persistUiState();
  renderDetailTabs();
  const issue = issues.find((item) => item.ticketId === ticketId);
  if (issue) void renderChangedFiles(issue);
  outputTitle.textContent = `${ticketId} / ${file}`;
  setOutput('Loading changes...');
  try {
    const diff = await requestText(`/api/work-items/${ticketId}/diff?file=${encodeURIComponent(file)}`);
    setOutput(diff, 'diff');
    if (pendingDiffLine) {
      const target = output.querySelector(`[data-new-line="${pendingDiffLine}"]`);
      target?.scrollIntoView({ block: 'center' });
      target?.classList.add('diff-target');
    }
  } catch (error) {
    showActionError(ticketId, error);
  }
}

function setOutput(content, mode = 'plain') {
  output.className = `output-view output-${mode}`;
  if (mode === 'review') {
    output.innerHTML = renderReviewOutput(content);
    output.querySelectorAll('[data-review-file]').forEach((button) => {
      button.addEventListener('click', () => {
        void openDiffFile(selectedIssueId, button.dataset.reviewFile, button.dataset.reviewLine);
      });
    });
    return;
  }
  if (mode === 'diff') {
    output.innerHTML = renderDiffOutput(content);
    output.querySelectorAll('.diff-commentable').forEach((line) => {
      line.addEventListener('click', () => selectInlineCommentTarget(line.dataset.diffFile, line.dataset.newLine));
    });
    return;
  }
  output.textContent = content;
}

function renderReviewOutput(content = '') {
  if (!String(content).trim() || /review result (?:not found|has not run)/i.test(content)) {
    return `
      <section class="review-empty review-unavailable">
        <span class="review-empty-mark" aria-hidden="true">·</span>
        <div><strong>Review not available</strong><p>${escapeHtml(String(content).trim() || 'Run AI review to generate findings.')}</p></div>
      </section>
    `;
  }
  const lines = String(content).split('\n');
  const findings = [];
  let current = null;
  const findingPattern = /^\s*(?:\[[^\]]+\]\s*)?(CRITICAL|HIGH|DEPENDENCY|INTEGRATION|NOTE)\s*[:\-]\s*(.*)$/i;
  for (const line of lines) {
    const match = line.match(findingPattern);
    if (match) {
      current = { severity: match[1].toUpperCase(), title: match[2].trim(), body: [] };
      findings.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }

  if (!findings.length) {
    return `
      <section class="review-empty">
        <span class="review-empty-mark" aria-hidden="true">✓</span>
        <div>
          <strong>No blocking findings</strong>
          <p>${escapeHtml(content.trim() || 'AI review completed without findings.')}</p>
        </div>
      </section>
    `;
  }

  const blocking = findings.filter((finding) => ['CRITICAL', 'HIGH', 'INTEGRATION'].includes(finding.severity)).length;
  return `
    <header class="review-summary">
      <div><strong>${findings.length}</strong><span>findings</span></div>
      <div class="${blocking ? 'summary-blocking' : ''}"><strong>${blocking}</strong><span>blocking</span></div>
    </header>
    <div class="review-findings">
      ${findings.map((finding, index) => {
        const location = extractFindingLocation(`${finding.title}\n${finding.body.join('\n')}`);
        return `
        <article class="review-finding finding-${finding.severity.toLowerCase()}">
          <header>
            <span>${escapeHtml(finding.severity)}</span>
            <small>#${index + 1}</small>
          </header>
          <strong>${escapeHtml(finding.title || 'Review finding')}</strong>
          ${finding.body.join('\n').trim() ? `<pre>${escapeHtml(finding.body.join('\n').trim())}</pre>` : ''}
          ${location ? `<button class="finding-location" type="button" data-review-file="${escapeHtml(location.file)}" data-review-line="${location.line || ''}">${escapeHtml(location.file)}${location.line ? `:${location.line}` : ''}</button>` : ''}
        </article>
      `;
      }).join('')}
    </div>
  `;
}

function extractFindingLocation(text) {
  const match = String(text).match(/\b((?:src|spec|test|tests|packages|apps|libs|locale)\/[\w./-]+\.[a-z0-9]+)(?::(\d+))?/i);
  return match ? { file: match[1], line: Number(match[2]) || 0 } : null;
}

function renderDiffOutput(content = '') {
  const text = String(content);
  if (!text.trim() || text.trim() === '(no diff)') {
    return '<div class="diff-empty"><div><strong>No changes</strong><span>The worktree matches the base branch.</span></div></div>';
  }
  let nextNewLine = 0;
  let currentFile = selectedDiffFile;
  return `<div class="diff-view">${text.split('\n').map((line) => {
    const type = line.startsWith('diff --git')
      ? 'file'
      : line.startsWith('@@')
        ? 'hunk'
        : line.startsWith('+') && !line.startsWith('+++')
          ? 'added'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'removed'
            : line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ')
              ? 'meta'
              : 'context';
    if (type === 'file') {
      currentFile = line.match(/^diff --git a\/(.+?) b\/(.+)$/)?.[2] || currentFile;
    }
    if (type === 'hunk') {
      nextNewLine = Number(line.match(/\+(\d+)/)?.[1] || 0);
    }
    let newLine = 0;
    if (type === 'added' || (type === 'context' && nextNewLine && (line.startsWith(' ') || line === ''))) {
      newLine = nextNewLine;
      nextNewLine += 1;
    }
    return `<div class="diff-line diff-${type}${newLine ? ' diff-commentable' : ''}"${newLine ? ` data-diff-file="${escapeHtml(currentFile || '')}" data-new-line="${newLine}"` : ''}><code>${escapeHtml(line || ' ')}</code></div>`;
  }).join('')}</div>`;
}

function renderDrawerActions(issue) {
  if (issue.activeAgent) {
    return `<button class="btn-stop" type="button" data-drawer-action="stop">Stop</button>`;
  }
  if (issue.status === 'REVIEW_READY') {
    return [
      actionButtonForDrawer('request-fix', 'Request fix', 'secondary'),
      actionButtonForDrawer('approve', 'Approve', 'primary')
    ].join('');
  }
  if (['FIXING_REVIEW', 'INTEGRATION_REQUIRED'].includes(issue.status)) {
    return [
      actionButtonForDrawer('takeover', 'Take over', 'secondary'),
      actionButtonForDrawer('proceed', 'Fix findings', 'primary')
    ].join('');
  }
  if (['MANUAL_DONE', 'INTEGRATION_READY'].includes(issue.status)) {
    return actionButtonForDrawer('review', 'Run AI review', 'primary');
  }
  return actionButtonForDrawer('takeover', 'Take over', 'secondary');
}

function actionButtonForDrawer(action, label, variant) {
  return `<button class="${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}" type="button" data-drawer-action="${action}">${label}</button>`;
}

function renderDrawerContext(issue, draftNote, inlineDraft = {}) {
  const reviewMode = isReviewIssue(issue);
  const canComment = ['REVIEW_READY', 'FIXING_REVIEW', 'INTEGRATION_REQUIRED'].includes(issue.status);
  const checks = reviewMode ? [
    ['Plan available', Boolean(issue.featureFilePath)],
    ['Changes available', Boolean(issue.buttons?.viewDiff)],
    ['AI review complete', Boolean(issue.reviewResultPath)],
    ['Blocking findings', Boolean(issue.reviewRouting?.hasBlockingFinding || issue.reviewRouting?.hasIntegrationFinding), true]
  ] : [];
  return `
    <section class="context-section">
      <span class="context-label">Status</span>
      <strong>${escapeHtml(labelForStatus(issue.status))}</strong>
      <span class="context-copy">${escapeHtml(issue.ticketId)} · ${escapeHtml(issue.type)}</span>
    </section>
    ${reviewMode ? `
      <section class="context-section review-gates">
        <span class="context-label">Review gate</span>
        ${checks.map(([label, checked, negative]) => `
          <div class="review-check ${negative && checked ? 'failed' : checked ? 'passed' : ''}">
            <span aria-hidden="true">${negative ? (checked ? '!' : '✓') : (checked ? '✓' : '·')}</span>
            <span>${escapeHtml(label)}</span>
          </div>
        `).join('')}
      </section>
      <section class="context-section">
        <label class="context-label" for="drawerReviewNote">Instructions</label>
        <textarea id="drawerReviewNote" rows="5" placeholder="Add focused instructions for the next fix pass...">${escapeHtml(draftNote ?? issue.humanComment ?? '')}</textarea>
      </section>
      ${canComment ? `<section class="context-section inline-review-section">
        <span class="context-label">Inline comment</span>
        <div id="inlineCommentTarget" class="inline-comment-target" data-file="${escapeHtml(inlineDraft.file || '')}" data-line="${inlineDraft.line || ''}">
          ${inlineDraft.file ? `${escapeHtml(inlineDraft.file)}:${inlineDraft.line}` : 'Select a changed line'}
        </div>
        <textarea id="inlineCommentBody" rows="3" placeholder="What should change here?">${escapeHtml(inlineDraft.body || '')}</textarea>
        <button id="addInlineComment" type="button" ${inlineDraft.file ? '' : 'disabled'}>Add comment</button>
        <div class="review-comments-list">
          ${renderReviewComments(issue.reviewComments || [])}
        </div>
      </section>` : ''}
    ` : ''}
    ${issue.buttons?.viewDiff ? `
      <section class="context-section changed-files-section">
        <span class="context-label">Changed files</span>
        <div id="changedFilesList" class="changed-files-list"><span class="file-list-empty">Loading...</span></div>
      </section>
    ` : ''}
    <section class="context-section context-paths">
      <span class="context-label">Workspace</span>
      <div><span>Branch</span><code>${escapeHtml(issue.branch || 'N/A')}</code></div>
      <div><span>Worktree</span><code title="${escapeHtml(issue.worktreePath || '')}">${escapeHtml(compactPath(issue.worktreePath || 'N/A'))}</code></div>
      ${issue.fullValidation ? `<div><span>Validation</span><code title="${escapeHtml(issue.fullValidation)}">${escapeHtml(issue.fullValidation)}</code></div>` : ''}
    </section>
    ${issue.loop ? `
      <section class="context-section">
        <span class="context-label">Loop</span>
        <strong>${escapeHtml(`${issue.loop.iteration}/${issue.loop.maxIterations} · ${issue.loop.status}`)}</strong>
        <span class="context-copy">${escapeHtml(issue.loop.stopReason || 'Controlled execution active')}</span>
      </section>
    ` : ''}
  `;
}

function renderReviewComments(comments) {
  const visible = comments.filter((comment) => comment.status !== 'RESOLVED').slice(-8);
  if (!visible.length) return '<span class="file-list-empty">No open comments</span>';
  return visible.map((comment) => `
    <div class="review-comment">
      <button type="button" class="review-comment-location" data-comment-file="${escapeHtml(comment.file)}" data-comment-line="${comment.line}">${escapeHtml(comment.file)}:${comment.line}</button>
      <p>${escapeHtml(comment.body)}</p>
      <div><span>${escapeHtml(comment.status.toLowerCase())}</span><button type="button" class="remove-comment" data-remove-comment="${escapeHtml(comment.id)}" aria-label="Remove comment" title="Remove comment">&times;</button></div>
    </div>
  `).join('');
}

function bindReviewCommentControls(issue) {
  const addButton = drawerContext.querySelector('#addInlineComment');
  addButton?.addEventListener('click', async () => {
    const target = drawerContext.querySelector('#inlineCommentTarget');
    const body = drawerContext.querySelector('#inlineCommentBody')?.value?.trim() || '';
    if (!target?.dataset.file || !target.dataset.line || !body) {
      showFeedback('Select a changed line and enter a review comment.', 'error');
      return;
    }
    try {
      await request(`/api/work-items/${issue.ticketId}/review-comment`, {
        method: 'POST',
        body: JSON.stringify({ file: target.dataset.file, line: Number(target.dataset.line), body })
      });
      drawerContext.querySelector('#inlineCommentBody').value = '';
      await forceRefresh();
      showFeedback('Inline review comment added.', 'success');
    } catch (error) {
      showActionError(issue.ticketId, error);
    }
  });
  drawerContext.querySelectorAll('[data-comment-file]').forEach((button) => {
    button.addEventListener('click', () => void openDiffFile(issue.ticketId, button.dataset.commentFile, button.dataset.commentLine));
  });
  drawerContext.querySelectorAll('[data-remove-comment]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await request(`/api/work-items/${issue.ticketId}/review-comment`, {
          method: 'DELETE',
          body: JSON.stringify({ commentId: button.dataset.removeComment })
        });
        await forceRefresh();
      } catch (error) {
        showActionError(issue.ticketId, error);
      }
    });
  });
}

function selectInlineCommentTarget(file, line) {
  if (!file || !line) return;
  const target = drawerContext.querySelector('#inlineCommentTarget');
  const body = drawerContext.querySelector('#inlineCommentBody');
  const addButton = drawerContext.querySelector('#addInlineComment');
  if (!target || !body || !addButton) return;
  target.dataset.file = file;
  target.dataset.line = line;
  target.textContent = `${file}:${line}`;
  addButton.disabled = false;
  body.focus();
}

function compactPath(value) {
  const parts = String(value).split('/').filter(Boolean);
  return parts.length > 4 ? `.../${parts.slice(-4).join('/')}` : value;
}

function renderDetailTabs() {
  const tabs = [
    ['overview', 'Overview'],
    ['plan', 'Plan'],
    ['logs', 'Logs'],
    ['diff', 'Diff'],
    ['review', 'Review'],
    ['context', 'Context'],
    ['split', 'Split'],
    ['loop', 'Loop']
  ];

  detailTabs.innerHTML = tabs.map(([id, label]) => `
    <button class="${selectedDetailTab === id ? 'active' : ''}" type="button" data-detail-tab="${id}">${label}</button>
  `).join('');

  detailTabs.querySelectorAll('[data-detail-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedDetailTab = button.dataset.detailTab;
      selectedDiffFile = '';
      pendingDiffLine = 0;
      persistUiState();
      void renderSelectedDetail();
    });
  });
}

function renderIssueOverview(issue) {
  return [
    `${issue.title}`,
    '',
    `Status: ${issue.status}`,
    `Repo: ${issue.repo}`,
    `Type: ${issue.type}`,
    `Branch: ${issue.branch || 'N/A'}`,
    `Worktree: ${issue.worktreePath || 'N/A'}`,
    `Context: ${issue.contextHealth?.size || 'Low'} / ${issue.contextHealth?.risk || 'Context OK'}`,
    issue.loop ? `Loop: ${issue.loop.status} (${issue.loop.iteration}/${issue.loop.maxIterations})${issue.loop.stopReason ? ` - ${issue.loop.stopReason}` : ''}` : '',
    issue.parentTicketId ? `Parent: ${issue.parentTicketId}` : '',
    issue.dependsOn?.length ? `Depends on: ${issue.dependsOn.join(', ')}` : '',
    issue.blocks?.length ? `Blocks: ${issue.blocks.join(', ')}` : '',
    issue.owns?.length ? `Owns:\n${issue.owns.map((file) => `- ${file}`).join('\n')}` : '',
    issue.worktreeStatus?.dirtyCount ? `Dirty worktree files:\n${issue.worktreeStatus.files.map((file) => `- ${file}`).join('\n')}` : '',
    issue.lastError ? `\nLast error:\n${issue.lastError}` : '',
    '',
    'Use the card actions for the next step, or open More for logs and maintenance.'
  ].filter(Boolean).join('\n');
}

function renderIssueContext(issue) {
  const health = issue.contextHealth || {};
  return [
    `Context health for ${issue.ticketId}`,
    '',
    `Size: ${health.size || 'Low'}`,
    `Risk: ${health.risk || 'Context OK'}`,
    `Sources: ${health.sourcesLoaded?.join(', ') || 'Manual'}`,
    `Files analyzed: ${health.filesAnalyzed ?? 0}`,
    `Affected files: ${health.affectedFiles ?? 0}`,
    `Test files: ${health.testFiles ?? 0}`,
    `Plan steps: ${health.planSteps ?? 0}`,
    `Domains touched: ${health.domainsTouched ?? 0}`,
    `Last compact summary: ${health.lastCompactSummaryAt || 'N/A'}`,
    '',
    health.riskReasons?.length ? `Risk reasons:\n${health.riskReasons.map((item) => `- ${item}`).join('\n')}` : 'Risk reasons: none',
    '',
    health.qualityGate?.missing?.length
      ? `Quality gate missing:\n${health.qualityGate.missing.map((item) => `- ${item}`).join('\n')}`
      : 'Quality gate: passed'
  ].join('\n');
}

function renderLoopDetail(issue) {
  if (!issue.loop) return 'No loop has been run for this issue.';
  const runs = issue.loop.runs || [];
  return [
    `Loop for ${issue.ticketId}`,
    '',
    `Status: ${issue.loop.status}`,
    `Iteration: ${issue.loop.iteration}/${issue.loop.maxIterations}`,
    `Validation: ${issue.loop.validationCommand || 'Not configured'}`,
    `Acceptance criteria: ${issue.loop.acceptanceCriteria || 'Not recorded'}`,
    `Stop reason: ${issue.loop.stopReason || 'N/A'}`,
    '',
    'Iterations:',
    ...(runs.length ? runs.flatMap((run) => [
      `- Iteration ${run.iteration}`,
      run.implementationLogPath ? `  Implementation: ${run.implementationLogPath}` : '',
      run.validationLogPath ? `  Validation: ${run.validationLogPath}` : '',
      run.reviewLogPath ? `  Review: ${run.reviewLogPath}` : ''
    ].filter(Boolean)) : ['- No run artifacts recorded yet.'])
  ].join('\n');
}

async function renderSplitDetail(issue) {
  const parent = issue.parentTicketId
    ? issues.find((item) => item.ticketId === issue.parentTicketId)
    : issue;
  const children = parent?.splitChildren?.length
    ? parent.splitChildren.map((id) => issues.find((item) => item.ticketId === id)).filter(Boolean)
    : issues.filter((item) => item.parentTicketId === parent?.ticketId);
  const artifact = parent?.artifacts?.splitSuggestion
    ? await requestText(`/api/work-items/${parent.ticketId}/artifact?name=splitSuggestion`).catch(() => '')
    : '';

  if (!parent || !children.length) {
    return artifact || 'No split graph available yet.';
  }

  const graphLines = children.map((child) => {
    const deps = child.dependsOn?.length ? child.dependsOn.join(', ') : 'start';
    return `${deps} -> ${child.ticketId} [${child.status}]`;
  });
  const ownershipRows = children.flatMap((child) => {
    const owns = child.owns?.length ? child.owns : ['none declared'];
    return owns.map((file) => `${child.ticketId.padEnd(14)} ${child.status.padEnd(22)} ${file}`);
  });

  return [
    `Split graph for ${parent.ticketId}`,
    '',
    'Dependency graph:',
    ...graphLines.map((line) => `- ${line}`),
    '',
    'Ownership table:',
    'Child          Status                 File',
    '-------------- ---------------------- ------------------------------',
    ...ownershipRows,
    '',
    'Raw split plan:',
    artifact || 'Split plan artifact has not been written yet.'
  ].join('\n');
}

async function loadDetailAction(ticketId, action) {
  if (!action) return 'No detail view available yet.';
  if (action.startsWith('artifact:')) {
    const artifact = action.split(':')[1];
    return requestText(`/api/work-items/${ticketId}/artifact?name=${encodeURIComponent(artifact)}`);
  }
  if (action.startsWith('log:')) {
    const kind = action.split(':')[1];
    const raw = await requestText(`/api/work-items/${ticketId}/log?kind=${encodeURIComponent(kind)}`);
    return formatLog(raw);
  }
  if (action === 'diff' && selectedDiffFile) {
    return requestText(`/api/work-items/${ticketId}/diff?file=${encodeURIComponent(selectedDiffFile)}`);
  }
  return requestText(`/api/work-items/${ticketId}/${action}`);
}

function selectDetail(ticketId, tab) {
  selectedIssueId = ticketId;
  selectedDetailTab = tab;
  persistUiState();
  renderBoard();
  void renderSelectedDetail();
}

function openIssueWorkspace(issue) {
  selectedIssueId = issue.ticketId;
  selectedDetailTab = isReviewIssue(issue) ? 'review' : 'overview';
  selectedDiffFile = '';
  pendingDiffLine = 0;
  persistUiState();
  renderBoard();
  void renderSelectedDetail();
}

function detailTabForAction(action) {
  if (action === 'plan') return 'plan';
  if (action === 'diff') return 'diff';
  if (action === 'review-result') return 'review';
  if (action.startsWith('log:')) return 'logs';
  if (action === 'artifact:splitSuggestion') return 'split';
  if (action === 'artifact:finalSummary') return 'overview';
  return '';
}

function logActionForIssue(issue) {
  if (issue.activeAgent?.kind) {
    return `log:${issue.activeAgent.kind}`;
  }
  if (['AI_REVIEW_RUNNING', 'REVIEW_READY', 'FIXING_REVIEW', 'INTEGRATION_READY', 'INTEGRATION_REQUIRED', 'DONE'].includes(issue.status)) {
    return 'log:review';
  }
  if (['IMPLEMENTING', 'IMPLEMENTED', 'MANUAL', 'MANUAL_DONE', 'WAITING_FOR_SIBLINGS'].includes(issue.status)) {
    return 'log:implementation';
  }
  return 'log:intake';
}

function getPrimaryActions(issue, buttons) {
  if (issue.activeAgent) return [];
  if (issue.status === 'CANCELED') return [['delete', 'Delete']];
  if (buttons.manualDone) return [['manual-done', 'Mark Done']];
  if (['MANUAL_DONE', 'INTEGRATION_READY'].includes(issue.status)) return [['review', 'AI Review']];
  if (['REVIEW_READY', 'FIXING_REVIEW', 'INTEGRATION_REQUIRED'].includes(issue.status)) return [['review-result', 'Review']];
  if (issue.status === 'BLOCKED' && issue.blockType === 'dirty-worktree') return [['proceed-dirty', 'Proceed Dirty']];
  if (buttons.proceed) return [['proceed', 'Proceed'], ['loop', 'Loop']];
  if (buttons.splitIssue) return [['split', 'Split']];
  if (buttons.approveSplit) return [['approve-split', 'Approve Split']];
  if (buttons.executeSplit) return [['execute-split', 'Execute Split']];
  if (buttons.runWorkflow) return [['run-workflow', issue.workflowActive ? 'Continue Workflow' : 'Run Workflow']];
  if (buttons.fixReviewComment) return [['proceed', 'Fix'], ['loop', 'Loop']];
  if (buttons.approve) return [['approve', 'Approve']];
  if (buttons.pushBranch) return [['push', 'Push']];
  if (buttons.resumeFromSummary) return [['resume', 'Resume']];
  if (buttons.regeneratePlan) return [['regenerate-plan', 'Regenerate']];
  if (buttons.retry) return [['retry', 'Retry']];
  if (issue.status === 'ADDED') return [['intake', 'Intake']];
  return [];
}

function getQuickViewActions(issue, buttons) {
  if (isReviewIssue(issue) && buttons.viewDiff) return [['diff', 'Changes']];
  if (buttons.codeReviewResult) return [['review-result', 'Review']];
  if (buttons.viewDiff) return [['diff', 'Diff']];
  if (issue.artifacts?.splitSuggestion) return [['artifact:splitSuggestion', 'Split Plan']];
  if (issue.artifacts?.roadmap || issue.featureFilePath) return [['plan', 'Plan']];
  return [[logActionForIssue(issue), 'Logs']];
}

function getUtilityActions(issue, buttons, primaryActions, quickViewActions) {
  const visible = new Set([...primaryActions, ...quickViewActions].map(([action]) => action));
  return [
    ['intake', 'Run Intake', issue.status !== 'ADDED'],
    ['plan', 'Open Plan', Boolean(issue.artifacts?.roadmap || issue.featureFilePath)],
    ['diff', 'View Diff', buttons.viewDiff],
    ['review-result', 'AI Review Result', buttons.codeReviewResult],
    ['log:intake', 'Intake Logs', true],
    ['artifact:finalSummary', 'Summary', true],
    ['artifact:splitSuggestion', 'Split Plan', Boolean(issue.artifacts?.splitSuggestion)],
    ['takeover', 'Takeover', true],
    ['manual-done', 'Mark Manual Done', buttons.manualDone],
    ['refresh-context', 'Refresh Context', buttons.refreshContext],
    ['regenerate-plan', 'Regenerate Plan', buttons.regeneratePlan],
    ['request-fix', 'Request Fix', Boolean(buttons.requestFix)],
    ['loop', 'Run Loop', Boolean(buttons.loop)],
    ['clean-worktree', 'Clean Worktree', !issue.activeAgent],
    ['delete', 'Delete', !issue.activeAgent]
  ].filter(([action, , visibleAction]) => visibleAction && !visible.has(action));
}

function renderSplitProgress(issue) {
  if (!issue.splitProgress) return '';
  const { done, total } = issue.splitProgress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = done === total;
  return `
    <section class="split-progress ${allDone ? 'split-progress-complete' : ''}">
      <div class="split-progress-topline">
        <strong>Split work</strong>
        <span>${done}/${total} done</span>
      </div>
      <div class="split-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
    </section>
  `;
}

function renderSplitMetadata(issue) {
  if (!issue.parentTicketId && !issue.owns?.length && !issue.dependsOn?.length && !issue.blocks?.length) {
    return '';
  }

  const owns = issue.owns?.length ? issue.owns.slice(0, 3).join(', ') : 'none declared';
  const more = issue.owns?.length > 3 ? ` +${issue.owns.length - 3}` : '';
  return `
    <section class="split-metadata">
      ${issue.parentTicketId ? `<div><strong>Parent</strong><span>${escapeHtml(issue.parentTicketId)}</span></div>` : ''}
      <div><strong>Owns</strong><span>${escapeHtml(owns + more)}</span></div>
      ${issue.dependsOn?.length ? `<div><strong>Depends</strong><span>${escapeHtml(issue.dependsOn.join(', '))}</span></div>` : ''}
      ${issue.blocks?.length ? `<div><strong>Blocks</strong><span>${escapeHtml(issue.blocks.join(', '))}</span></div>` : ''}
    </section>
  `;
}

function renderLoopProgress(issue) {
  if (!issue.loop) return '';
  const current = issue.loop.iteration || 0;
  const max = issue.loop.maxIterations || 3;
  const pct = Math.min(100, Math.round((current / max) * 100));
  return `
    <section class="loop-progress ${issue.loop.enabled ? 'loop-progress-active' : ''}">
      <div class="progress-topline">
        <strong>Loop ${escapeHtml(String(current))}/${escapeHtml(String(max))}</strong>
        <span>${escapeHtml(issue.loop.status || 'READY')}</span>
      </div>
      <div class="progress-bar progress-bar-determinate" aria-hidden="true"><span style="width:${pct}%"></span></div>
      ${issue.loop.stopReason ? `<div class="progress-action">${escapeHtml(issue.loop.stopReason)}</div>` : ''}
    </section>
  `;
}

function renderProgress(issue) {
  if (!issue.activeAgent && !issue.progress) {
    return '';
  }

  const progress = issue.progress || {};
  const phase = progress.phase || issue.activeAgent?.kind || issue.status;
  const lastAction = progress.lastAction || 'Agent is running.';
  const toolCount = progress.toolCount ?? 0;
  const step = progress.currentStep;
  const progressWidth = progress.stepPercent ? `${progress.stepPercent}%` : '';
  const timeline = progress.timeline || [];

  return `
    <section class="agent-progress ${progress.stuck?.isStuck ? 'agent-progress-stuck' : ''}">
      <div class="progress-topline">
        <strong>${escapeHtml(step ? `Step ${step.current}/${step.total}` : phase)}</strong>
        <span>${escapeHtml(progress.idleLabel ? `idle ${progress.idleLabel}` : `${toolCount} tools`)}</span>
      </div>
      ${progress.stuck?.isStuck ? `
        <div class="progress-stuck">Stuck: ${escapeHtml(progress.stuck.reasons[0] || 'Needs attention')}</div>
      ` : ''}
      ${step ? `<div class="progress-step-label">${escapeHtml(step.label)}</div>` : ''}
      <div class="progress-bar ${step ? 'progress-bar-determinate' : ''}" aria-hidden="true">
        <span${progressWidth ? ` style="width:${escapeHtml(progressWidth)}"` : ''}></span>
      </div>
      <div class="progress-action">${escapeHtml(lastAction)}</div>
      ${timeline.length ? `
        <ol class="progress-timeline">
          ${timeline.slice(-4).map((item) => `<li class="timeline-${escapeHtml(item.type || 'event')}">${escapeHtml(item.label)}${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ''}</li>`).join('')}
        </ol>
      ` : ''}
    </section>
  `;
}

function renderContextHealth(issue) {
  const health = issue.contextHealth || {};
  const risk = health.risk || 'Context OK';
  const size = health.size || 'Low';
  const sources = health.sourcesLoaded?.length ? health.sourcesLoaded.join(', ') : 'Manual';
  const qualityMissing = health.qualityGate?.missing?.length ? `Missing: ${health.qualityGate.missing.join(', ')}` : 'Plan gate OK';
  const warning = risk === 'Needs Split' ? '<div class="context-warning">Large context detected. Consider splitting this issue.</div>' : '';

  return `
    <section class="context-health ${escapeHtml(riskClass(risk))}">
      <div class="context-topline">
        <strong>${escapeHtml(size)} context</strong>
        <span>${escapeHtml(risk)}</span>
      </div>
      <div class="context-grid">
        <span>Sources: ${escapeHtml(sources)}</span>
        <span>Files: ${escapeHtml(String(health.filesAnalyzed ?? 0))}</span>
        <span>Compact: ${escapeHtml(health.lastCompactSummaryAt ? formatUpdated(health.lastCompactSummaryAt) : 'N/A')}</span>
      </div>
      <div class="context-gate">${escapeHtml(qualityMissing)}</div>
      ${warning}
    </section>
  `;
}

function renderEmptyColumn() {
  return '<p class="empty-column">No work items</p>';
}

function actionButton(issue, action, label, variant = '') {
  const classes = [
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'secondary' ? 'btn-secondary' : '',
    variant === 'danger' || action === 'stop' || action === 'delete' ? 'btn-stop' : '',
    action === 'approve' ? 'btn-approve' : '',
    action === 'push' ? 'btn-push' : ''
  ].filter(Boolean).join(' ');
  const cls = classes ? ` class="${classes}"` : '';
  return `<button data-ticket="${issue.ticketId}" data-action="${action}"${cls}>${label}</button>`;
}

async function handleAction(ticketId, action, humanComment = '') {
  try {
    await handleActionInner(ticketId, action, humanComment);
  } catch (error) {
    showActionError(ticketId, error);
  }
}

async function handleActionInner(ticketId, action, humanComment = '') {
  const detailTab = detailTabForAction(action);
  if (detailTab) {
    selectDetail(ticketId, detailTab);
    return;
  }

  if (action === 'approve') {
    const issue = issues.find((item) => item.ticketId === ticketId);
    const approvalNote = issue?.splitChildren?.length
      ? await openApprovalDialog(issue)
      : '';
    if (issue?.splitChildren?.length && !approvalNote) return;
    await request(`/api/work-items/${ticketId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approvalNote })
    });
    await forceRefresh();
    return;
  }

  if (action === 'push') {
    outputTitle.textContent = `${ticketId} push`;
    setOutput('Pushing branch...');
    const issue = await request(`/api/work-items/${ticketId}/push`, { method: 'POST' });
    await forceRefresh();
    outputTitle.textContent = `${ticketId} push result`;
    setOutput(issue.pushResult || 'Push complete.');
    return;
  }

  if (action === 'delete') {
    await request(`/api/work-items/${ticketId}`, { method: 'DELETE' });
    if (selectedIssueId === ticketId) {
      selectedIssueId = '';
      selectedDetailTab = 'overview';
      detailTabs.innerHTML = '';
      outputTitle.textContent = 'Details';
      setOutput('Select a work item action to inspect plan, diff, or review output.');
    }
    await forceRefresh();
    showFeedback(`${ticketId} deleted.`, 'success');
    return;
  }

  if (action === 'takeover') {
    selectDetail(ticketId, 'overview');
    outputTitle.textContent = `${ticketId} takeover`;
    const result = await request(`/api/work-items/${ticketId}/takeover`, { method: 'POST' });
    await forceRefresh();
    setOutput(result.takeoverInfo || 'Issue marked for manual takeover.');
    return;
  }

  if (action === 'manual-done') {
    await request(`/api/work-items/${ticketId}/manual-done`, { method: 'POST' });
    await forceRefresh();
    return;
  }

  if (action === 'clean-worktree') {
    const confirmed = window.confirm(`Clean the worktree for ${ticketId}? This will discard uncommitted changes in that managed worktree.`);
    if (!confirmed) return;
    const issue = await request(`/api/work-items/${ticketId}/clean-worktree`, {
      method: 'POST',
      body: JSON.stringify({ force: true })
    });
    await forceRefresh();
    outputTitle.textContent = `${ticketId} clean worktree`;
    setOutput(issue.cleanResult || 'Worktree cleaned.');
    return;
  }

  let loopConfig = null;
  if (action === 'loop') {
    const issue = issues.find((item) => item.ticketId === ticketId);
    loopConfig = await openLoopDialog(issue);
    if (!loopConfig) return;
  }

  if (['plan', 'diff', 'review-result'].includes(action)) {
    selectDetail(ticketId, detailTabForAction(action));
    return;
  }

  const endpoint = action === 'retry'
    ? `/api/work-items/${ticketId}/retry`
      : action === 'stop'
        ? `/api/work-items/${ticketId}/stop`
      : action === 'loop'
        ? `/api/work-items/${ticketId}/loop`
      : action === 'review'
        ? `/api/work-items/${ticketId}/review`
      : (action === 'proceed' || action === 'proceed-dirty' || action === 'request-fix')
        ? `/api/work-items/${ticketId}/proceed`
      : action === 'split'
        ? `/api/work-items/${ticketId}/split`
          : action === 'approve-split'
            ? `/api/work-items/${ticketId}/approve-split`
            : action === 'execute-split'
              ? `/api/work-items/${ticketId}/execute-split`
              : action === 'run-workflow'
                ? `/api/work-items/${ticketId}/run-workflow`
              : action === 'refresh-context'
                ? `/api/work-items/${ticketId}/refresh-context`
                : action === 'regenerate-plan'
                  ? `/api/work-items/${ticketId}/regenerate-plan`
                  : action === 'resume'
                    ? `/api/work-items/${ticketId}/resume`
                    : `/api/work-items/${ticketId}/intake`;

  const body = action === 'proceed-dirty'
    ? JSON.stringify({ humanComment, allowDirty: true })
    : (action === 'proceed' || action === 'request-fix') && humanComment
      ? JSON.stringify({ humanComment })
      : action === 'loop'
        ? JSON.stringify(loopConfig)
        : undefined;

  await request(endpoint, { method: 'POST', body });
  await forceRefresh();
  showFeedback(`${ticketId} ${actionLabel(action)} started.`, 'success');

  if (action === 'split') {
    selectDetail(ticketId, 'split');
  } else if (action === 'approve-split') {
    selectDetail(ticketId, 'split');
  } else if (action === 'execute-split') {
    selectDetail(ticketId, 'overview');
  } else if (action === 'run-workflow') {
    selectDetail(ticketId, 'split');
  }
}

function openLoopDialog(issue) {
  loopTitle.textContent = `Start Loop for ${issue.ticketId}`;
  loopMaxIterations.value = '3';
  loopAcceptanceCriteria.value = 'Implement the approved plan, pass deterministic validation, and resolve all blocking AI review findings.';
  loopValidationCommand.textContent = issue.fullValidation
    ? `Validation: ${issue.fullValidation}`
    : 'Validation is not configured for this repo. Loop cannot start.';
  loopForm.querySelector('button[type="submit"]').disabled = !issue.fullValidation;
  loopDialog.showModal();
  loopMaxIterations.focus();

  return new Promise((resolve) => {
    const cancelButton = document.querySelector('#loopCancelButton');
    const cleanup = () => {
      loopForm.removeEventListener('submit', onSubmit);
      cancelButton.removeEventListener('click', onCancel);
      loopDialog.removeEventListener('cancel', onCancel);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      cleanup();
      loopDialog.close();
      resolve({
        maxIterations: Number(loopMaxIterations.value),
        acceptanceCriteria: loopAcceptanceCriteria.value.trim()
      });
    };
    const onCancel = (event) => {
      event.preventDefault();
      cleanup();
      loopDialog.close();
      resolve(null);
    };
    loopForm.addEventListener('submit', onSubmit);
    cancelButton.addEventListener('click', onCancel);
    loopDialog.addEventListener('cancel', onCancel);
  });
}

function openApprovalDialog(issue) {
  approveTitle.textContent = `Approve ${issue.ticketId}`;
  approvalNote.value = '';
  const children = (issue.splitChildren || [])
    .map((id) => issues.find((item) => item.ticketId === id))
    .filter(Boolean);
  const childrenComplete = children.length > 0 && children.every((child) => ['REVIEW_READY', 'MANUAL_DONE', 'DONE'].includes(child.status));
  const childRows = children.length
    ? `<div class="approval-children">${children.map((child) => `
        <div>
          <span>${escapeHtml(child.ticketId)}</span>
          <strong>${escapeHtml(labelForStatus(child.status))}</strong>
        </div>
      `).join('')}</div>`
    : '';
  approveChecklist.innerHTML = [
    ['AI review result exists', Boolean(issue.reviewResultPath), false],
    ['Children are complete', childrenComplete, false],
    ['I reviewed the final diff', false, true],
    ['I reviewed the AI review result', false, true]
  ].map(([label, checked, required]) => `
    <label class="approval-check">
      <input type="checkbox" ${checked ? 'checked disabled' : ''} ${required ? 'data-required-approval' : ''} />
      <span>${escapeHtml(label)}</span>
    </label>
  `).join('') + childRows;
  document.querySelector('#approveConfirmButton').disabled = Boolean(issue.splitChildren?.length && !childrenComplete);

  approveDialog.showModal();
  approvalNote.focus();

  return new Promise((resolve) => {
    const cleanup = () => {
      approveForm.removeEventListener('submit', onSubmit);
      document.querySelector('#approveCancelButton').removeEventListener('click', onCancel);
      approveDialog.removeEventListener('cancel', onCancel);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      const missingCheck = [...approveChecklist.querySelectorAll('[data-required-approval]')]
        .some((checkbox) => !checkbox.checked);
      if (missingCheck) {
        showFeedback('Review the diff and AI review result before approving.', 'error');
        return;
      }
      const note = approvalNote.value.trim();
      if (!note) {
        showFeedback('Approval note is required.', 'error');
        approvalNote.focus();
        return;
      }
      cleanup();
      approveDialog.close();
      resolve(note);
    };
    const onCancel = (event) => {
      event.preventDefault();
      cleanup();
      approveDialog.close();
      resolve('');
    };

    approveForm.addEventListener('submit', onSubmit);
    document.querySelector('#approveCancelButton').addEventListener('click', onCancel);
    approveDialog.addEventListener('cancel', onCancel);
  });
}

function actionLabel(action) {
  return action.replace(/-/g, ' ');
}

async function request(url, options = {}) {
  const { headers, ...requestOptions } = options;
  const response = await fetch(url, {
    ...requestOptions,
    headers: { 'content-type': 'application/json', ...headers }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || data.error || response.statusText);
  }
  return data;
}

function showActionError(ticketId, error) {
  const message = error?.message || String(error);
  outputTitle.textContent = `${ticketId} error`;
  setOutput(message);
  showFeedback(`${ticketId}: ${message}`, 'error');
}

function showFeedback(message, tone = 'info') {
  appFeedback = ensureAppFeedback();
  appFeedback.textContent = message;
  appFeedback.className = `app-feedback ${tone}`;
  appFeedback.hidden = false;
  window.clearTimeout(showFeedback.timer);
  showFeedback.timer = window.setTimeout(() => {
    appFeedback.hidden = true;
  }, tone === 'error' ? 7000 : 3200);
}

function ensureAppFeedback() {
  const existing = appFeedback || document.querySelector('#appFeedback');
  if (existing) {
    return existing;
  }

  const feedback = document.createElement('div');
  feedback.id = 'appFeedback';
  feedback.className = 'app-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  feedback.hidden = true;
  document.body.append(feedback);
  return feedback;
}

async function requestText(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || response.statusText);
  }
  return text;
}

function statusTone(status) {
  if (['FAILED', 'BLOCKED', 'INTERRUPTED'].includes(status)) {
    return 'red';
  }

  if (status === 'CANCELED') {
    return 'gray';
  }

  if (['INTAKE_RUNNING', 'IMPLEMENTING', 'IMPLEMENTED', 'AI_REVIEW_RUNNING', 'CONTEXT_ANALYZING', 'RESUMING', 'CONTEXT_REFRESH_REQUIRED', 'WAITING_FOR_DEPENDENCY', 'WAITING_FOR_SIBLINGS', 'SPLIT_EXECUTED'].includes(status)) {
    return 'yellow';
  }

  if (['REVIEW_READY', 'FIXING_REVIEW', 'NEEDS_REFINEMENT', 'NEEDS_SPLIT', 'INTEGRATION_READY', 'INTEGRATION_REQUIRED', 'MANUAL_DONE'].includes(status)) {
    return 'rose';
  }

  if (status === 'DONE') {
    return 'green';
  }

  return 'gray';
}

function labelForStatus(status) {
  return String(status || '')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function riskClass(risk) {
  if (risk === 'Needs Split') {
    return 'risk-high';
  }
  if (risk === 'Large Context') {
    return 'risk-medium';
  }
  return 'risk-ok';
}

function formatUpdated(value) {
  if (!value) {
    return 'Updated just now';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Updated recently';
  }

  return `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function formatCost(value) {
  const amount = Number(value || 0);
  if (amount >= 100) {
    return `$${Math.round(amount)}`;
  }
  if (amount >= 10) {
    return `$${amount.toFixed(1)}`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatTokens(value) {
  const tokens = Number(value || 0);
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}

function formatLog(raw) {
  const lines = raw.split('\n').filter(Boolean);
  const out = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      out.push(line);
      continue;
    }

    if (entry.type === 'result') {
      out.push(`\n── Result: ${entry.subtype || 'done'} ──\n`);
      continue;
    }

    const parts = entry.message?.content || [];
    for (const part of parts) {
      if (part.type === 'text' && part.text?.trim()) {
        out.push(part.text.trim());
      }

      if (part.type === 'tool_use') {
        const input = part.input || {};
        let detail = '';
        if (part.name === 'Read' && input.file_path) detail = input.file_path;
        else if (part.name === 'Write' && input.file_path) detail = input.file_path;
        else if (part.name === 'Edit' && input.file_path) detail = input.file_path;
        else if ((part.name === 'Grep' || part.name === 'Glob') && (input.pattern || input.path)) detail = input.pattern || input.path;
        else if (part.name === 'Bash' && input.command) detail = input.command.slice(0, 120);
        out.push(`▶ ${part.name}${detail ? ': ' + detail : ''}`);
      }
    }
  }

  return out.join('\n') || '(empty log)';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function loadUiState() {
  try {
    return JSON.parse(localStorage.getItem('agent-hub-ui') || '{}');
  } catch {
    return {};
  }
}

function persistUiState() {
  try {
    localStorage.setItem('agent-hub-ui', JSON.stringify({
      displayPanelOpen,
      selectedIssueId,
      selectedDetailTab,
      activeSummaryFilter,
      searchQuery
    }));
  } catch {
    // Local storage is optional; the board remains fully usable without it.
  }
}

refresh().catch((error) => {
  outputTitle.textContent = 'Startup error';
  setOutput(error.stack || error.message);
});

setInterval(() => {
  if (issues.some((issue) => issue.activeAgent)) {
    void refresh();
  }
}, 3000);
