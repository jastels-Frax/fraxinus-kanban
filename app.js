'use strict';

// ============================================================
// Constants
// ============================================================

const STAGE_LABELS = [
  'Proposal / Scoping',
  'Permitting / Regulatory',
  'Field Scheduled',
  'Field Active',
  'Reporting / Drafting',
  'Review / QA',
  'Delivered / Closed',
];

const STAGE_COLORS = {
  'Proposal / Scoping':      '#0052cc',
  'Permitting / Regulatory': '#5319e7',
  'Field Scheduled':         '#006b75',
  'Field Active':            '#2d5a27',
  'Reporting / Drafting':    '#b08800',
  'Review / QA':             '#d93f0b',
  'Delivered / Closed':      '#666666',
};

const TASK_TYPE_LABELS = [
  'Fieldwork', 'Reporting', 'Proposal', 'Permitting', 'GIS / Data', 'Admin', 'Other',
];

const PRIORITY_LABELS = [
  'Priority: High', 'Priority: Medium', 'Priority: Low',
];

// All labels the board depends on — auto-created on first connect
const REQUIRED_LABELS = [
  { name: 'Proposal / Scoping',      color: '0052cc', description: 'Stage: proposal and scoping' },
  { name: 'Permitting / Regulatory', color: '5319e7', description: 'Stage: permitting and regulatory' },
  { name: 'Field Scheduled',         color: '006b75', description: 'Stage: field work scheduled' },
  { name: 'Field Active',            color: '2d5a27', description: 'Stage: field work in progress' },
  { name: 'Reporting / Drafting',    color: 'b08800', description: 'Stage: reporting and drafting' },
  { name: 'Review / QA',             color: 'd93f0b', description: 'Stage: review and QA' },
  { name: 'Delivered / Closed',      color: '666666', description: 'Stage: delivered or closed' },
  { name: 'Fieldwork',               color: '0075ca', description: 'Task type: fieldwork' },
  { name: 'Reporting',               color: '008672', description: 'Task type: reporting' },
  { name: 'Proposal',                color: '7057ff', description: 'Task type: proposal' },
  { name: 'Permitting',              color: 'b60205', description: 'Task type: permitting' },
  { name: 'GIS / Data',              color: '1d76db', description: 'Task type: GIS or data' },
  { name: 'Admin',                   color: 'aaaaaa', description: 'Task type: admin' },
  { name: 'Other',                   color: 'c2e0c6', description: 'Task type: other' },
  { name: 'Priority: High',          color: 'd73a4a', description: 'Priority: high' },
  { name: 'Priority: Medium',        color: 'b08800', description: 'Priority: medium' },
  { name: 'Priority: Low',           color: '999999', description: 'Priority: low' },
];

// ============================================================
// Application State
// ============================================================

const state = {
  token:         null,
  owner:         null,
  repo:          null,
  issues:        [],
  milestones:    [],
  collaborators: [],
  view:          'board',
  draggedIssue:  null,
  filters: { milestone: '', assignee: '', type: '', priority: '' },
};

// Task modal working state
const modal = {
  editingIssue:      null,
  selectedAssignees: [],
  pickerOpen:        false,
};

// ============================================================
// Bootstrap
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  state.token = localStorage.getItem('gh_token');
  state.owner = localStorage.getItem('gh_owner') || 'jastels-frax';
  state.repo  = localStorage.getItem('gh_repo')  || 'fraxinus-kanban';

  if (!state.token) {
    document.getElementById('setup-modal').classList.remove('hidden');
  } else {
    document.getElementById('app').classList.remove('hidden');
    loadData();
  }

  bindUIEvents();
});

// ============================================================
// Event Bindings
// ============================================================

function bindUIEvents() {
  // Setup modal
  el('save-setup-btn').addEventListener('click', handleSetupSave);
  el('pat-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleSetupSave(); });

  // View toggle
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Filters
  ['milestone-filter', 'assignee-filter', 'type-filter', 'priority-filter'].forEach(id => {
    el(id).addEventListener('change', onFilterChange);
  });
  el('clear-filters-btn').addEventListener('click', clearFilters);

  // Header buttons
  el('refresh-btn').addEventListener('click', () => loadData(true));
  el('settings-btn').addEventListener('click', () => el('setup-modal').classList.remove('hidden'));
  el('new-task-btn').addEventListener('click', () => openTaskModal());
  el('team-btn').addEventListener('click', openTeamModal);

  // Task modal
  el('tm-x').addEventListener('click', closeTaskModal);
  el('tm-cancel').addEventListener('click', closeTaskModal);
  el('tm-save').addEventListener('click', saveTask);
  el('tm-close-issue').addEventListener('click', handleCloseIssue);
  el('tm-new-project-btn').addEventListener('click', openProjectModal);
  el('task-modal').addEventListener('click', e => { if (e.target === el('task-modal')) closeTaskModal(); });

  // Assignee picker
  el('tm-ap-trigger').addEventListener('click', e => { e.stopPropagation(); toggleAssigneePicker(); });
  el('tm-ap-trigger').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAssigneePicker(); } });
  el('tm-ap-search').addEventListener('input', e => buildAssigneeList(e.target.value));
  el('tm-ap-manual-btn').addEventListener('click', addManualAssignee);
  el('tm-ap-manual').addEventListener('keydown', e => { if (e.key === 'Enter') addManualAssignee(); });
  document.addEventListener('click', e => {
    if (modal.pickerOpen && !el('tm-ap').contains(e.target)) closeAssigneePicker();
  });

  // Project (milestone) modal
  el('pm-x').addEventListener('click', closeProjectModal);
  el('pm-cancel').addEventListener('click', closeProjectModal);
  el('pm-save').addEventListener('click', saveProject);
  el('project-modal').addEventListener('click', e => { if (e.target === el('project-modal')) closeProjectModal(); });

  // Team modal
  el('team-x').addEventListener('click', closeTeamModal);
  el('team-done').addEventListener('click', closeTeamModal);
  el('team-modal').addEventListener('click', e => { if (e.target === el('team-modal')) closeTeamModal(); });
  el('team-add-btn').addEventListener('click', () => addTeamMember(el('team-add-input').value.trim()));
  el('team-add-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTeamMember(el('team-add-input').value.trim()); });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!el('project-modal').classList.contains('hidden')) { closeProjectModal(); return; }
      if (!el('team-modal').classList.contains('hidden'))    { closeTeamModal();    return; }
      if (!el('task-modal').classList.contains('hidden'))    { closeTaskModal();    return; }
      if (!el('setup-modal').classList.contains('hidden'))   { el('setup-modal').classList.add('hidden'); return; }
    }
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') openTaskModal();
    if (e.key === 'r' || e.key === 'R') loadData(true);
  });
}

// ============================================================
// Setup / Auth
// ============================================================

async function handleSetupSave() {
  const token = el('pat-input').value.trim();
  const owner = el('owner-input').value.trim();
  const repo  = el('repo-input').value.trim();

  if (!token || !owner || !repo) { showError('setup-error', 'All fields are required.'); return; }

  const btn = el('save-setup-btn');
  btn.textContent = 'Connecting…'; btn.disabled = true;
  el('setup-error').classList.add('hidden');

  try {
    const res = await ghFetch(`repos/${owner}/${repo}`, token);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    state.token = token; state.owner = owner; state.repo = repo;
    localStorage.setItem('gh_token', token);
    localStorage.setItem('gh_owner', owner);
    localStorage.setItem('gh_repo',  repo);
    el('setup-modal').classList.add('hidden');
    el('app').classList.remove('hidden');
    // Ensure all required labels exist before first use
    await ensureLabelsExist();
    loadData();
  } catch (err) {
    showError('setup-error', `Connection failed: ${err.message}`);
  } finally {
    btn.textContent = 'Connect to GitHub'; btn.disabled = false;
  }
}

// ============================================================
// GitHub API
// ============================================================

function ghFetch(path, token = state.token, options = {}) {
  return fetch(`https://api.github.com/${path}`, {
    ...options,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function ghFetchPaginated(path) {
  const results = [];
  let page = 1;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await ghFetch(`${path}${sep}per_page=100&page=${page}`);
    if (res.status === 401) {
      toast('Token invalid or expired — update via Settings.', 'error');
      el('setup-modal').classList.remove('hidden');
      throw new Error('unauthorized');
    }
    if (res.status === 403) {
      const reset = res.headers.get('X-RateLimit-Reset');
      const when  = reset ? ` Resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : '';
      toast(`GitHub rate limit reached.${when}`, 'error');
      throw new Error('rate-limited');
    }
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) { results.push(data); break; }
    results.push(...data);
    if (!(res.headers.get('Link') || '').includes('rel="next"')) break;
    page++;
  }
  return results;
}

// ============================================================
// Data Loading
// ============================================================

async function loadData() {
  if (!state.token) return;
  showLoading(true);
  try {
    const [issuesRaw, milestones, collaborators] = await Promise.all([
      ghFetchPaginated(`repos/${state.owner}/${state.repo}/issues?state=open`),
      ghFetchPaginated(`repos/${state.owner}/${state.repo}/milestones?state=open`).catch(() => []),
      ghFetchPaginated(`repos/${state.owner}/${state.repo}/collaborators`).catch(() => []),
    ]);
    state.issues        = issuesRaw.filter(i => !i.pull_request);
    state.milestones    = milestones;
    state.collaborators = collaborators;
    populateFilterSelects();
    renderBoard();
    renderPeople();
    // Silently create any missing labels in the background
    ensureLabelsExist().catch(() => {});
  } catch (err) {
    if (err.message !== 'unauthorized' && err.message !== 'rate-limited') {
      toast(`Failed to load: ${err.message}`, 'error');
    }
  } finally {
    showLoading(false);
  }
}

async function ensureLabelsExist() {
  const existing = await ghFetchPaginated(`repos/${state.owner}/${state.repo}/labels`).catch(() => []);
  const existingNames = new Set(existing.map(l => l.name));
  const missing = REQUIRED_LABELS.filter(l => !existingNames.has(l.name));
  if (missing.length === 0) return;

  await Promise.all(missing.map(l =>
    ghFetch(`repos/${state.owner}/${state.repo}/labels`, state.token, {
      method: 'POST',
      body: JSON.stringify({ name: l.name, color: l.color, description: l.description }),
    }).catch(() => {})
  ));
  toast(`Set up ${missing.length} label${missing.length !== 1 ? 's' : ''} in your repository`, 'success');
}

// ============================================================
// Filters
// ============================================================

function populateFilterSelects() {
  const msEl = el('milestone-filter'); const curMs = msEl.value;
  msEl.innerHTML = '<option value="">All Projects</option>';
  state.milestones.forEach(m => {
    const o = document.createElement('option');
    o.value = o.textContent = m.title;
    msEl.appendChild(o);
  });
  msEl.value = curMs;

  const aEl = el('assignee-filter'); const curA = aEl.value;
  aEl.innerHTML = '<option value="">All People</option>';
  const seen = new Set();
  state.issues.forEach(i => {
    allAssignees(i).forEach(a => {
      if (!seen.has(a.login)) {
        seen.add(a.login);
        const o = document.createElement('option');
        o.value = o.textContent = a.login;
        aEl.appendChild(o);
      }
    });
  });
  aEl.value = curA;
}

function onFilterChange() {
  state.filters.milestone = el('milestone-filter').value;
  state.filters.assignee  = el('assignee-filter').value;
  state.filters.type      = el('type-filter').value;
  state.filters.priority  = el('priority-filter').value;
  el('filter-badge').classList.toggle('hidden', !Object.values(state.filters).some(Boolean));
  renderBoard();
}

function clearFilters() {
  ['milestone-filter', 'assignee-filter', 'type-filter', 'priority-filter'].forEach(id => { el(id).value = ''; });
  state.filters = { milestone: '', assignee: '', type: '', priority: '' };
  el('filter-badge').classList.add('hidden');
  renderBoard();
}

function applyFilters(issues) {
  const { milestone, assignee, type, priority } = state.filters;
  return issues.filter(issue => {
    if (milestone && (!issue.milestone || issue.milestone.title !== milestone)) return false;
    if (assignee  && !new Set(allAssignees(issue).map(a => a.login)).has(assignee)) return false;
    const lns = issue.labels.map(l => l.name);
    if (type     && !lns.includes(type))     return false;
    if (priority && !lns.includes(priority)) return false;
    return true;
  });
}

// ============================================================
// Board
// ============================================================

function renderBoard() {
  const board = el('board');
  board.innerHTML = '';
  const visible = applyFilters(state.issues);
  STAGE_LABELS.forEach(stage => {
    board.appendChild(buildColumn(stage, visible.filter(i => i.labels.some(l => l.name === stage))));
  });
}

function buildColumn(stage, issues) {
  const col = document.createElement('div');
  col.className = 'column';
  col.dataset.stage = stage;

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'column-header';
  const wrap = document.createElement('div');
  wrap.className = 'column-title-wrap';
  const dot = document.createElement('span');
  dot.className = 'column-dot';
  dot.style.background = STAGE_COLORS[stage];
  const title = document.createElement('span');
  title.className = 'column-title';
  title.textContent = stage;
  wrap.appendChild(dot); wrap.appendChild(title);
  const count = document.createElement('span');
  count.className = 'column-count';
  count.textContent = issues.length;
  hdr.appendChild(wrap); hdr.appendChild(count);
  col.appendChild(hdr);

  // Body (drop zone)
  const body = document.createElement('div');
  body.className = 'column-body';
  body.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drop-active'); });
  body.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-active'); });
  body.addEventListener('drop', e => {
    e.preventDefault(); col.classList.remove('drop-active');
    if (state.draggedIssue) moveIssueToStage(state.draggedIssue, stage);
  });
  issues.forEach(issue => body.appendChild(buildCard(issue)));
  col.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'column-footer';
  const addBtn = document.createElement('button');
  addBtn.className = 'add-task-btn';
  addBtn.textContent = '+ Add Task';
  addBtn.addEventListener('click', () => openTaskModal(null, stage));
  footer.appendChild(addBtn);
  col.appendChild(footer);

  return col;
}

function buildCard(issue) {
  const card = document.createElement('div');
  card.className = 'card';
  card.draggable = true;
  card.dataset.issueNumber = issue.number;

  const priority = PRIORITY_LABELS.find(p => issue.labels.some(l => l.name === p));
  if (priority) card.dataset.priority = priority;

  // Click anywhere on card → edit modal
  card.addEventListener('click', () => {
    if (card.classList.contains('dragging')) return;
    openTaskModal(issue);
  });

  // Drag
  card.addEventListener('dragstart', e => {
    state.draggedIssue = issue;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(issue.number));
  });
  card.addEventListener('dragend', () => {
    state.draggedIssue = null;
    card.classList.remove('dragging');
  });

  // Title (plain text — no link; GitHub link is in the edit modal)
  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.textContent = issue.title;
  card.appendChild(titleEl);

  // Meta
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  if (issue.milestone) {
    const proj = document.createElement('div');
    proj.className = 'card-project';
    proj.textContent = `\u{1F4CB} ${issue.milestone.title}`;
    meta.appendChild(proj);
  }
  const assignee = allAssignees(issue)[0];
  if (assignee) {
    const aRow = document.createElement('div');
    aRow.className = 'card-assignee';
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src = avatarUrl(assignee, 36); img.alt = assignee.login;
    img.loading = 'lazy';
    aRow.appendChild(img);
    aRow.appendChild(document.createTextNode(assignee.login));
    meta.appendChild(aRow);
  }
  if (meta.children.length) card.appendChild(meta);

  // Footer: task type chip + due date
  const taskType = issue.labels.find(l => TASK_TYPE_LABELS.includes(l.name));
  const due = parseDueDate(issue.body);
  if (taskType || due) {
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    if (taskType) {
      const chip = document.createElement('span');
      chip.className = 'label-chip';
      chip.textContent = taskType.name;
      const hex = taskType.color.replace(/^#/, '');
      chip.style.background = `#${hex}`;
      chip.style.color = isLightHex(hex) ? '#1a1a1a' : '#fff';
      footer.appendChild(chip);
    }
    if (due) {
      const dueEl = document.createElement('span');
      dueEl.className = 'due-date';
      const today = new Date(); today.setHours(0,0,0,0);
      const days  = Math.ceil((new Date(`${due}T00:00:00`) - today) / 86400000);
      if (days < 0) { dueEl.classList.add('overdue'); dueEl.textContent = `Overdue: ${due}`; }
      else if (days <= 7) { dueEl.classList.add('soon'); dueEl.textContent = `Due: ${due}`; }
      else { dueEl.textContent = `Due: ${due}`; }
      footer.appendChild(dueEl);
    }
    card.appendChild(footer);
  }

  return card;
}

// ============================================================
// People View
// ============================================================

function renderPeople() {
  const grid = el('people-grid');
  grid.innerHTML = '';
  const peopleMap = new Map();
  state.issues.forEach(issue => {
    const seen = new Set();
    allAssignees(issue).forEach(a => {
      if (seen.has(a.login)) return;
      seen.add(a.login);
      if (!peopleMap.has(a.login)) peopleMap.set(a.login, { user: a, issues: [] });
      peopleMap.get(a.login).issues.push(issue);
    });
  });
  if (peopleMap.size === 0) {
    const p = document.createElement('p');
    p.className = 'people-empty';
    p.textContent = 'No assignees on open issues.';
    grid.appendChild(p); return;
  }
  Array.from(peopleMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([, { user, issues }]) => grid.appendChild(buildPersonCard(user, issues)));
}

function buildPersonCard(user, issues) {
  const card = document.createElement('div');
  card.className = 'person-card';
  card.setAttribute('tabindex', '0');
  card.title = `Filter board to ${user.login}`;

  const hdr = document.createElement('div');
  hdr.className = 'person-header';
  const img = document.createElement('img');
  img.className = 'person-avatar';
  img.src = avatarUrl(user, 80); img.alt = user.login; img.loading = 'lazy';
  const info = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'person-name'; nameEl.textContent = user.login;
  const cntEl = document.createElement('div');
  cntEl.className = 'person-count';
  cntEl.textContent = `${issues.length} open task${issues.length !== 1 ? 's' : ''}`;
  info.appendChild(nameEl); info.appendChild(cntEl);
  hdr.appendChild(img); hdr.appendChild(info);
  card.appendChild(hdr);

  const stages = document.createElement('div');
  stages.className = 'person-stages';
  STAGE_LABELS.forEach(stage => {
    const n = issues.filter(i => i.labels.some(l => l.name === stage)).length;
    if (!n) return;
    const row = document.createElement('div');
    row.className = 'person-stage-row';
    const dot = document.createElement('span');
    dot.className = 'stage-dot'; dot.style.background = STAGE_COLORS[stage];
    const nm  = document.createElement('span'); nm.className  = 'stage-name'; nm.textContent  = stage;
    const cnt = document.createElement('span'); cnt.className = 'stage-count'; cnt.textContent = n;
    row.appendChild(dot); row.appendChild(nm); row.appendChild(cnt);
    stages.appendChild(row);
  });
  card.appendChild(stages);

  const filterTo = () => {
    el('assignee-filter').value = user.login;
    state.filters.assignee = user.login;
    el('filter-badge').classList.remove('hidden');
    switchView('board'); renderBoard();
  };
  card.addEventListener('click', filterTo);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filterTo(); } });
  return card;
}

// ============================================================
// Drag & Drop — Move Issue
// ============================================================

async function moveIssueToStage(issue, newStage) {
  if (issue.labels.some(l => l.name === newStage)) return;
  const newLabels = issue.labels.map(l => l.name).filter(n => !STAGE_LABELS.includes(n)).concat(newStage);
  const orig = issue.labels;
  issue.labels = [...issue.labels.filter(l => !STAGE_LABELS.includes(l.name)),
    { name: newStage, color: STAGE_COLORS[newStage].replace('#', '') }];
  renderBoard();
  try {
    const res = await ghFetch(`repos/${state.owner}/${state.repo}/issues/${issue.number}`, state.token,
      { method: 'PATCH', body: JSON.stringify({ labels: newLabels }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();
    const idx = state.issues.findIndex(i => i.number === issue.number);
    if (idx >= 0) state.issues[idx] = updated;
    renderBoard(); renderPeople();
    toast(`Moved to “${newStage}”`, 'success');
  } catch (err) {
    issue.labels = orig; renderBoard();
    toast(`Could not move task: ${err.message}`, 'error');
  }
}

// ============================================================
// Task Modal — Open / Close / Fill
// ============================================================

function openTaskModal(issue = null, defaultStage = null) {
  modal.editingIssue      = issue;
  modal.selectedAssignees = [];

  // Populate stage select
  const stageEl = el('tm-stage');
  stageEl.innerHTML = STAGE_LABELS.map(s => `<option value="${s}">${s}</option>`).join('');

  // Populate task type select
  const typeEl = el('tm-type');
  typeEl.innerHTML = '<option value="">None</option>' +
    TASK_TYPE_LABELS.map(t => `<option value="${t}">${t}</option>`).join('');

  // Populate milestone select
  refreshProjectOptions();

  const saveBtn  = el('tm-save');
  const closeBtn = el('tm-close-issue');
  const ghLink   = el('tm-gh-link');
  el('tm-error').classList.add('hidden');

  if (issue) {
    el('tm-heading').textContent = 'Edit Task';
    el('tm-number').textContent  = `#${issue.number}`;
    el('tm-number').classList.remove('hidden');
    saveBtn.textContent = 'Save Changes';
    closeBtn.classList.remove('hidden');
    ghLink.href = issue.html_url;
    ghLink.classList.remove('hidden');

    el('tm-title').value = issue.title;
    const stg = issue.labels.find(l => STAGE_LABELS.includes(l.name));
    stageEl.value = stg ? stg.name : STAGE_LABELS[0];
    el('tm-milestone').value = issue.milestone ? String(issue.milestone.number) : '';
    const typ = issue.labels.find(l => TASK_TYPE_LABELS.includes(l.name));
    typeEl.value = typ ? typ.name : '';
    const pri = issue.labels.find(l => PRIORITY_LABELS.includes(l.name));
    el('tm-priority').value = pri ? pri.name : '';
    modal.selectedAssignees = [...allAssignees(issue)];
    const { due, description } = parseBodyParts(issue.body);
    el('tm-due').value  = due || '';
    el('tm-body').value = description;
  } else {
    el('tm-heading').textContent = 'New Task';
    el('tm-number').classList.add('hidden');
    saveBtn.textContent = 'Create Task';
    closeBtn.classList.add('hidden');
    ghLink.classList.add('hidden');
    el('tm-title').value    = '';
    stageEl.value           = defaultStage || STAGE_LABELS[0];
    el('tm-milestone').value = '';
    typeEl.value            = '';
    el('tm-priority').value = '';
    el('tm-due').value      = '';
    el('tm-body').value     = '';
  }

  updateAssigneeDisplay();
  buildAssigneeList('');
  el('task-modal').classList.remove('hidden');
  setTimeout(() => el('tm-title').focus(), 50);
}

function closeTaskModal() {
  el('task-modal').classList.add('hidden');
  closeAssigneePicker();
  modal.editingIssue = null;
  modal.selectedAssignees = [];
}

function refreshProjectOptions(selectValue = null) {
  const ms = el('tm-milestone');
  const current = selectValue !== null ? selectValue : ms.value;
  ms.innerHTML = '<option value="">No project</option>' +
    state.milestones.map(m => `<option value="${m.number}">${m.title}</option>`).join('');
  if (current) ms.value = current;
}

// ============================================================
// Task Modal — Save / Close Issue
// ============================================================

async function saveTask() {
  const title = el('tm-title').value.trim();
  if (!title) { showError('tm-error', 'Title is required.'); el('tm-title').focus(); return; }

  const stage    = el('tm-stage').value;
  const msNum    = el('tm-milestone').value;
  const taskType = el('tm-type').value;
  const priority = el('tm-priority').value;
  const due      = el('tm-due').value;
  const bodyText = el('tm-body').value.trim();

  const labels = [stage];
  if (taskType) labels.push(taskType);
  if (priority) labels.push(priority);

  // Build payload — omit milestone entirely when not set (GitHub POST doesn't accept null)
  const payload = {
    title,
    body:      buildIssueBody(due, bodyText),
    labels,
    assignees: modal.selectedAssignees.map(a => a.login),
  };
  if (msNum) payload.milestone = Number(msNum);

  const isEditing = !!modal.editingIssue;
  const issueNumber = modal.editingIssue ? modal.editingIssue.number : null;

  const btn = el('tm-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  el('tm-error').classList.add('hidden');

  try {
    let res;
    if (isEditing) {
      // PATCH accepts milestone: null to clear it
      if (!msNum) payload.milestone = null;
      res = await ghFetch(`repos/${state.owner}/${state.repo}/issues/${issueNumber}`,
        state.token, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      res = await ghFetch(`repos/${state.owner}/${state.repo}/issues`,
        state.token, { method: 'POST', body: JSON.stringify(payload) });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Surface a clear message for the most common failure case
      const hint = (data.errors || []).map(e => e.value ? `"${e.value}" not found` : e.code).join(', ');
      throw new Error((data.message || `HTTP ${res.status}`) + (hint ? ` — ${hint}` : ''));
    }
    const updated = await res.json();
    if (isEditing) {
      const idx = state.issues.findIndex(i => i.number === issueNumber);
      if (idx >= 0) state.issues[idx] = updated;
      toast('Task updated', 'success');
    } else {
      state.issues.unshift(updated);
      toast('Task created', 'success');
    }
    closeTaskModal();
    populateFilterSelects();
    renderBoard();
    renderPeople();
  } catch (err) {
    showError('tm-error', `Save failed: ${err.message}`);
    btn.disabled = false;
    btn.textContent = isEditing ? 'Save Changes' : 'Create Task';
  }
  // Note: no finally — success path calls closeTaskModal() which hides the button
}

async function handleCloseIssue() {
  if (!modal.editingIssue) return;
  const issue = modal.editingIssue;
  if (!confirm(`Close issue #${issue.number}: “${issue.title}”?\n\nThis will close it in GitHub.`)) return;

  const btn = el('tm-close-issue');
  btn.disabled = true; btn.textContent = 'Closing…';

  try {
    const res = await ghFetch(`repos/${state.owner}/${state.repo}/issues/${issue.number}`,
      state.token, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.issues = state.issues.filter(i => i.number !== issue.number);
    closeTaskModal();
    renderBoard(); renderPeople(); populateFilterSelects();
    toast('Issue closed', 'success');
  } catch (err) {
    showError('tm-error', `Could not close issue: ${err.message}`);
    btn.disabled = false; btn.textContent = 'Close Issue';
  }
}

// ============================================================
// Project (Milestone) Modal
// ============================================================

function openProjectModal() {
  el('pm-name').value = '';
  el('pm-desc').value = '';
  el('pm-due').value  = '';
  el('pm-error').classList.add('hidden');
  el('project-modal').classList.remove('hidden');
  setTimeout(() => el('pm-name').focus(), 50);
}

function closeProjectModal() {
  el('project-modal').classList.add('hidden');
}

async function saveProject() {
  const name = el('pm-name').value.trim();
  if (!name) { showError('pm-error', 'Project name is required.'); el('pm-name').focus(); return; }

  const btn = el('pm-save');
  btn.disabled = true; btn.textContent = 'Creating…';
  el('pm-error').classList.add('hidden');

  try {
    const payload = { title: name };
    const desc = el('pm-desc').value.trim();
    const due  = el('pm-due').value;
    if (desc) payload.description = desc;
    if (due)  payload.due_on = `${due}T00:00:00Z`;

    const res = await ghFetch(`repos/${state.owner}/${state.repo}/milestones`,
      state.token, { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    const ms = await res.json();
    state.milestones.unshift(ms);
    refreshProjectOptions(String(ms.number));
    populateFilterSelects();
    closeProjectModal();
    toast(`Project “${ms.title}” created`, 'success');
  } catch (err) {
    showError('pm-error', `Failed: ${err.message}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Create Project';
  }
}

// ============================================================
// Team Modal
// ============================================================

function openTeamModal() {
  el('team-add-input').value = '';
  el('team-error').classList.add('hidden');
  renderTeamList();
  el('team-modal').classList.remove('hidden');
}

function closeTeamModal() {
  el('team-modal').classList.add('hidden');
}

function getKnownTeamMembers() {
  const map = new Map();
  state.collaborators.forEach(c => map.set(c.login, c));
  state.issues.forEach(i => allAssignees(i).forEach(a => { if (!map.has(a.login)) map.set(a.login, a); }));
  try {
    JSON.parse(localStorage.getItem('gh_team_cache') || '[]').forEach(u => {
      if (!map.has(u.login)) map.set(u.login, u);
    });
  } catch (_) {}
  return Array.from(map.values()).sort((a, b) => a.login.localeCompare(b.login));
}

function cacheTeamMember(user) {
  try {
    const cached = JSON.parse(localStorage.getItem('gh_team_cache') || '[]');
    if (!cached.find(m => m.login === user.login)) {
      cached.push({ login: user.login, avatar_url: user.avatar_url, html_url: user.html_url });
      localStorage.setItem('gh_team_cache', JSON.stringify(cached));
    }
  } catch (_) {}
}

function renderTeamList() {
  const list = el('team-list');
  const members = getKnownTeamMembers();
  if (members.length === 0) {
    list.innerHTML = '<p class="team-empty">No team members yet. Add someone below.</p>';
    return;
  }
  list.innerHTML = '';
  members.forEach(m => {
    const row = document.createElement('div');
    row.className = 'team-member';
    const img = document.createElement('img');
    img.className = 'avatar avatar-md'; img.src = avatarUrl(m, 64); img.alt = m.login; img.loading = 'lazy';
    const name = document.createElement('span');
    name.className = 'team-member-name'; name.textContent = m.login;
    const link = document.createElement('a');
    link.href = `https://github.com/${m.login}`; link.target = '_blank'; link.rel = 'noopener';
    link.className = 'team-gh-link'; link.textContent = 'GitHub ↗';
    row.appendChild(img); row.appendChild(name); row.appendChild(link);
    list.appendChild(row);
  });
}

async function addTeamMember(username) {
  if (!username) return;
  el('team-error').classList.add('hidden');
  const btn = el('team-add-btn');
  btn.disabled = true; btn.textContent = 'Adding…';

  try {
    // Verify the user exists
    const userRes = await ghFetch(`users/${username}`);
    if (!userRes.ok) throw new Error(`GitHub user “${username}” not found.`);
    const user = await userRes.json();

    // Try to add as collaborator (may need admin rights)
    const invRes = await ghFetch(`repos/${state.owner}/${state.repo}/collaborators/${username}`,
      state.token, { method: 'PUT', body: JSON.stringify({ permission: 'push' }) });

    if (invRes.status === 201) {
      toast(`${username} invited as collaborator`, 'success');
    } else if (invRes.status === 204) {
      toast(`${username} is already a collaborator`, 'success');
    } else {
      toast(`${username} added to team list (collaborator invite requires admin access)`, 'info');
    }

    cacheTeamMember(user);
    if (!state.collaborators.find(c => c.login === user.login)) state.collaborators.push(user);

    el('team-add-input').value = '';
    renderTeamList();
  } catch (err) {
    showError('team-error', err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Add';
  }
}

// ============================================================
// Assignee Picker
// ============================================================

function toggleAssigneePicker() {
  modal.pickerOpen ? closeAssigneePicker() : openAssigneePicker();
}

function openAssigneePicker() {
  modal.pickerOpen = true;
  const trigger = el('tm-ap-trigger');
  const dropdown = el('tm-ap-dropdown');
  trigger.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  dropdown.classList.remove('hidden');
  el('tm-ap-search').value = '';
  buildAssigneeList('');
  setTimeout(() => el('tm-ap-search').focus(), 30);
}

function closeAssigneePicker() {
  modal.pickerOpen = false;
  el('tm-ap-trigger').classList.remove('open');
  el('tm-ap-trigger').setAttribute('aria-expanded', 'false');
  el('tm-ap-dropdown').classList.add('hidden');
}

function buildAssigneeList(filter) {
  const list = el('tm-ap-list');
  const members = getKnownTeamMembers();
  const filtered = filter
    ? members.filter(m => m.login.toLowerCase().includes(filter.toLowerCase()))
    : members;

  list.innerHTML = '';
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'ap-empty';
    li.textContent = members.length === 0
      ? 'No team members yet — add some via the Team button.'
      : 'No match found.';
    list.appendChild(li); return;
  }
  filtered.forEach(member => {
    const li = document.createElement('li');
    const isSelected = modal.selectedAssignees.some(a => a.login === member.login);
    if (isSelected) li.classList.add('selected');

    const chk = document.createElement('span'); chk.className = 'ap-check'; chk.textContent = '✓';
    const img = document.createElement('img');
    img.className = 'avatar'; img.src = avatarUrl(member, 36); img.alt = member.login; img.loading = 'lazy';
    const nm = document.createElement('span'); nm.textContent = member.login;

    li.appendChild(chk); li.appendChild(img); li.appendChild(nm);
    li.addEventListener('click', () => {
      toggleAssignee(member);
      buildAssigneeList(el('tm-ap-search').value);
    });
    list.appendChild(li);
  });
}

function toggleAssignee(member) {
  const idx = modal.selectedAssignees.findIndex(a => a.login === member.login);
  if (idx >= 0) modal.selectedAssignees.splice(idx, 1);
  else modal.selectedAssignees.push(member);
  updateAssigneeDisplay();
}

function updateAssigneeDisplay() {
  const chips = el('tm-ap-chips');
  chips.innerHTML = '';
  if (modal.selectedAssignees.length === 0) {
    chips.innerHTML = '<span class="ap-placeholder">Unassigned — click to assign</span>';
    return;
  }
  modal.selectedAssignees.forEach(a => {
    const chip = document.createElement('span');
    chip.className = 'ap-chip';
    const img = document.createElement('img');
    img.className = 'avatar'; img.src = avatarUrl(a, 36); img.alt = a.login;
    const nm = document.createElement('span'); nm.textContent = a.login;
    const x  = document.createElement('button');
    x.type = 'button'; x.className = 'ap-chip-x'; x.textContent = '×';
    x.addEventListener('click', e => { e.stopPropagation(); toggleAssignee(a); });
    chip.appendChild(img); chip.appendChild(nm); chip.appendChild(x);
    chips.appendChild(chip);
  });
}

async function addManualAssignee() {
  const input = el('tm-ap-manual');
  const username = input.value.trim();
  if (!username) return;
  const btn = el('tm-ap-manual-btn');
  btn.disabled = true;
  try {
    const res = await ghFetch(`users/${username}`);
    if (!res.ok) throw new Error(`User “${username}” not found on GitHub.`);
    const user = await res.json();
    cacheTeamMember(user);
    if (!state.collaborators.find(c => c.login === user.login)) state.collaborators.push(user);
    if (!modal.selectedAssignees.find(a => a.login === user.login)) {
      modal.selectedAssignees.push(user);
      updateAssigneeDisplay();
    }
    input.value = '';
    buildAssigneeList(el('tm-ap-search').value);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// View Switching
// ============================================================

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  el('board-view').classList.toggle('hidden', view !== 'board');
  el('people-view').classList.toggle('hidden', view !== 'people');
}

// ============================================================
// Utilities / Helpers
// ============================================================

function el(id) { return document.getElementById(id); }

function allAssignees(issue) {
  const out = [];
  const seen = new Set();
  const add = a => { if (a && !seen.has(a.login)) { seen.add(a.login); out.push(a); } };
  (issue.assignees || []).forEach(add);
  add(issue.assignee);
  return out;
}

function avatarUrl(user, size = 40) {
  const base = user.avatar_url || `https://github.com/${user.login}.png`;
  const sep  = base.includes('?') ? '&' : '?';
  return `${base}${sep}s=${size}`;
}

function parseDueDate(body) {
  if (!body) return null;
  const m = body.match(/[Dd]ue:\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function parseBodyParts(body) {
  if (!body) return { due: null, description: '' };
  const m = body.match(/(?:^|\n)Due:\s*(\d{4}-\d{2}-\d{2})[ \t]*(?:\r?\n|$)/);
  const due = m ? m[1] : null;
  const description = body.replace(/(?:^|\n)Due:\s*\d{4}-\d{2}-\d{2}[ \t]*(?:\r?\n|$)/g, '\n').trim();
  return { due, description };
}

function buildIssueBody(due, description) {
  const parts = [];
  if (due)         parts.push(`Due: ${due}`);
  if (description) parts.push(description);
  return parts.join('\n\n');
}

function isLightHex(hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

function showLoading(on) { el('loading-overlay').classList.toggle('hidden', !on); }

function showError(id, msg) {
  const e = el(id);
  e.textContent = msg;
  e.classList.remove('hidden');
}

function toast(msg, type = 'info') {
  const wrap = el('toast-container');
  const t = document.createElement('div');
  t.className = `toast${type !== 'info' ? ` ${type}` : ''}`;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
