'use strict';

// ============================================================
// Constants
// ============================================================

const STAGE_LABELS = [
  'Proposal / Scoping',
  'Fieldwork',
  'GIS / Mapping',
  'Reporting / Permitting',
  'Review / QA',
  'Miscellaneous',
  'Delivered / Closed',
];

const STAGE_COLORS = {
  'Proposal / Scoping':    '#0052cc',
  'Fieldwork':             '#006b75',
  'GIS / Mapping':         '#1d76db',
  'Reporting / Permitting':'#b08800',
  'Review / QA':           '#d93f0b',
  'Miscellaneous':         '#0891b2',
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
  { name: 'GIS / Mapping',         color: '1d76db', description: 'Stage: GIS and mapping' },
  { name: 'Reporting / Permitting',color: 'b08800', description: 'Stage: reporting and permitting' },
  { name: 'Review / QA',           color: 'd93f0b', description: 'Stage: review and QA' },
  { name: 'Miscellaneous',         color: '0891b2', description: 'Stage: miscellaneous tasks' },
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

// ============================================================
// Card order persistence (manual drag-to-reorder within columns)
// ============================================================

function getCardOrder(stage) {
  try { return JSON.parse(localStorage.getItem('gh_card_order') || '{}')[stage] || []; }
  catch { return []; }
}

function saveCardOrder(stage, orderArr) {
  try {
    const all = JSON.parse(localStorage.getItem('gh_card_order') || '{}');
    all[stage] = orderArr;
    localStorage.setItem('gh_card_order', JSON.stringify(all));
  } catch {}
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.card:not(.dragging)')];
  return cards.reduce((closest, card) => {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: card };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Task modal working state
const modal = {
  editingIssue:      null,
  editingProject:    null,
  selectedAssignees: [], // array of unified member objects
  pickerOpen:        false,
  completingIssue:   null,
  viewingIssue:      null,
  viewingProject:    null,
};

let pendingAvatar = null; // base64 data URL staged for new team member

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

function addBackdropClose(overlayId, closeFn) {
  let downOnBackdrop = false;
  const overlay = el(overlayId);
  overlay.addEventListener('mousedown', e => { downOnBackdrop = e.target === overlay; });
  overlay.addEventListener('click',     e => { if (e.target === overlay && downOnBackdrop) closeFn(); });
}

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
  el('clients-btn').addEventListener('click', () => openClientModal());
  el('team-btn').addEventListener('click', openTeamModal);
  el('export-pdf-btn').addEventListener('click', exportPDF);
  el('new-project-tab-btn').addEventListener('click', () => openProjectModal());
  el('projects-sort-select').addEventListener('change', renderProjects);

  // Task view modal
  el('tv-x').addEventListener('click', closeTaskView);
  el('tv-close').addEventListener('click', closeTaskView);
  el('tv-edit').addEventListener('click', () => {
    const issue = modal.viewingIssue;
    closeTaskView();
    openTaskModal(issue);
  });
  el('tv-mark-complete').addEventListener('click', () => {
    const issue = modal.viewingIssue;
    closeTaskView();
    openCompletionModal(issue);
  });
  addBackdropClose('task-view-modal', closeTaskView);

  // Project view modal
  el('pv-x').addEventListener('click', closeProjectView);
  el('pv-close').addEventListener('click', closeProjectView);
  el('pv-edit').addEventListener('click', () => {
    const ms = modal.viewingProject;
    closeProjectView();
    openProjectModal(ms);
  });
  el('pv-show-tasks').addEventListener('click', () => {
    const ms = modal.viewingProject;
    closeProjectView();
    filterProjectToBoard(ms);
  });
  addBackdropClose('project-view-modal', closeProjectView);

  // Task modal
  el('tm-x').addEventListener('click', closeTaskModal);
  el('tm-cancel').addEventListener('click', closeTaskModal);
  el('tm-save').addEventListener('click', saveTask);
  el('tm-close-issue').addEventListener('click', handleCloseIssue);
  el('tm-mark-complete').addEventListener('click', () => {
    if (modal.editingIssue) openCompletionModal(modal.editingIssue);
  });
  el('tm-new-project-btn').addEventListener('click', () => openProjectModal());
  el('tm-stage').addEventListener('change', syncCompletionNotesVisibility);
  el('tm-milestone').addEventListener('change', () => syncTaskClientFromProject(false));
  addBackdropClose('task-modal', closeTaskModal);

  // Effort unit toggle
  el('tm-effort-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.effort-unit');
    if (!btn) return;
    el('tm-effort-toggle').querySelectorAll('.effort-unit').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // Assignee picker
  el('tm-ap-trigger').addEventListener('click', e => { e.stopPropagation(); toggleAssigneePicker(); });
  el('tm-ap-trigger').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAssigneePicker(); }
  });
  el('tm-ap-search').addEventListener('input', e => buildAssigneeList(e.target.value));
  document.addEventListener('click', e => {
    if (modal.pickerOpen && !el('tm-ap').contains(e.target)) closeAssigneePicker();
  });

  // Clients modal
  el('clt-x').addEventListener('click', closeClientModal);
  el('clt-done').addEventListener('click', closeClientModal);
  el('clt-add-btn').addEventListener('click', handleAddClient);
  el('clt-add-company').addEventListener('keydown', e => { if (e.key === 'Enter') el('clt-add-contact').focus(); });
  el('clt-add-contact').addEventListener('keydown', e => { if (e.key === 'Enter') el('clt-add-email').focus(); });
  el('clt-add-email').addEventListener('keydown', e => { if (e.key === 'Enter') el('clt-add-phone').focus(); });
  el('clt-add-phone').addEventListener('keydown', e => { if (e.key === 'Enter') handleAddClient(); });
  addBackdropClose('client-modal', closeClientModal);

  // Project (milestone) modal
  el('pm-x').addEventListener('click', closeProjectModal);
  el('pm-cancel').addEventListener('click', closeProjectModal);
  el('pm-save').addEventListener('click', saveProject);
  el('pm-client-roster').addEventListener('change', e => fillProjectClientFromRoster(e.target.value));
  el('pm-new-client-btn').addEventListener('click', () => openClientModal(newClient => {
    refreshClientRosterSelect();
    el('pm-client-roster').value = newClient.id;
    fillProjectClientFromRoster(newClient.id);
  }));
  addBackdropClose('project-modal', closeProjectModal);

  // Team modal
  el('team-x').addEventListener('click', closeTeamModal);
  el('team-done').addEventListener('click', closeTeamModal);
  addBackdropClose('team-modal', closeTeamModal);
  el('team-add-btn').addEventListener('click', () =>
    addTeamMember(el('team-add-name').value, el('team-add-github').value)
  );
  el('team-add-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') el('team-add-github').focus();
  });
  el('team-add-github').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTeamMember(el('team-add-name').value, el('team-add-github').value);
  });
  el('team-add-photo-input').addEventListener('change', async () => {
    const file = el('team-add-photo-input').files[0];
    if (!file) return;
    try {
      pendingAvatar = await resizeImageToDataUrl(file);
      const thumb = el('team-add-photo-preview');
      thumb.innerHTML = '';
      const img = document.createElement('img'); img.src = pendingAvatar;
      thumb.appendChild(img);
      el('team-add-photo-clear').classList.remove('hidden');
    } catch (_) { toast('Could not load photo', 'error'); }
  });
  el('team-add-photo-clear').addEventListener('click', () => {
    pendingAvatar = null;
    el('team-add-photo-input').value = '';
    el('team-add-photo-preview').innerHTML = '';
    el('team-add-photo-clear').classList.add('hidden');
  });

  // Completion modal
  el('cn-x').addEventListener('click', closeCompletionModal);
  el('cn-cancel').addEventListener('click', closeCompletionModal);
  el('cn-confirm').addEventListener('click', confirmCompletion);
  el('cn-notes').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirmCompletion();
  });
  addBackdropClose('completion-modal', closeCompletionModal);

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!el('completion-modal').classList.contains('hidden'))  { closeCompletionModal(); return; }
      if (!el('client-modal').classList.contains('hidden'))      { closeClientModal();     return; }
      if (!el('project-modal').classList.contains('hidden'))     { closeProjectModal();    return; }
      if (!el('team-modal').classList.contains('hidden'))        { closeTeamModal();       return; }
      if (!el('task-modal').classList.contains('hidden'))        { closeTaskModal();       return; }
      if (!el('task-view-modal').classList.contains('hidden'))   { closeTaskView();        return; }
      if (!el('setup-modal').classList.contains('hidden'))       { el('setup-modal').classList.add('hidden'); return; }
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

// ============================================================
// Clients — Local Storage
// ============================================================
// Client shape: { id, company, contact, email, phone }
function getClients() {
  try { return JSON.parse(localStorage.getItem('gh_clients') || '[]'); } catch (_) { return []; }
}
function saveClients(list) {
  try { localStorage.setItem('gh_clients', JSON.stringify(list)); } catch (_) {}
}
function addClient({ company, contact, email, phone }) {
  const list = getClients();
  const client = { id: `client-${Date.now()}`, company: company.trim(), contact: contact.trim(), email: email.trim(), phone: phone.trim() };
  list.push(client);
  saveClients(list);
  return client;
}
function updateClient(id, fields) {
  const list = getClients().map(c => c.id === id ? { ...c, ...fields } : c);
  saveClients(list);
}
function deleteClient(id) {
  saveClients(getClients().filter(c => c.id !== id));
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
  return [...(body.matchAll(/^Local-Assignee:\s*(.+)[ \t]*$/mg))].map(m => m[1].trim());
}

// ============================================================
// Avatar rendering
// ============================================================

function makeMemberAvatar(member, sizePx = 18) {
  if (member.type === 'github' || member.avatar) {
    const img = document.createElement('img');
    img.className = 'avatar';
    img.style.cssText = `width:${sizePx}px;height:${sizePx}px;flex-shrink:0`;
    if (member.type === 'github') {
      const base = member.avatar_url || `https://github.com/${member.login}.png`;
      const sep  = base.includes('?') ? '&' : '?';
      img.src = `${base}${sep}s=${sizePx * 2}`;
      img.loading = 'lazy';
    } else {
      img.src = member.avatar;
    }
    img.alt = member.name;
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
    o.value = m.title;
    o.textContent = projectLabel(m);
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
        const id = assignee.slice(6);
        const member = getLocalTeam().find(m => m.id === id);
        if (!member || !parseLocalAssigneeNames(issue.body).includes(member.name)) return false;
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

  body.addEventListener('dragover', e => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    col.classList.add('drop-active');
    const afterEl = getDragAfterElement(body, e.clientY);
    let indicator = body.querySelector('.drop-indicator');
    if (!indicator) { indicator = document.createElement('div'); indicator.className = 'drop-indicator'; }
    if (afterEl) body.insertBefore(indicator, afterEl);
    else body.appendChild(indicator);
  });

  body.addEventListener('dragleave', e => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('drop-active');
      body.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    }
  });

  body.addEventListener('drop', e => {
    e.preventDefault(); col.classList.remove('drop-active');
    body.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    if (!state.draggedIssue) return;

    const draggedStage = state.draggedIssue.labels.find(l => STAGE_LABELS.includes(l.name))?.name;
    if (draggedStage === stage) {
      // Same column: reorder
      const afterEl = getDragAfterElement(body, e.clientY);
      const cards = [...body.querySelectorAll('.card')];
      const otherCards = cards.filter(c => parseInt(c.dataset.issueNumber) !== state.draggedIssue.number);
      const afterIndex = afterEl ? otherCards.indexOf(afterEl) : otherCards.length;
      const newOrder = otherCards.map(c => parseInt(c.dataset.issueNumber));
      newOrder.splice(afterIndex, 0, state.draggedIssue.number);
      saveCardOrder(stage, newOrder);
      renderBoard();
    } else {
      moveIssueToStage(state.draggedIssue, stage);
    }
  });

  const savedOrder = getCardOrder(stage);
  issues.slice()
    .sort((a, b) => {
      const ia = savedOrder.indexOf(a.number);
      const ib = savedOrder.indexOf(b.number);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      const pa = PRIORITY_LABELS.findIndex(p => a.labels.some(l => l.name === p));
      const pb = PRIORITY_LABELS.findIndex(p => b.labels.some(l => l.name === p));
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    })
    .forEach(issue => body.appendChild(buildCard(issue)));
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

  card.addEventListener('click', () => { if (!card.classList.contains('dragging')) openTaskView(issue); });
  card.addEventListener('dragstart', e => {
    state.draggedIssue = issue; card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(issue.number));
  });
  card.addEventListener('dragend', () => { state.draggedIssue = null; card.classList.remove('dragging'); });

  const stage = issue.labels.find(l => STAGE_LABELS.includes(l.name));
  if (!stage || stage.name !== 'Delivered / Closed') {
    const completeBtn = document.createElement('button');
    completeBtn.type = 'button';
    completeBtn.className = 'card-complete-btn';
    completeBtn.title = 'Mark as completed';
    completeBtn.textContent = '✓';
    completeBtn.addEventListener('click', e => {
      e.stopPropagation();
      openCompletionModal(issue);
    });
    card.appendChild(completeBtn);
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'card-title'; titleEl.textContent = issue.title;
  card.appendChild(titleEl);

  const meta = document.createElement('div'); meta.className = 'card-meta';

  if (issue.milestone) {
    const proj = document.createElement('div');
    proj.className = 'card-project';
    const ms = state.milestones.find(m => m.number === issue.milestone.number);
    const { client } = parseProjectMeta(ms ? (ms.description || '') : '');
    proj.textContent = `\u{1F4CB} ${issue.milestone.title}${client ? ` — ${client}` : ''}`;
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
  const { effort, completionNotes } = parseBodyParts(issue.body);
  if (taskType || due || priority || effort || completionNotes) {
    const footer = document.createElement('div'); footer.className = 'card-footer';
    if (taskType) {
      const chip = document.createElement('span');
      chip.className = 'label-chip'; chip.textContent = taskType.name;
      const hex = taskType.color.replace(/^#/, '');
      chip.style.background = `#${hex}`;
      chip.style.color = isLightHex(hex) ? '#1a1a1a' : '#fff';
      footer.appendChild(chip);
    }
    if (priority) {
      const priEl = document.createElement('span');
      priEl.className = 'priority-badge';
      priEl.dataset.priority = priority;
      priEl.textContent = priority.replace('Priority: ', '');
      footer.appendChild(priEl);
    }
    if (effort) {
      const efEl = document.createElement('span');
      efEl.className = 'effort-chip';
      efEl.textContent = `⏱ ${effort}`;
      footer.appendChild(efEl);
    }
    if (completionNotes) {
      const cnEl = document.createElement('span');
      cnEl.className = 'completion-notes-chip';
      cnEl.title = completionNotes;
      cnEl.textContent = '📋 Completion notes';
      footer.appendChild(cnEl);
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

async function moveIssueToStage(issue, newStage, completionNotes = undefined) {
  if (issue.labels.some(l => l.name === newStage)) return;
  if (newStage === 'Delivered / Closed' && completionNotes === undefined) {
    openCompletionModal(issue);
    return;
  }
  const newLabels = issue.labels.map(l => l.name).filter(n => !STAGE_LABELS.includes(n)).concat(newStage);
  let bodyUpdate = {};
  if (newStage === 'Delivered / Closed' && completionNotes) {
    const parts = parseBodyParts(issue.body);
    bodyUpdate.body = buildIssueBody(parts.due, parts.effort, parts.localAssignees, parts.description, completionNotes, {});
  }
  const orig = issue.labels;
  issue.labels = [...issue.labels.filter(l => !STAGE_LABELS.includes(l.name)),
    { name: newStage, color: STAGE_COLORS[newStage].replace('#', '') }];
  renderBoard();
  try {
    const res = await ghFetch(`repos/${state.owner}/${state.repo}/issues/${issue.number}`, state.token,
      { method: 'PATCH', body: JSON.stringify({ labels: newLabels, ...bodyUpdate }) });
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
// Completion Modal
// ============================================================

function openCompletionModal(issue) {
  modal.completingIssue = issue;
  el('cn-task-title').textContent = issue.title;
  const { completionNotes } = parseBodyParts(issue.body);
  el('cn-notes').value = completionNotes || '';
  el('completion-modal').classList.remove('hidden');
  const textarea = el('cn-notes');
  setTimeout(() => { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); }, 50);
}

function closeCompletionModal() {
  modal.completingIssue = null;
  el('completion-modal').classList.add('hidden');
}

async function confirmCompletion() {
  const issue = modal.completingIssue;
  if (!issue) return;
  const notes = el('cn-notes').value.trim();
  closeCompletionModal();
  closeTaskModal();
  await moveIssueToStage(issue, 'Delivered / Closed', notes || null);
}

// ============================================================
// Task View Modal (read-only)
// ============================================================

function openTaskView(issue) {
  modal.viewingIssue = issue;

  el('tv-number').textContent = `#${issue.number}`;
  el('tv-number').classList.remove('hidden');
  el('tv-title').textContent = issue.title;

  // Stage chip
  const stage = issue.labels.find(l => STAGE_LABELS.includes(l.name));
  const chip = el('tv-stage-chip');
  chip.textContent  = stage ? stage.name : '';
  chip.style.background = stage ? STAGE_COLORS[stage.name] : '#666';

  // Metadata chips row
  const chipsEl = el('tv-chips');
  chipsEl.innerHTML = '';
  const taskType = issue.labels.find(l => TASK_TYPE_LABELS.includes(l.name));
  const priority = PRIORITY_LABELS.find(p => issue.labels.some(l => l.name === p));
  const parts = parseBodyParts(issue.body);
  const { due, effort, description, completionNotes } = parts;

  if (taskType) {
    const c = document.createElement('span'); c.className = 'label-chip';
    c.textContent = taskType.name;
    const hex = taskType.color.replace(/^#/, '');
    c.style.background = `#${hex}`; c.style.color = isLightHex(hex) ? '#1a1a1a' : '#fff';
    chipsEl.appendChild(c);
  }
  if (priority) {
    const c = document.createElement('span'); c.className = 'priority-badge'; c.dataset.priority = priority;
    c.textContent = priority.replace('Priority: ', '');
    chipsEl.appendChild(c);
  }
  if (effort) {
    const c = document.createElement('span'); c.className = 'tv-chip';
    c.textContent = `⏱ ${effort}`; chipsEl.appendChild(c);
  }
  if (due) {
    const c = document.createElement('span');
    const today = new Date(); today.setHours(0,0,0,0);
    const days = Math.ceil((new Date(`${due}T00:00:00`) - today) / 86400000);
    c.className = 'due-date tv-chip';
    if (days < 0) c.classList.add('overdue');
    else if (days <= 7) c.classList.add('soon');
    c.textContent = `Due: ${due}`;
    chipsEl.appendChild(c);
  }

  // Assignees
  const assigneesEl = el('tv-assignees-row');
  assigneesEl.innerHTML = '';
  const assignees = allIssueAssignees(issue);
  if (assignees.length) {
    assignees.forEach(m => {
      const wrap = document.createElement('div'); wrap.className = 'tv-assignee';
      wrap.appendChild(makeMemberAvatar(m, 26));
      const name = document.createElement('span'); name.textContent = m.name;
      wrap.appendChild(name); assigneesEl.appendChild(wrap);
    });
    assigneesEl.classList.remove('hidden');
  } else {
    assigneesEl.classList.add('hidden');
  }

  // Description
  const descSec = el('tv-description-section');
  if (description) {
    el('tv-description-body').textContent = description;
    descSec.classList.remove('hidden');
  } else { descSec.classList.add('hidden'); }

  // Completion notes
  const cnSec = el('tv-completion-section');
  if (completionNotes) {
    el('tv-completion-body').textContent = completionNotes;
    cnSec.classList.remove('hidden');
  } else { cnSec.classList.add('hidden'); }

  // Project + client/location info
  const projSec = el('tv-project-section');
  const ms = issue.milestone ? state.milestones.find(m => m.number === issue.milestone.number) : null;
  if (ms) {
    const meta = parseProjectMeta(ms.description || '');
    // Task-level client info overrides project-level
    const tc = {
      company: parts.taskClient   || meta.client   || '',
      contact: parts.taskContact  || meta.contact  || '',
      email:   parts.taskEmail    || meta.email    || '',
      phone:   parts.taskPhone    || meta.phone    || '',
    };
    const body = el('tv-project-body');
    body.innerHTML = '';

    const nameEl = document.createElement('div'); nameEl.className = 'tv-project-name';
    nameEl.textContent = ms.title; body.appendChild(nameEl);

    if (tc.company) {
      const r = document.createElement('div'); r.className = 'tv-info-row';
      r.textContent = tc.company; body.appendChild(r);
    }
    if (tc.contact) {
      const r = document.createElement('div'); r.className = 'tv-info-row';
      const ic = document.createElement('span'); ic.className = 'tv-info-icon'; ic.textContent = '👤';
      const tx = document.createElement('span'); tx.textContent = tc.contact;
      r.appendChild(ic); r.appendChild(tx); body.appendChild(r);
    }
    if (tc.email) {
      const r = document.createElement('div'); r.className = 'tv-info-row';
      const ic = document.createElement('span'); ic.className = 'tv-info-icon'; ic.textContent = '✉';
      const a = document.createElement('a'); a.href = `mailto:${tc.email}`; a.textContent = tc.email;
      r.appendChild(ic); r.appendChild(a); body.appendChild(r);
    }
    if (tc.phone) {
      const r = document.createElement('div'); r.className = 'tv-info-row';
      const ic = document.createElement('span'); ic.className = 'tv-info-icon'; ic.textContent = '📞';
      const a = document.createElement('a'); a.href = `tel:${tc.phone.replace(/\s/g,'')}`; a.textContent = tc.phone;
      r.appendChild(ic); r.appendChild(a); body.appendChild(r);
    }
    const place = [meta.gps ? `GPS: ${meta.gps}` : null, [meta.town, meta.county, meta.province].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    if (place) {
      const r = document.createElement('div'); r.className = 'tv-location-row';
      r.textContent = `📍 ${place}`; body.appendChild(r);
    }
    projSec.classList.remove('hidden');
  } else { projSec.classList.add('hidden'); }

  // GitHub link
  const ghLink = el('tv-gh-link');
  ghLink.href = issue.html_url; ghLink.classList.remove('hidden');

  // Mark as complete button — hide if already delivered
  const isDelivered = stage && stage.name === 'Delivered / Closed';
  el('tv-mark-complete').classList.toggle('hidden', isDelivered);

  el('task-view-modal').classList.remove('hidden');
}

function closeTaskView() {
  modal.viewingIssue = null;
  el('task-view-modal').classList.add('hidden');
}

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
  saveBtn.disabled = false;
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
    const { due, effort, description, completionNotes, taskClient, taskContact, taskEmail, taskPhone } = parseBodyParts(issue.body);
    el('tm-due').value  = due || '';
    el('tm-body').value = description;
    el('tm-completion-notes').value = completionNotes || '';
    if (effort) {
      const efM = effort.match(/^([\d.]+)\s*(days?|hours?)$/i);
      el('tm-effort').value = efM ? efM[1] : '';
      const unit = efM && efM[2].toLowerCase().startsWith('h') ? 'hours' : 'days';
      el('tm-effort-toggle').querySelectorAll('.effort-unit').forEach(b => b.classList.toggle('active', b.dataset.unit === unit));
    } else {
      el('tm-effort').value = '';
      el('tm-effort-toggle').querySelectorAll('.effort-unit').forEach((b, i) => b.classList.toggle('active', i === 0));
    }
    el('tm-tc-company').value  = taskClient  || '';
    el('tm-tc-contact').value  = taskContact || '';
    el('tm-tc-email').value    = taskEmail   || '';
    el('tm-tc-phone').value    = taskPhone   || '';
    syncTaskClientFromProject(true);
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
    el('tm-due').value              = '';
    el('tm-body').value             = '';
    el('tm-effort').value           = '';
    el('tm-completion-notes').value = '';
    el('tm-effort-toggle').querySelectorAll('.effort-unit').forEach((b, i) => b.classList.toggle('active', i === 0));
    el('tm-tc-company').value = '';
    el('tm-tc-contact').value = '';
    el('tm-tc-email').value   = '';
    el('tm-tc-phone').value   = '';
    syncTaskClientFromProject(false);
  }

  syncCompletionNotesVisibility();
  updateAssigneeDisplay();
  buildAssigneeList('');
  el('task-modal').classList.remove('hidden');
  setTimeout(() => el('tm-title').focus(), 50);
}

function syncCompletionNotesVisibility() {
  const isDelivered = el('tm-stage').value === 'Delivered / Closed';
  const hasNotes    = el('tm-completion-notes').value.trim().length > 0;
  el('tm-completion-notes-group').classList.toggle('hidden', !isDelivered && !hasNotes);
  const completeBtn = el('tm-mark-complete');
  if (completeBtn) completeBtn.classList.toggle('hidden', isDelivered || !modal.editingIssue);
}

function syncTaskClientFromProject(preserveExisting = false) {
  const msNum = el('tm-milestone').value;
  const ms = msNum ? state.milestones.find(m => String(m.number) === msNum) : null;
  const projMeta = ms ? parseProjectMeta(ms.description || '') : null;
  const section = el('tm-client-section');

  if (projMeta && (projMeta.client || projMeta.contact || projMeta.email || projMeta.phone)) {
    section.classList.remove('hidden');
    if (!preserveExisting) {
      el('tm-tc-company').value  = projMeta.client   || '';
      el('tm-tc-contact').value  = projMeta.contact  || '';
      el('tm-tc-email').value    = projMeta.email    || '';
      el('tm-tc-phone').value    = projMeta.phone    || '';
    }
  } else {
    const hasTaskClient = el('tm-tc-company').value || el('tm-tc-contact').value || el('tm-tc-email').value || el('tm-tc-phone').value;
    if (hasTaskClient) section.classList.remove('hidden');
    else section.classList.add('hidden');
    if (!preserveExisting && !hasTaskClient) {
      el('tm-tc-company').value = '';
      el('tm-tc-contact').value = '';
      el('tm-tc-email').value   = '';
      el('tm-tc-phone').value   = '';
    }
  }
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
    state.milestones.map(m => `<option value="${m.number}">${projectLabel(m)}</option>`).join('');
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
  const bodyText       = el('tm-body').value.trim();
  const completionText = el('tm-completion-notes').value.trim();
  const effortVal  = el('tm-effort').value.trim();
  const activeUnit = el('tm-effort-toggle').querySelector('.effort-unit.active');
  const effortStr  = effortVal && activeUnit ? `${effortVal} ${activeUnit.dataset.unit}` : null;

  const labels = [stage];
  if (taskType) labels.push(taskType);
  if (priority) labels.push(priority);

  // Non-blocking warnings for missing optional fields
  const warnings = [];
  if (!modal.selectedAssignees.length) warnings.push('no one is assigned');
  if (!taskType)  warnings.push('no task type selected');
  if (!priority)  warnings.push('no priority set');
  if (warnings.length) toast(`Heads up — ${warnings.join('; ')}`, 'warning');

  // Split assignees: GitHub users → `assignees` field; local-only → issue body
  const githubLogins   = modal.selectedAssignees.filter(m => m.type === 'github').map(m => m.login);
  const localNames     = modal.selectedAssignees.filter(m => m.type === 'local').map(m => m.name);

  const taskClientInfo = {
    taskClient:  el('tm-tc-company').value.trim(),
    taskContact: el('tm-tc-contact').value.trim(),
    taskEmail:   el('tm-tc-email').value.trim(),
    taskPhone:   el('tm-tc-phone').value.trim(),
  };

  const payload = {
    title,
    body:      buildIssueBody(due, effortStr, localNames, bodyText, completionText, taskClientInfo),
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

function handleCloseIssue() {
  if (!modal.editingIssue) return;
  const issue = modal.editingIssue;
  confirmToast(`Delete "${issue.title}"?`, async () => {
    const btn = el('tm-close-issue');
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      const res = await ghFetch(`repos/${state.owner}/${state.repo}/issues/${issue.number}`,
        state.token, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.issues = state.issues.filter(i => i.number !== issue.number);
      closeTaskModal(); renderBoard(); renderPeople(); populateFilterSelects();
      toast('Task deleted', 'success');
    } catch (err) {
      showError('tm-error', `Could not delete task: ${err.message}`);
      btn.disabled = false; btn.textContent = 'Delete Task';
    }
  });
}

// ============================================================
// Project (Milestone) Modal
// ============================================================

function openProjectModal(ms = null, clientPrefill = null) {
  modal.editingProject = ms;
  const meta = parseProjectMeta(ms ? (ms.description || '') : '');
  el('pm-heading').textContent = ms ? 'Edit Project' : 'New Project';
  el('pm-save').textContent    = ms ? 'Save Changes' : 'Create Project';
  el('pm-name').value     = ms ? ms.title : '';
  el('pm-desc').value     = meta.description;
  el('pm-due').value      = ms && ms.due_on ? ms.due_on.slice(0, 10) : '';
  el('pm-client').value   = meta.client;
  el('pm-contact').value  = meta.contact;
  el('pm-email').value    = meta.email;
  el('pm-phone').value    = meta.phone;
  el('pm-gps').value      = meta.gps;
  el('pm-town').value     = meta.town;
  el('pm-county').value   = meta.county;
  el('pm-province').value = meta.province;
  el('pm-error').classList.add('hidden');

  refreshClientRosterSelect();
  // If a client is already saved in the project's description, select them in the roster
  if (meta.client) {
    const clients = getClients();
    const match = clients.find(c => c.company.toLowerCase() === meta.client.toLowerCase());
    if (match) el('pm-client-roster').value = match.id;
  }
  // If opened from client roster with a prefill, override the fields
  if (clientPrefill) {
    el('pm-client').value    = clientPrefill.company  || '';
    el('pm-contact').value   = clientPrefill.contact  || '';
    el('pm-email').value     = clientPrefill.email    || '';
    el('pm-phone').value     = clientPrefill.phone    || '';
    if (clientPrefill.id) el('pm-client-roster').value = clientPrefill.id;
  }

  el('project-modal').classList.remove('hidden');
  setTimeout(() => el('pm-name').focus(), 50);
}

function refreshClientRosterSelect() {
  const sel = el('pm-client-roster');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Enter manually or select —</option>';
  getClients().sort((a, b) => a.company.localeCompare(b.company)).forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.company + (c.contact ? ` — ${c.contact}` : '');
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

function fillProjectClientFromRoster(clientId) {
  if (!clientId) return;
  const c = getClients().find(x => x.id === clientId);
  if (!c) return;
  el('pm-client').value  = c.company;
  el('pm-contact').value = c.contact;
  el('pm-email').value   = c.email;
  el('pm-phone').value   = c.phone;
}

function parseProjectMeta(desc) {
  const empty = { client: '', contact: '', email: '', phone: '', gps: '', town: '', county: '', province: '', description: '' };
  if (!desc) return empty;
  let text = desc;
  let client = '', contact = '', email = '', phone = '', gps = '', town = '', county = '', province = '';
  text = text.replace(/^Client:\s*(.+)[ \t]*\r?\n?/m,   (_, v) => { client   = v.trim(); return ''; });
  text = text.replace(/^Contact:\s*(.+)[ \t]*\r?\n?/m,  (_, v) => { contact  = v.trim(); return ''; });
  text = text.replace(/^Email:\s*(.+)[ \t]*\r?\n?/m,    (_, v) => { email    = v.trim(); return ''; });
  text = text.replace(/^Phone:\s*(.+)[ \t]*\r?\n?/m,    (_, v) => { phone    = v.trim(); return ''; });
  text = text.replace(/^GPS:\s*(.+)[ \t]*\r?\n?/m,      (_, v) => { gps      = v.trim(); return ''; });
  text = text.replace(/^Town:\s*(.+)[ \t]*\r?\n?/m,     (_, v) => { town     = v.trim(); return ''; });
  text = text.replace(/^County:\s*(.+)[ \t]*\r?\n?/m,   (_, v) => { county   = v.trim(); return ''; });
  text = text.replace(/^Province:\s*(.+)[ \t]*\r?\n?/m, (_, v) => { province = v.trim(); return ''; });
  return { client, contact, email, phone, gps, town, county, province, description: text.trim() };
}

function buildProjectDescription(meta, description) {
  const { client, contact, email, phone, gps, town, county, province } = meta;
  const lines = [];
  if (client)   lines.push(`Client: ${client}`);
  if (contact)  lines.push(`Contact: ${contact}`);
  if (email)    lines.push(`Email: ${email}`);
  if (phone)    lines.push(`Phone: ${phone}`);
  if (gps)      lines.push(`GPS: ${gps}`);
  if (town)     lines.push(`Town: ${town}`);
  if (county)   lines.push(`County: ${county}`);
  if (province) lines.push(`Province: ${province}`);
  const parts = [];
  if (lines.length) parts.push(lines.join('\n'));
  if (description)  parts.push(description);
  return parts.join('\n\n');
}

function projectLabel(m) {
  const { client } = parseProjectMeta(m.description || '');
  return client ? `${m.title} — ${client}` : m.title;
}

function closeProjectModal() { el('project-modal').classList.add('hidden'); }

async function saveProject() {
  const name = el('pm-name').value.trim();
  if (!name) { showError('pm-error', 'Project name is required.'); el('pm-name').focus(); return; }

  const isEditing = !!modal.editingProject;
  const btn = el('pm-save');
  btn.disabled = true; btn.textContent = isEditing ? 'Saving…' : 'Creating…';
  el('pm-error').classList.add('hidden');

  try {
    const payload = { title: name };
    const desc = el('pm-desc').value.trim();
    const due  = el('pm-due').value;
    payload.description = buildProjectDescription({
      client:   el('pm-client').value.trim(),
      contact:  el('pm-contact').value.trim(),
      email:    el('pm-email').value.trim(),
      phone:    el('pm-phone').value.trim(),
      gps:      el('pm-gps').value.trim(),
      town:     el('pm-town').value.trim(),
      county:   el('pm-county').value.trim(),
      province: el('pm-province').value.trim(),
    }, desc);
    if (due)  payload.due_on = `${due}T00:00:00Z`;
    else if (isEditing) payload.due_on = null;

    const url = isEditing
      ? `repos/${state.owner}/${state.repo}/milestones/${modal.editingProject.number}`
      : `repos/${state.owner}/${state.repo}/milestones`;
    const res = await ghFetch(url,
      state.token, { method: isEditing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
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
    if (isEditing) {
      const idx = state.milestones.findIndex(m => m.number === ms.number);
      if (idx >= 0) state.milestones[idx] = ms;
    } else {
      state.milestones.unshift(ms);
    }
    refreshProjectOptions(String(ms.number));
    populateFilterSelects();
    closeProjectModal();
    if (state.view === 'projects') renderProjects();
    toast(`Project "${ms.title}" ${isEditing ? 'updated' : 'created'}`, 'success');
  } catch (err) {
    showError('pm-error', err.message);
  } finally {
    btn.disabled = false; btn.textContent = isEditing ? 'Save Changes' : 'Create Project';
  }
}

// ============================================================
// Team Modal
// ============================================================

function openTeamModal() {
  el('team-add-name').value = ''; el('team-add-github').value = '';
  el('team-add-photo-input').value = '';
  el('team-add-photo-preview').innerHTML = '';
  el('team-add-photo-clear').classList.add('hidden');
  pendingAvatar = null;
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

    if (m.type === 'local') {
      // Avatar with click-to-update-photo overlay
      const wrap = document.createElement('div'); wrap.className = 'team-avatar-wrap'; wrap.title = 'Click to update photo';
      wrap.appendChild(makeMemberAvatar(m, 32));
      const editBtn = document.createElement('span'); editBtn.className = 'team-avatar-edit-btn'; editBtn.textContent = '📷';
      wrap.appendChild(editBtn);
      const photoInput = document.createElement('input');
      photoInput.type = 'file'; photoInput.accept = 'image/*'; photoInput.style.display = 'none';
      photoInput.addEventListener('change', async () => {
        if (!photoInput.files[0]) return;
        try {
          const dataUrl = await resizeImageToDataUrl(photoInput.files[0]);
          const team = getLocalTeam();
          const idx = team.findIndex(t => t.id === m.id);
          if (idx >= 0) { team[idx].avatar = dataUrl; saveLocalTeam(team); renderTeamList(); }
        } catch (_) { toast('Could not load photo', 'error'); }
      });
      wrap.appendChild(photoInput);
      wrap.addEventListener('click', () => photoInput.click());
      row.appendChild(wrap);
    } else {
      row.appendChild(makeMemberAvatar(m, 32));
    }

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
    if (pendingAvatar) member.avatar = pendingAvatar;
    existing.push(member);
    saveLocalTeam(existing);

    el('team-add-name').value = ''; el('team-add-github').value = '';
    el('team-add-photo-input').value = '';
    el('team-add-photo-preview').innerHTML = '';
    el('team-add-photo-clear').classList.add('hidden');
    pendingAvatar = null;
    renderTeamList();
    toast(`${name} added to team`, 'success');
  } catch (err) {
    showError('team-error', err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Add Member';
  }
}

// ============================================================
// Client Modal
// ============================================================

function openClientModal(afterAddCallback = null) {
  renderClientList();
  el('clt-add-company').value = '';
  el('clt-add-contact').value = '';
  el('clt-add-email').value   = '';
  el('clt-add-phone').value   = '';
  el('clt-error').classList.add('hidden');
  el('client-modal').classList.remove('hidden');
  el('client-modal')._afterAdd = afterAddCallback;
  setTimeout(() => el('clt-add-company').focus(), 50);
}

function closeClientModal() {
  el('client-modal').classList.add('hidden');
  el('client-modal')._afterAdd = null;
}

function renderClientList() {
  const list = el('client-list');
  list.innerHTML = '';
  const clients = getClients().sort((a, b) => a.company.localeCompare(b.company));
  if (!clients.length) {
    list.innerHTML = '<p class="help-text" style="color:var(--gray-400)">No clients yet — add one below.</p>';
    return;
  }
  clients.forEach(c => {
    const row = document.createElement('div');
    row.className = 'client-row';
    row.dataset.id = c.id;

    const info = document.createElement('div'); info.className = 'client-row-info';
    const company = document.createElement('div'); company.className = 'client-row-company'; company.textContent = c.company;
    info.appendChild(company);
    const sub = document.createElement('div'); sub.className = 'client-row-sub';
    if (c.contact) { const s = document.createElement('span'); s.textContent = c.contact; sub.appendChild(s); }
    if (c.email)   { const a = document.createElement('a'); a.href=`mailto:${c.email}`; a.textContent=c.email; a.addEventListener('click',e=>e.stopPropagation()); sub.appendChild(a); }
    if (c.phone)   { const a = document.createElement('a'); a.href=`tel:${c.phone.replace(/\s/g,'')}`; a.textContent=c.phone; a.addEventListener('click',e=>e.stopPropagation()); sub.appendChild(a); }
    if (sub.children.length) info.appendChild(sub);

    const btns = document.createElement('div'); btns.className = 'client-row-btns';

    const projBtn = document.createElement('button');
    projBtn.type='button'; projBtn.className='btn btn-ghost btn-sm'; projBtn.textContent='New Project';
    projBtn.addEventListener('click', () => { closeClientModal(); openProjectModal(null, c); });

    const editBtn = document.createElement('button');
    editBtn.type='button'; editBtn.className='btn btn-ghost btn-sm'; editBtn.textContent='Edit';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openClientEdit(row, c); });

    const delBtn = document.createElement('button');
    delBtn.type='button'; delBtn.className='btn btn-ghost btn-sm client-del-btn'; delBtn.textContent='✕';
    delBtn.title='Remove client';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteClient(c.id); renderClientList(); refreshClientRosterSelect();
    });

    btns.appendChild(projBtn); btns.appendChild(editBtn); btns.appendChild(delBtn);
    row.appendChild(info); row.appendChild(btns);
    list.appendChild(row);
  });
}

function openClientEdit(row, client) {
  if (row.querySelector('.client-edit-form')) return; // already open
  const btnsEl = row.querySelector('.client-row-btns');
  btnsEl.style.display = 'none';

  const form = document.createElement('div'); form.className = 'client-edit-form';
  const makeField = (label, type, value, id) => {
    const g = document.createElement('div'); g.className = 'field-group';
    const l = document.createElement('label'); l.className = 'field-label'; l.textContent = label;
    const i = document.createElement('input'); i.className = 'field-input'; i.type = type; i.value = value; i.id = id;
    g.appendChild(l); g.appendChild(i); return g;
  };
  const row1 = document.createElement('div'); row1.className = 'field-row';
  row1.appendChild(makeField('Company', 'text', client.company, `ce-company-${client.id}`));
  row1.appendChild(makeField('Contact', 'text', client.contact, `ce-contact-${client.id}`));
  const row2 = document.createElement('div'); row2.className = 'field-row';
  row2.appendChild(makeField('Email', 'email', client.email, `ce-email-${client.id}`));
  row2.appendChild(makeField('Phone', 'tel', client.phone, `ce-phone-${client.id}`));

  const actions = document.createElement('div'); actions.className = 'client-edit-actions';
  const cancel = document.createElement('button'); cancel.type='button'; cancel.className='btn btn-ghost btn-sm'; cancel.textContent='Cancel';
  cancel.addEventListener('click', () => { form.remove(); btnsEl.style.display=''; });
  const save = document.createElement('button'); save.type='button'; save.className='btn btn-primary btn-sm'; save.textContent='Save';
  save.addEventListener('click', () => {
    const company = document.getElementById(`ce-company-${client.id}`).value.trim();
    if (!company) return;
    updateClient(client.id, {
      company,
      contact: document.getElementById(`ce-contact-${client.id}`).value.trim(),
      email:   document.getElementById(`ce-email-${client.id}`).value.trim(),
      phone:   document.getElementById(`ce-phone-${client.id}`).value.trim(),
    });
    renderClientList(); refreshClientRosterSelect();
  });
  actions.appendChild(cancel); actions.appendChild(save);
  form.appendChild(row1); form.appendChild(row2); form.appendChild(actions);
  row.appendChild(form);
}

function handleAddClient() {
  const company = el('clt-add-company').value.trim();
  if (!company) { showError('clt-error', 'Company name is required.'); el('clt-add-company').focus(); return; }
  const client = addClient({
    company,
    contact: el('clt-add-contact').value.trim(),
    email:   el('clt-add-email').value.trim(),
    phone:   el('clt-add-phone').value.trim(),
  });
  el('clt-add-company').value = '';
  el('clt-add-contact').value = '';
  el('clt-add-email').value   = '';
  el('clt-add-phone').value   = '';
  el('clt-error').classList.add('hidden');
  renderClientList();
  refreshClientRosterSelect();
  if (typeof el('client-modal')._afterAdd === 'function') {
    el('client-modal')._afterAdd(client);
  }
  toast(`Client "${client.company}" added`, 'success');
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
  el('projects-view').classList.toggle('hidden', view !== 'projects');
  if (view === 'projects') renderProjects();
}

function renderProjects() {
  const grid = el('projects-grid');
  grid.innerHTML = '';

  if (state.milestones.length === 0) {
    const p = document.createElement('p');
    p.className = 'projects-empty'; p.textContent = 'No projects yet. Click + New Project to create one.';
    grid.appendChild(p); return;
  }

  const sortBy = el('projects-sort-select').value;
  const sorted = state.milestones.slice().sort((a, b) => {
    if (sortBy === 'client') {
      const ca = parseProjectMeta(a.description || '').client.toLowerCase();
      const cb = parseProjectMeta(b.description || '').client.toLowerCase();
      return ca.localeCompare(cb) || a.title.localeCompare(b.title);
    }
    if (sortBy === 'due') {
      const da = a.due_on || 'zzzz'; // no date sorts last
      const db = b.due_on || 'zzzz';
      return da.localeCompare(db) || a.title.localeCompare(b.title);
    }
    if (sortBy === 'tasks') {
      const na = state.issues.filter(i => i.milestone && i.milestone.number === a.number).length;
      const nb = state.issues.filter(i => i.milestone && i.milestone.number === b.number).length;
      return nb - na || a.title.localeCompare(b.title);
    }
    return a.title.localeCompare(b.title); // default: name
  });

  sorted.forEach(ms => {
    const issues = state.issues.filter(i => i.milestone && i.milestone.number === ms.number);
    grid.appendChild(buildProjectCard(ms, issues));
  });
}

function buildProjectCard(ms, issues) {
  const { client, description } = parseProjectMeta(ms.description || '');

  const card = document.createElement('div');
  card.className = 'project-card'; card.setAttribute('tabindex', '0');
  card.title = `View details for ${ms.title}`;

  // Header
  const hdr = document.createElement('div'); hdr.className = 'project-header';

  const hdrTop = document.createElement('div'); hdrTop.className = 'project-header-top';
  const nameEl = document.createElement('div'); nameEl.className = 'project-name';
  nameEl.textContent = ms.title;
  const showTasksBtn = document.createElement('button');
  showTasksBtn.className = 'project-edit-btn'; showTasksBtn.textContent = 'Show Tasks';
  showTasksBtn.addEventListener('click', e => { e.stopPropagation(); filterProjectToBoard(ms); });
  hdrTop.appendChild(nameEl); hdrTop.appendChild(showTasksBtn);
  hdr.appendChild(hdrTop);

  if (client) {
    const clientEl = document.createElement('div'); clientEl.className = 'project-client';
    clientEl.textContent = client;
    hdr.appendChild(clientEl);
  }

  const metaEl = document.createElement('div'); metaEl.className = 'project-meta';
  const cntEl = document.createElement('span'); cntEl.className = 'project-count';
  cntEl.textContent = `${issues.length} open task${issues.length !== 1 ? 's' : ''}`;
  metaEl.appendChild(cntEl);
  if (ms.due_on) {
    const dueEl = document.createElement('span'); dueEl.className = 'project-due';
    dueEl.textContent = `Due ${ms.due_on.slice(0, 10)}`;
    metaEl.appendChild(dueEl);
  }
  hdr.appendChild(metaEl);
  card.appendChild(hdr);

  if (description) {
    const descEl = document.createElement('div'); descEl.className = 'project-desc';
    descEl.textContent = description;
    card.appendChild(descEl);
  }

  // Stage breakdown
  const stages = document.createElement('div'); stages.className = 'project-stages';
  STAGE_LABELS.forEach(stage => {
    const n = issues.filter(i => i.labels.some(l => l.name === stage)).length;
    if (!n) return;
    const row = document.createElement('div'); row.className = 'person-stage-row';
    const dot = document.createElement('span'); dot.className = 'stage-dot'; dot.style.background = STAGE_COLORS[stage];
    const nm  = document.createElement('span'); nm.className = 'stage-name'; nm.textContent = stage;
    const cnt = document.createElement('span'); cnt.className = 'stage-count'; cnt.textContent = n;
    row.appendChild(dot); row.appendChild(nm); row.appendChild(cnt);
    stages.appendChild(row);
  });
  if (stages.children.length) card.appendChild(stages);

  // Click → open project view modal
  card.addEventListener('click', () => openProjectView(ms, issues));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProjectView(ms, issues); } });
  return card;
}

function filterProjectToBoard(ms) {
  el('milestone-filter').value = ms.title;
  state.filters.milestone = ms.title;
  el('filter-badge').classList.remove('hidden');
  switchView('board'); renderBoard();
}

function openProjectView(ms, issues) {
  const { client, contact, email, phone, gps, town, county, province, description } = parseProjectMeta(ms.description || '');
  modal.viewingProject = ms;

  el('pv-title').textContent = ms.title;

  // Meta chips (task count + due date)
  const metaRow = el('pv-meta-row');
  metaRow.innerHTML = '';
  const cntChip = document.createElement('span'); cntChip.className = 'tv-chip';
  cntChip.textContent = `${issues.length} open task${issues.length !== 1 ? 's' : ''}`;
  metaRow.appendChild(cntChip);
  if (ms.due_on) {
    const dueChip = document.createElement('span'); dueChip.className = 'tv-chip';
    dueChip.textContent = `Due ${ms.due_on.slice(0, 10)}`;
    metaRow.appendChild(dueChip);
  }

  // Description
  const descSec = el('pv-description-section');
  if (description) {
    el('pv-description-body').textContent = description;
    descSec.classList.remove('hidden');
  } else {
    descSec.classList.add('hidden');
  }

  // Client
  const clientSec = el('pv-client-section');
  const clientBody = el('pv-client-body');
  clientBody.innerHTML = '';
  if (client || contact || email || phone) {
    if (client) {
      const companyRow = document.createElement('div'); companyRow.className = 'tv-project-name';
      companyRow.textContent = client;
      clientBody.appendChild(companyRow);
    }
    if (contact) {
      const row = document.createElement('div'); row.className = 'project-info-row';
      const icon = document.createElement('span'); icon.className = 'project-info-icon'; icon.textContent = '👤';
      const txt = document.createElement('span'); txt.textContent = contact;
      row.appendChild(icon); row.appendChild(txt); clientBody.appendChild(row);
    }
    if (email) {
      const row = document.createElement('div'); row.className = 'project-info-row';
      const icon = document.createElement('span'); icon.className = 'project-info-icon'; icon.textContent = '✉';
      const a = document.createElement('a'); a.href = `mailto:${email}`; a.textContent = email;
      row.appendChild(icon); row.appendChild(a); clientBody.appendChild(row);
    }
    if (phone) {
      const row = document.createElement('div'); row.className = 'project-info-row';
      const icon = document.createElement('span'); icon.className = 'project-info-icon'; icon.textContent = '📞';
      const a = document.createElement('a'); a.href = `tel:${phone.replace(/\s/g, '')}`; a.textContent = phone;
      row.appendChild(icon); row.appendChild(a); clientBody.appendChild(row);
    }
    clientSec.classList.remove('hidden');
  } else {
    clientSec.classList.add('hidden');
  }

  // Location
  const locSec = el('pv-location-section');
  const locBody = el('pv-location-body');
  locBody.innerHTML = '';
  if (gps || town || county || province) {
    if (gps) {
      const row = document.createElement('div');
      row.textContent = `GPS: ${gps}`;
      locBody.appendChild(row);
    }
    const place = [town, county, province].filter(Boolean).join(', ');
    if (place) {
      const row = document.createElement('div');
      row.textContent = place;
      locBody.appendChild(row);
    }
    locSec.classList.remove('hidden');
  } else {
    locSec.classList.add('hidden');
  }

  // Stage breakdown
  const tasksSec = el('pv-tasks-section');
  const tasksBody = el('pv-tasks-body');
  tasksBody.innerHTML = '';
  STAGE_LABELS.forEach(stage => {
    const n = issues.filter(i => i.labels.some(l => l.name === stage)).length;
    if (!n) return;
    const row = document.createElement('div'); row.className = 'person-stage-row';
    const dot = document.createElement('span'); dot.className = 'stage-dot'; dot.style.background = STAGE_COLORS[stage];
    const nm  = document.createElement('span'); nm.className = 'stage-name'; nm.textContent = stage;
    const cnt = document.createElement('span'); cnt.className = 'stage-count'; cnt.textContent = n;
    row.appendChild(dot); row.appendChild(nm); row.appendChild(cnt);
    tasksBody.appendChild(row);
  });
  tasksSec.classList.toggle('hidden', !tasksBody.children.length);

  el('project-view-modal').classList.remove('hidden');
}

function closeProjectView() {
  el('project-view-modal').classList.add('hidden');
  modal.viewingProject = null;
}

// ============================================================
// PDF Export
// ============================================================

async function exportPDF() {
  if (!state.issues.length) { toast('No open tasks to export.', 'warning'); return; }
  if (!window.jspdf) { toast('PDF library not loaded — try refreshing the page.', 'warning'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const PAGE_W = 297;
  const MARGIN = 14;
  const CW = PAGE_W - MARGIN * 2; // 269mm usable width

  // ── Header bar ─────────────────────────────────────────────
  doc.setFillColor(29, 58, 29);
  doc.rect(0, 0, PAGE_W, 22, 'F');

  const logo = await loadImageAsDataUrl('FRAXINUS%20LOGO%20Compass%20Color%20with%20White%20Text%20REV01.png');
  if (logo) {
    const logoH = 15;
    const logoW = logoH * (logo.w / logo.h);
    doc.addImage(logo.dataUrl, 'PNG', MARGIN, (22 - logoH) / 2, logoW, logoH);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const dateStr = today.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text('Task Overview', PAGE_W - MARGIN, 10, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(dateStr, PAGE_W - MARGIN, 17, { align: 'right' });

  // ── Summary stats ──────────────────────────────────────────
  const overdueCount = state.issues.filter(i => {
    const d = parseDueDate(i.body);
    return d && new Date(`${d}T00:00:00`) < today;
  }).length;
  const highCount = state.issues.filter(i => i.labels.some(l => l.name === 'Priority: High')).length;

  const STAT_GAP = 3;
  const STAT_W   = (CW - 3 * STAT_GAP) / 4;
  const STAT_H   = 14;
  const STAT_Y   = 26;

  [
    { num: state.issues.length,    label: 'Open Tasks',       alert: false },
    { num: highCount,              label: 'High Priority',    alert: highCount > 0 },
    { num: overdueCount,           label: 'Overdue',          alert: overdueCount > 0 },
    { num: state.milestones.length, label: 'Active Projects', alert: false },
  ].forEach((s, i) => {
    const x = MARGIN + i * (STAT_W + STAT_GAP);
    doc.setFillColor(245, 245, 245);
    doc.rect(x, STAT_Y, STAT_W, STAT_H, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...(s.alert ? [215, 58, 74] : [29, 58, 29]));
    doc.text(String(s.num), x + STAT_W / 2, STAT_Y + 8, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(s.label.toUpperCase(), x + STAT_W / 2, STAT_Y + 12.5, { align: 'center' });
  });

  let curY = STAT_Y + STAT_H + 5;

  // ── Priority sections ──────────────────────────────────────
  const priorityGroups = [
    { label: 'HIGH PRIORITY',   key: 'Priority: High',   rgb: [215, 58, 74] },
    { label: 'MEDIUM PRIORITY', key: 'Priority: Medium', rgb: [176, 136, 0] },
    { label: 'LOW PRIORITY',    key: 'Priority: Low',    rgb: [136, 136, 136] },
    { label: 'NO PRIORITY',     key: null,               rgb: [180, 180, 180] },
  ];

  priorityGroups.forEach(({ label, key, rgb }) => {
    const tasks = state.issues
      .filter(i => key
        ? i.labels.some(l => l.name === key)
        : !PRIORITY_LABELS.some(p => i.labels.some(l => l.name === p))
      )
      .sort((a, b) => {
        const sa = STAGE_LABELS.indexOf((a.labels.find(l => STAGE_LABELS.includes(l.name)) || {}).name || '');
        const sb = STAGE_LABELS.indexOf((b.labels.find(l => STAGE_LABELS.includes(l.name)) || {}).name || '');
        return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
      });

    if (!tasks.length) return;

    if (curY > 175) { doc.addPage(); curY = 10; }

    // Section header bar
    doc.setFillColor(...rgb);
    doc.rect(MARGIN, curY, CW, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(`${label}  (${tasks.length})`, MARGIN + 3, curY + 4);
    curY += 7;

    const rows = tasks.map(issue => {
      const stageLabel = issue.labels.find(l => STAGE_LABELS.includes(l.name));
      const project    = issue.milestone ? issue.milestone.title : '—';
      const assignees  = allIssueAssignees(issue).map(m => m.name).join(', ') || '—';
      const typeLabel  = issue.labels.find(l => TASK_TYPE_LABELS.includes(l.name));
      const { effort } = parseBodyParts(issue.body);
      const due        = parseDueDate(issue.body);
      return [
        issue.title,
        stageLabel ? stageLabel.name : '—',
        project,
        assignees,
        typeLabel ? typeLabel.name : '—',
        effort || '—',
        due || '—',
      ];
    });

    doc.autoTable({
      startY: curY,
      head: [['Task', 'Stage', 'Project', 'Assignees', 'Type', 'Effort', 'Due Date']],
      body: rows,
      margin: { left: MARGIN, right: MARGIN },
      tableWidth: CW,
      styles: {
        fontSize: 8,
        cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 },
        overflow: 'linebreak',
      },
      headStyles: { fillColor: [50, 70, 50], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: 38 },
        2: { cellWidth: 42 },
        3: { cellWidth: 40 },
        4: { cellWidth: 22 },
        5: { cellWidth: 20 },
        6: { cellWidth: 37 },
      },
      didParseCell: data => {
        if (data.column.index === 6 && data.section === 'body') {
          const due = data.cell.raw;
          if (due && due !== '—' && new Date(`${due}T00:00:00`) < today) {
            data.cell.styles.textColor = [215, 58, 74];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });

    curY = doc.lastAutoTable.finalY + 4;
  });

  doc.save(`fraxinus-status-${today.toISOString().slice(0, 10)}.pdf`);
}

function resizeImageToDataUrl(file, maxPx = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageAsDataUrl(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
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
  if (!body) return { due: null, effort: null, localAssignees: [], description: '', completionNotes: '', taskClient: '', taskContact: '', taskEmail: '', taskPhone: '' };
  let text = body;
  let due = null, effort = null, completionNotes = '';
  let taskClient = '', taskContact = '', taskEmail = '', taskPhone = '';
  const localAssignees = [];
  const cnSep = '\n\n---\n**Completion Notes:**\n';
  const cnIdx = text.indexOf(cnSep);
  if (cnIdx !== -1) {
    completionNotes = text.slice(cnIdx + cnSep.length).trim();
    text = text.slice(0, cnIdx);
  }
  text = text.replace(/^Due:\s*(\d{4}-\d{2}-\d{2})[ \t]*\r?\n?/m,   (_, v) => { due = v; return ''; });
  text = text.replace(/^Effort:\s*(.+)[ \t]*\r?\n?/m,               (_, v) => { effort = v.trim(); return ''; });
  text = text.replace(/^Local-Assignee:\s*(.+)[ \t]*\r?\n?/mg,      (_, v) => { localAssignees.push(v.trim()); return ''; });
  text = text.replace(/^Task-Client:\s*(.+)[ \t]*\r?\n?/m,          (_, v) => { taskClient  = v.trim(); return ''; });
  text = text.replace(/^Task-Contact:\s*(.+)[ \t]*\r?\n?/m,         (_, v) => { taskContact = v.trim(); return ''; });
  text = text.replace(/^Task-Email:\s*(.+)[ \t]*\r?\n?/m,           (_, v) => { taskEmail   = v.trim(); return ''; });
  text = text.replace(/^Task-Phone:\s*(.+)[ \t]*\r?\n?/m,           (_, v) => { taskPhone   = v.trim(); return ''; });
  return { due, effort, localAssignees, description: text.trim(), completionNotes, taskClient, taskContact, taskEmail, taskPhone };
}

function buildIssueBody(due, effort, localAssigneeNames, description, completionNotes = '', taskClientInfo = {}) {
  const { taskClient, taskContact, taskEmail, taskPhone } = taskClientInfo;
  const metaLines = [];
  if (due)          metaLines.push(`Due: ${due}`);
  if (effort)       metaLines.push(`Effort: ${effort}`);
  localAssigneeNames.forEach(n => metaLines.push(`Local-Assignee: ${n}`));
  if (taskClient)   metaLines.push(`Task-Client: ${taskClient}`);
  if (taskContact)  metaLines.push(`Task-Contact: ${taskContact}`);
  if (taskEmail)    metaLines.push(`Task-Email: ${taskEmail}`);
  if (taskPhone)    metaLines.push(`Task-Phone: ${taskPhone}`);
  const parts = [];
  if (metaLines.length) parts.push(metaLines.join('\n'));
  if (description)      parts.push(description);
  if (completionNotes)  parts.push(`---\n**Completion Notes:**\n${completionNotes}`);
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

function confirmToast(msg, onConfirm) {
  const t = document.createElement('div');
  t.className = 'toast toast-confirm';
  const text = document.createElement('span'); text.textContent = msg;
  const yes = document.createElement('button'); yes.className = 'toast-btn toast-btn-yes'; yes.textContent = 'Delete';
  const no  = document.createElement('button'); no.className  = 'toast-btn toast-btn-no';  no.textContent  = 'Cancel';
  t.appendChild(text); t.appendChild(yes); t.appendChild(no);
  el('toast-container').appendChild(t);
  const dismiss = () => t.remove();
  const timer = setTimeout(dismiss, 6000);
  yes.addEventListener('click', () => { clearTimeout(timer); dismiss(); onConfirm(); });
  no.addEventListener('click',  () => { clearTimeout(timer); dismiss(); });
}
