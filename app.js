'use strict';

// ============================================================
// Constants
// ============================================================

const STAGE_LABELS = [
  'Proposal / Scoping',
  'Fieldwork',
  'Reporting / Permitting',
  'Review / QA',
  'Delivered / Closed',
];

const STAGE_COLORS = {
  'Proposal / Scoping':    '#0052cc',
  'Fieldwork':             '#006b75',
  'Reporting / Permitting':'#5319e7',
  'Review / QA':           '#d93f0b',
  'Delivered / Closed':    '#666666',
};

const TASK_TYPE_LABELS = [
  'Fieldwork', 'Reporting', 'Proposal', 'Permitting', 'GIS / Data', 'Admin', 'Other',
];

const PRIORITY_LABELS = [
  'Priority: High', 'Priority: Medium', 'Priority: Low',
];

const REQUIRED_LABELS = [
  { name: 'Proposal / Scoping',    color: '0052cc', description: 'Stage: proposal and scoping' },
  { name: 'Fieldwork',             color: '006b75', description: 'Stage: fieldwork' },
  { name: 'Reporting / Permitting',color: '5319e7', description: 'Stage: reporting and permitting' },
  { name: 'Review / QA',           color: 'd93f0b', description: 'Stage: review and QA' },
  { name: 'Delivered / Closed',    color: '666666', description: 'Stage: delivered or closed' },
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

// Colours cycled through when creating local team members
const MEMBER_COLORS = [
  '#2d5a27', '#0052cc', '#5319e7', '#d93f0b', '#b60205',
  '#006b75', '#1d76db', '#7057ff', '#0075ca', '#008672',
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
  selectedAssignees: [], // array of unified member objects
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
    el('setup-modal').classList.remove('hidden');
  } else {
    el('app').classList.remove('hidden');
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
  el('tm-ap-trigger').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAssigneePicker(); }
  });
  el('tm-ap-search').addEventListener('input', e => buildAssigneeList(e.target.value));
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
  el('team-add-btn').addEventListener('click', () =>
    addTeamMember(el('team-add-name').value, el('team-add-github').value)
  );
  el('team-add-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') el('team-add-github').focus();
  });
  el('team-add-github').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTeamMember(el('team-add-name').value, el('team-add-github').value);
  });

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
// Team Members — Local Storage
// ============================================================
// Each local member: { id, name, initials, color, githubLogin }
// GitHub-only members remain in state.collaborators / gh_team_cache.
// Both types are surfaced together via getKnownTeamMembers().

function getLocalTeam() {
  try { return JSON.parse(localStorage.getItem('gh_local_team') || '[]'); } catch (_) { return []; }
}

function saveLocalTeam(members) {
  try { localStorage.setItem('gh_local_team', JSON.stringify(members)); } catch (_) {}
}

function makeLocalMember(name, githubLogin = null) {
  const existing = getLocalTeam();
  const color = MEMBER_COLORS[existing.length % MEMBER_COLORS.length];
  return {
    id:          `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name:        name.trim(),
    initials:    makeInitials(name),
    color,
    githubLogin: githubLogin ? githubLogin.trim() : null,
  };
}

function makeInitials(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('') || '?';
}

// Unique string key for a member object (used for dedup / selection tracking)
function memberKey(m) {
  return m.type === 'github' ? `github:${m.login}` : `local:${m.id}`;
}

// Returns all known team members as unified objects with a `type` field
function getKnownTeamMembers() {
  const map = new Map();

  const addGitHub = u => {
    const key = `github:${u.login}`;
    if (!map.has(key)) map.set(key, { type: 'github', name: u.login, login: u.login, avatar_url: u.avatar_url });
  };

  state.collaborators.forEach(addGitHub);
  state.issues.forEach(i => githubAssigneesOf(i).forEach(addGitHub));
  try {
    JSON.parse(localStorage.getItem('gh_team_cache') || '[]').forEach(addGitHub);
  } catch (_) {}

  getLocalTeam().forEach(m => {
    const key = `local:${m.id}`;
    if (!map.has(key)) map.set(key, { type: 'local', ...m });
  });

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function cacheGitHubMember(user) {
  try {
    const cached = JSON.parse(localStorage.getItem('gh_team_cache') || '[]');
    if (!cached.find(m => m.login === user.login)) {
      cached.push({ login: user.login, avatar_url: user.avatar_url, html_url: user.html_url });
      localStorage.setItem('gh_team_cache', JSON.stringify(cached));
    }
  } catch (_) {}
}

// ============================================================
// Issue Assignee Helpers
// ============================================================

// Raw GitHub assignees from the issue object
function githubAssigneesOf(issue) {
  const out = []; const seen = new Set();
  const add = a => { if (a && !seen.has(a.login)) { seen.add(a.login); out.push(a); } };
  (issue.assignees || []).forEach(add);
  add(issue.assignee);
  return out;
}

// All assignees (GitHub + local-from-body) as unified member objects
function allIssueAssignees(issue) {
  const out = []; const seen = new Set();

  githubAssigneesOf(issue).forEach(a => {
    const key = `github:${a.login}`;
    if (!seen.has(key)) { seen.add(key); out.push({ type: 'github', name: a.login, login: a.login, avatar_url: a.avatar_url }); }
  });

  const localTeam = getLocalTeam();
  parseLocalAssigneeNames(issue.body).forEach(name => {
    const key = `local:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      const stored = localTeam.find(m => m.name === name);
      out.push(stored
        ? { type: 'local', ...stored }
        : { type: 'local', id: `orphan-${name}`, name, initials: makeInitials(name), color: '#999999', githubLogin: null }
      );
    }
  });

  return out;
}

function parseLocalAssigneeNames(body) {
  if (!body) return [];
  return [...(body.matchAll(/^Local-Assignee:\s*(.+?)[ \t]*$/mg))].map(m => m[1].trim());
}

// ============================================================
// Avatar rendering
// ============================================================

function makeMemberAvatar(member, sizePx = 18) {
  if (member.type === 'github') {
    const img = document.createElement('img');
    img.className = 'avatar';
    img.style.cssText = `width:${sizePx}px;height:${sizePx}px;flex-shrink:0`;
    const base = member.avatar_url || `https://github.com/${member.login}.png`;
    const sep  = base.includes('?') ? '&' : '?';
    img.src = `${base}${sep}s=${sizePx * 2}`;
    img.alt = member.name; img.loading = 'lazy';
    return img;
  }
  const span = document.createElement('span');
  span.className = 'avatar-initials';
  span.style.cssText = `width:${sizePx}px;height:${sizePx}px;font-size:${Math.max(7, Math.floor(sizePx * 0.42))}px;background:${member.color};flex-shrink:0`;
  span.textContent = member.initials || '?';
  span.title = member.name;
  return span;
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

  // Assignee filter — prefixed values: "github:login" or "local:Name"
  const aEl = el('assignee-filter'); const curA = aEl.value;
  aEl.innerHTML = '<option value="">All People</option>';
  const seen = new Set();
  state.issues.forEach(issue => {
    allIssueAssignees(issue).forEach(m => {
      const key = memberKey(m);
      if (!seen.has(key)) {
        seen.add(key);
        const o = document.createElement('option');
        o.value = key; o.textContent = m.name;
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
    if (assignee) {
      if (assignee.startsWith('github:')) {
        const login = assignee.slice(7);
        if (!new Set(githubAssigneesOf(issue).map(a => a.login)).has(login)) return false;
      } else if (assignee.startsWith('local:')) {
        const name = assignee.slice(6);
        if (!parseLocalAssigneeNames(issue.body).includes(name)) return false;
      }
    }
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
  col.className = 'column'; col.dataset.stage = stage;

  const hdr = document.createElement('div'); hdr.className = 'column-header';
  const wrap = document.createElement('div'); wrap.className = 'column-title-wrap';
  const dot = document.createElement('span');
  dot.className = 'column-dot'; dot.style.background = STAGE_COLORS[stage];
  const title = document.createElement('span');
  title.className = 'column-title'; title.textContent = stage;
  wrap.appendChild(dot); wrap.appendChild(title);
  const count = document.createElement('span');
  count.className = 'column-count'; count.textContent = issues.length;
  hdr.appendChild(wrap); hdr.appendChild(count);
  col.appendChild(hdr);

  const body = document.createElement('div'); body.className = 'column-body';
  body.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drop-active'); });
  body.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-active'); });
  body.addEventListener('drop', e => {
    e.preventDefault(); col.classList.remove('drop-active');
    if (state.draggedIssue) moveIssueToStage(state.draggedIssue, stage);
  });
  issues.forEach(issue => body.appendChild(buildCard(issue)));
  col.appendChild(body);

  const footer = document.createElement('div'); footer.className = 'column-footer';
  const addBtn = document.createElement('button');
  addBtn.className = 'add-task-btn'; addBtn.textContent = '+ Add Task';
  addBtn.addEventListener('click', () => openTaskModal(null, stage));
  footer.appendChild(addBtn);
  col.appendChild(footer);
  return col;
}

function buildCard(issue) {
  const card = document.createElement('div');
  card.className = 'card'; card.draggable = true;
  card.dataset.issueNumber = issue.number;

  const priority = PRIORITY_LABELS.find(p => issue.labels.some(l => l.name === p));
  if (priority) card.dataset.priority = priority;

  card.addEventListener('click', () => { if (!card.classList.contains('dragging')) openTaskModal(issue); });
  card.addEventListener('dragstart', e => {
    state.draggedIssue = issue; card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(issue.number));
  });
  card.addEventListener('dragend', () => { state.draggedIssue = null; card.classList.remove('dragging'); });

  const titleEl = document.createElement('div');
  titleEl.className = 'card-title'; titleEl.textContent = issue.title;
  card.appendChild(titleEl);

  const meta = document.createElement('div'); meta.className = 'card-meta';

  if (issue.milestone) {
    const proj = document.createElement('div');
    proj.className = 'card-project';
    proj.textContent = `\u{1F4CB} ${issue.milestone.title}`;
    meta.appendChild(proj);
  }

  const assignees = allIssueAssignees(issue);
  if (assignees.length) {
    const aRow = document.createElement('div'); aRow.className = 'card-assignee';
    aRow.appendChild(makeMemberAvatar(assignees[0], 18));
    aRow.appendChild(document.createTextNode(' ' + assignees[0].name));
    if (assignees.length > 1) {
      const more = document.createElement('span');
      more.style.cssText = 'font-size:10px;color:var(--gray-400);margin-left:2px';
      more.textContent = `+${assignees.length - 1}`;
      aRow.appendChild(more);
    }
    meta.appendChild(aRow);
  }
  if (meta.children.length) card.appendChild(meta);

  const taskType = issue.labels.find(l => TASK_TYPE_LABELS.includes(l.name));
  const due = parseDueDate(issue.body);
  if (taskType || due) {
    const footer = document.createElement('div'); footer.className = 'card-footer';
    if (taskType) {
      const chip = document.createElement('span');
      chip.className = 'label-chip'; chip.textContent = taskType.name;
      const hex = taskType.color.replace(/^#/, '');
      chip.style.background = `#${hex}`;
      chip.style.color = isLightHex(hex) ? '#1a1a1a' : '#fff';
      footer.appendChild(chip);
    }
    if (due) {
      const dueEl = document.createElement('span'); dueEl.className = 'due-date';
      const today = new Date(); today.setHours(0,0,0,0);
      const days  = Math.ceil((new Date(`${due}T00:00:00`) - today) / 86400000);
      if (days < 0)      { dueEl.classList.add('overdue'); dueEl.textContent = `Overdue: ${due}`; }
      else if (days <= 7){ dueEl.classList.add('soon');    dueEl.textContent = `Due: ${due}`; }
      else               {                                 dueEl.textContent = `Due: ${due}`; }
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
    const seenInIssue = new Set();
    allIssueAssignees(issue).forEach(member => {
      const key = memberKey(member);
      if (seenInIssue.has(key)) return;
      seenInIssue.add(key);
      if (!peopleMap.has(key)) peopleMap.set(key, { member, issues: [] });
      peopleMap.get(key).issues.push(issue);
    });
  });
  if (peopleMap.size === 0) {
    const p = document.createElement('p');
    p.className = 'people-empty'; p.textContent = 'No assignees on open issues.';
    grid.appendChild(p); return;
  }
  Array.from(peopleMap.values())
    .sort((a, b) => a.member.name.localeCompare(b.member.name))
    .forEach(({ member, issues }) => grid.appendChild(buildPersonCard(member, issues)));
}

function buildPersonCard(member, issues) {
  const card = document.createElement('div');
  card.className = 'person-card'; card.setAttribute('tabindex', '0');
  card.title = `Filter board to ${member.name}`;

  const hdr = document.createElement('div'); hdr.className = 'person-header';
  hdr.appendChild(makeMemberAvatar(member, 40));

  const info = document.createElement('div');
  const nameEl = document.createElement('div');
  nameEl.className = 'person-name'; nameEl.textContent = member.name;
  const cntEl = document.createElement('div');
  cntEl.className = 'person-count';
  cntEl.textContent = `${issues.length} open task${issues.length !== 1 ? 's' : ''}`;
  info.appendChild(nameEl); info.appendChild(cntEl);
  hdr.appendChild(info); card.appendChild(hdr);

  const stages = document.createElement('div'); stages.className = 'person-stages';
  STAGE_LABELS.forEach(stage => {
    const n = issues.filter(i => i.labels.some(l => l.name === stage)).length;
    if (!n) return;
    const row = document.createElement('div'); row.className = 'person-stage-row';
    const dot = document.createElement('span'); dot.className = 'stage-dot'; dot.style.background = STAGE_COLORS[stage];
    const nm  = document.createElement('span'); nm.className  = 'stage-name'; nm.textContent  = stage;
    const cnt = document.createElement('span'); cnt.className = 'stage-count'; cnt.textContent = n;
    row.appendChild(dot); row.appendChild(nm); row.appendChild(cnt);
    stages.appendChild(row);
  });
  card.appendChild(stages);

  const filterTo = () => {
    const key = memberKey(member);
    el('assignee-filter').value = key;
    state.filters.assignee = key;
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
    toast(`Moved to "${newStage}"`, 'success');
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

  const stageEl = el('tm-stage');
  stageEl.innerHTML = STAGE_LABELS.map(s => `<option value="${s}">${s}</option>`).join('');

  const typeEl = el('tm-type');
  typeEl.innerHTML = '<option value="">None</option>' +
    TASK_TYPE_LABELS.map(t => `<option value="${t}">${t}</option>`).join('');

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
    ghLink.href = issue.html_url; ghLink.classList.remove('hidden');

    el('tm-title').value = issue.title;
    const stg = issue.labels.find(l => STAGE_LABELS.includes(l.name));
    stageEl.value = stg ? stg.name : STAGE_LABELS[0];
    el('tm-milestone').value = issue.milestone ? String(issue.milestone.number) : '';
    const typ = issue.labels.find(l => TASK_TYPE_LABELS.includes(l.name));
    typeEl.value = typ ? typ.name : '';
    const pri = issue.labels.find(l => PRIORITY_LABELS.includes(l.name));
    el('tm-priority').value = pri ? pri.name : '';
    modal.selectedAssignees = [...allIssueAssignees(issue)];
    const { due, description } = parseBodyParts(issue.body);
    el('tm-due').value  = due || '';
    el('tm-body').value = description;
  } else {
    el('tm-heading').textContent = 'New Task';
    el('tm-number').classList.add('hidden');
    saveBtn.textContent = 'Create Task';
    closeBtn.classList.add('hidden');
    ghLink.classList.add('hidden');
    el('tm-title').value     = '';
    stageEl.value            = defaultStage || STAGE_LABELS[0];
    el('tm-milestone').value = '';
    typeEl.value             = '';
    el('tm-priority').value  = '';
    el('tm-due').value       = '';
    el('tm-body').value      = '';
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

  // Split assignees: GitHub users → `assignees` field; local-only → issue body
  const githubLogins   = modal.selectedAssignees.filter(m => m.type === 'github').map(m => m.login);
  const localNames     = modal.selectedAssignees.filter(m => m.type === 'local').map(m => m.name);

  const payload = {
    title,
    body:      buildIssueBody(due, localNames, bodyText),
    labels,
    assignees: githubLogins,
  };
  if (msNum) payload.milestone = Number(msNum); // omit when empty (POST doesn't accept null)

  const isEditing    = !!modal.editingIssue;
  const issueNumber  = modal.editingIssue ? modal.editingIssue.number : null;

  // For PATCH, explicitly clear milestone if deselected
  if (isEditing && !msNum) payload.milestone = null;

  const btn = el('tm-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  el('tm-error').classList.add('hidden');

  try {
    let res;
    if (isEditing) {
      res = await ghFetch(`repos/${state.owner}/${state.repo}/issues/${issueNumber}`,
        state.token, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      res = await ghFetch(`repos/${state.owner}/${state.repo}/issues`,
        state.token, { method: 'POST', body: JSON.stringify(payload) });
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
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
}

async function handleCloseIssue() {
  if (!modal.editingIssue) return;
  const issue = modal.editingIssue;
  if (!confirm(`Close issue #${issue.number}: "${issue.title}"?\n\nThis will close it in GitHub.`)) return;

  const btn = el('tm-close-issue');
  btn.disabled = true; btn.textContent = 'Closing…';
  try {
    const res = await ghFetch(`repos/${state.owner}/${state.repo}/issues/${issue.number}`,
      state.token, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.issues = state.issues.filter(i => i.number !== issue.number);
    closeTaskModal(); renderBoard(); renderPeople(); populateFilterSelects();
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
  el('pm-name').value = ''; el('pm-desc').value = ''; el('pm-due').value = '';
  el('pm-error').classList.add('hidden');
  el('project-modal').classList.remove('hidden');
  setTimeout(() => el('pm-name').focus(), 50);
}

function closeProjectModal() { el('project-modal').classList.add('hidden'); }

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
      const detail = data.message || '';
      if (res.status === 403) {
        // Fine-grained PATs lack milestone write; org SSO unapproved tokens also 403
        if (detail.toLowerCase().includes('fine-grained') || detail.toLowerCase().includes('fine_grained')) {
          throw new Error('Fine-grained tokens cannot create milestones. Please use a classic Personal Access Token with the "repo" scope instead.');
        }
        if (detail.toLowerCase().includes('organization') || detail.toLowerCase().includes('sso')) {
          throw new Error(`Organization SSO error: ${detail}. You may need to authorize your token for the organization at github.com/settings/tokens.`);
        }
        throw new Error(`Permission denied (403): ${detail || 'Resource not accessible by personal access token'}. If using a fine-grained token, switch to a classic token with "repo" scope. If this is an organization repo, authorize the token for that org at github.com/settings/tokens.`);
      }
      if (res.status === 404 || res.status === 410) {
        throw new Error('Milestones could not be created. Make sure your PAT has the full "repo" scope (not just "public_repo"), and that Issues are enabled on this repository.');
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    const ms = await res.json();
    state.milestones.unshift(ms);
    refreshProjectOptions(String(ms.number));
    populateFilterSelects();
    closeProjectModal();
    toast(`Project "${ms.title}" created`, 'success');
  } catch (err) {
    showError('pm-error', err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Create Project';
  }
}

// ============================================================
// Team Modal
// ============================================================

function openTeamModal() {
  el('team-add-name').value = ''; el('team-add-github').value = '';
  el('team-error').classList.add('hidden');
  renderTeamList();
  el('team-modal').classList.remove('hidden');
}

function closeTeamModal() { el('team-modal').classList.add('hidden'); }

function renderTeamList() {
  const list = el('team-list');
  const members = getKnownTeamMembers();
  if (members.length === 0) {
    list.innerHTML = '<p class="team-empty">No team members yet. Add someone below.</p>';
    return;
  }
  list.innerHTML = '';
  members.forEach(m => {
    const row = document.createElement('div'); row.className = 'team-member';
    row.appendChild(makeMemberAvatar(m, 32));

    const name = document.createElement('span');
    name.className = 'team-member-name'; name.textContent = m.name;
    row.appendChild(name);

    if (m.type === 'github') {
      const tag = document.createElement('span'); tag.className = 'team-github-tag'; tag.textContent = 'GitHub';
      row.appendChild(tag);
      const link = document.createElement('a');
      link.href = `https://github.com/${m.login}`; link.target = '_blank'; link.rel = 'noopener';
      link.className = 'team-gh-link'; link.textContent = '↗';
      row.appendChild(link);
    } else {
      const tag = document.createElement('span'); tag.className = 'team-local-tag'; tag.textContent = 'Local';
      row.appendChild(tag);

      // Allow removing local members
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button'; rmBtn.className = 'btn btn-ghost team-remove-btn';
      rmBtn.textContent = '×'; rmBtn.title = 'Remove from team';
      rmBtn.addEventListener('click', () => {
        saveLocalTeam(getLocalTeam().filter(t => t.id !== m.id));
        renderTeamList();
      });
      row.appendChild(rmBtn);
    }
    list.appendChild(row);
  });
}

async function addTeamMember(name, githubLogin) {
  name        = (name || '').trim();
  githubLogin = (githubLogin || '').trim();

  if (!name) { showError('team-error', 'Full name is required.'); el('team-add-name').focus(); return; }

  el('team-error').classList.add('hidden');
  const btn = el('team-add-btn');
  btn.disabled = true; btn.textContent = 'Adding…';

  try {
    if (githubLogin) {
      // Verify the GitHub user exists
      const res = await ghFetch(`users/${githubLogin}`);
      if (!res.ok) throw new Error(`GitHub user "${githubLogin}" not found — check the username or leave that field blank.`);
      const ghUser = await res.json();

      // Attempt collaborator invite (needs admin; fails gracefully)
      const invRes = await ghFetch(
        `repos/${state.owner}/${state.repo}/collaborators/${githubLogin}`,
        state.token, { method: 'PUT', body: JSON.stringify({ permission: 'push' }) }
      );
      if (invRes.status === 201)      toast(`${githubLogin} invited as a repo collaborator`, 'success');
      else if (invRes.status === 204) toast(`${githubLogin} is already a collaborator`, 'success');

      cacheGitHubMember(ghUser);
      if (!state.collaborators.find(c => c.login === ghUser.login)) state.collaborators.push(ghUser);
    }

    // Always store a local entry (name + optional github link)
    const existing = getLocalTeam();
    if (existing.find(m => m.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" is already in the team list.`);
    }
    const member = makeLocalMember(name, githubLogin || null);
    existing.push(member);
    saveLocalTeam(existing);

    el('team-add-name').value = ''; el('team-add-github').value = '';
    renderTeamList();
    toast(`${name} added to team`, 'success');
  } catch (err) {
    showError('team-error', err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Add Member';
  }
}

// ============================================================
// Assignee Picker
// ============================================================

function toggleAssigneePicker() { modal.pickerOpen ? closeAssigneePicker() : openAssigneePicker(); }

function openAssigneePicker() {
  modal.pickerOpen = true;
  const trigger = el('tm-ap-trigger');
  trigger.classList.add('open'); trigger.setAttribute('aria-expanded', 'true');
  el('tm-ap-dropdown').classList.remove('hidden');
  el('tm-ap-search').value = '';
  buildAssigneeList('');
  setTimeout(() => el('tm-ap-search').focus(), 30);
}

function closeAssigneePicker() {
  modal.pickerOpen = false;
  el('tm-ap-trigger').classList.remove('open'); el('tm-ap-trigger').setAttribute('aria-expanded', 'false');
  el('tm-ap-dropdown').classList.add('hidden');
}

function buildAssigneeList(filter) {
  const list = el('tm-ap-list');
  const members = getKnownTeamMembers();
  const filtered = filter
    ? members.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))
    : members;

  list.innerHTML = '';
  if (filtered.length === 0) {
    const li = document.createElement('li'); li.className = 'ap-empty';
    li.textContent = members.length === 0
      ? 'No team members yet — add some via the Team button in the header.'
      : 'No match found.';
    list.appendChild(li); return;
  }

  filtered.forEach(member => {
    const li = document.createElement('li');
    const isSelected = modal.selectedAssignees.some(a => memberKey(a) === memberKey(member));
    if (isSelected) li.classList.add('selected');

    const chk = document.createElement('span'); chk.className = 'ap-check'; chk.textContent = '✓';
    const nm  = document.createElement('span'); nm.textContent = member.name;
    li.appendChild(chk);
    li.appendChild(makeMemberAvatar(member, 20));
    li.appendChild(nm);
    li.addEventListener('click', () => { toggleAssignee(member); buildAssigneeList(el('tm-ap-search').value); });
    list.appendChild(li);
  });
}

function toggleAssignee(member) {
  const key = memberKey(member);
  const idx = modal.selectedAssignees.findIndex(a => memberKey(a) === key);
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
    const chip = document.createElement('span'); chip.className = 'ap-chip';
    chip.appendChild(makeMemberAvatar(a, 16));
    const nm = document.createElement('span'); nm.textContent = a.name;
    const x  = document.createElement('button');
    x.type = 'button'; x.className = 'ap-chip-x'; x.textContent = '×';
    x.addEventListener('click', e => { e.stopPropagation(); toggleAssignee(a); });
    chip.appendChild(nm); chip.appendChild(x);
    chips.appendChild(chip);
  });
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
// Body Parsing & Building
// ============================================================

function parseDueDate(body) {
  if (!body) return null;
  const m = body.match(/[Dd]ue:\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function parseBodyParts(body) {
  if (!body) return { due: null, localAssignees: [], description: '' };
  let text = body;
  let due = null;
  const localAssignees = [];
  text = text.replace(/^Due:\s*(\d{4}-\d{2}-\d{2})[ \t]*\r?\n?/m,   (_, d) => { due = d; return ''; });
  text = text.replace(/^Local-Assignee:\s*(.+?)[ \t]*\r?\n?/mg, (_, n) => { localAssignees.push(n.trim()); return ''; });
  return { due, localAssignees, description: text.trim() };
}

function buildIssueBody(due, localAssigneeNames, description) {
  const metaLines = [];
  if (due) metaLines.push(`Due: ${due}`);
  localAssigneeNames.forEach(n => metaLines.push(`Local-Assignee: ${n}`));
  const parts = [];
  if (metaLines.length) parts.push(metaLines.join('\n'));
  if (description)      parts.push(description);
  return parts.join('\n\n');
}

// ============================================================
// Utilities
// ============================================================

function el(id) { return document.getElementById(id); }

function avatarUrl(user, size = 40) {
  const base = user.avatar_url || `https://github.com/${user.login}.png`;
  const sep  = base.includes('?') ? '&' : '?';
  return `${base}${sep}s=${size}`;
}

function isLightHex(hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

function showLoading(on) { el('loading-overlay').classList.toggle('hidden', !on); }

function showError(id, msg) {
  const e = el(id); e.textContent = msg; e.classList.remove('hidden');
}

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast${type !== 'info' ? ` ${type}` : ''}`; t.textContent = msg;
  el('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
