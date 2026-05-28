/* ============================================================
   Fraxinus Kanban — app.js
   GitHub Issues-backed Kanban board
   ============================================================ */

'use strict';

// ---- Constants ----

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
  'Proposal / Scoping':     '#0052cc',
  'Permitting / Regulatory':'#5319e7',
  'Field Scheduled':        '#006b75',
  'Field Active':           '#2d5a27',
  'Reporting / Drafting':   '#b08800',
  'Review / QA':            '#d93f0b',
  'Delivered / Closed':     '#666666',
};

const TASK_TYPE_LABELS = [
  'Fieldwork', 'Reporting', 'Proposal', 'Permitting', 'GIS / Data', 'Admin', 'Other',
];

const PRIORITY_LABELS = [
  'Priority: High', 'Priority: Medium', 'Priority: Low',
];

// ---- State ----

const state = {
  token:         null,
  owner:         null,
  repo:          null,
  issues:        [],
  milestones:    [],
  collaborators: [],
  view:          'board',
  draggedIssue:  null,
  filters: {
    milestone: '',
    assignee:  '',
    type:      '',
    priority:  '',
  },
};

// ---- Bootstrap ----

document.addEventListener('DOMContentLoaded', () => {
  state.token = localStorage.getItem('gh_token');
  state.owner = localStorage.getItem('gh_owner') || 'jastels-frax';
  state.repo  = localStorage.getItem('gh_repo')  || 'fraxinus-kanban';

  if (!state.token) {
    showSetupModal();
  } else {
    document.getElementById('app').classList.remove('hidden');
    loadData();
  }

  bindUIEvents();
});

// ---- Event Bindings ----

function bindUIEvents() {
  // Setup modal
  document.getElementById('save-setup-btn').addEventListener('click', handleSetupSave);
  document.getElementById('pat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSetupSave();
  });

  // View toggle buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Filter controls
  ['milestone-filter', 'assignee-filter', 'type-filter', 'priority-filter'].forEach(id => {
    document.getElementById(id).addEventListener('change', onFilterChange);
  });
  document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);

  // Header buttons
  document.getElementById('refresh-btn').addEventListener('click', () => loadData(true));
  document.getElementById('settings-btn').addEventListener('click', showSetupModal);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') openNewIssue();
    if (e.key === 'r' || e.key === 'R') loadData(true);
  });
}

// ---- Setup / Auth ----

function showSetupModal() {
  const modal = document.getElementById('setup-modal');
  modal.classList.remove('hidden');
  if (state.token) {
    document.getElementById('pat-input').value   = state.token;
    document.getElementById('owner-input').value = state.owner;
    document.getElementById('repo-input').value  = state.repo;
  }
}

async function handleSetupSave() {
  const token = document.getElementById('pat-input').value.trim();
  const owner = document.getElementById('owner-input').value.trim();
  const repo  = document.getElementById('repo-input').value.trim();
  const errEl = document.getElementById('setup-error');
  errEl.classList.add('hidden');

  if (!token || !owner || !repo) {
    showSetupError('All fields are required.');
    return;
  }

  const btn = document.getElementById('save-setup-btn');
  btn.textContent = 'Connecting…';
  btn.disabled = true;

  try {
    const res = await ghFetch(`repos/${owner}/${repo}`, token);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }

    state.token = token;
    state.owner = owner;
    state.repo  = repo;
    localStorage.setItem('gh_token', token);
    localStorage.setItem('gh_owner', owner);
    localStorage.setItem('gh_repo',  repo);

    document.getElementById('setup-modal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadData();
  } catch (err) {
    showSetupError(`Connection failed: ${err.message}`);
  } finally {
    btn.textContent = 'Connect to GitHub';
    btn.disabled = false;
  }
}

function showSetupError(msg) {
  const el = document.getElementById('setup-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ---- GitHub API ----

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
      toast('Token invalid or expired — please update your settings.', 'error');
      showSetupModal();
      throw new Error('unauthorized');
    }
    if (res.status === 403) {
      const reset = res.headers.get('X-RateLimit-Reset');
      const when  = reset ? ` Resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()}.` : '';
      toast(`GitHub rate limit reached.${when}`, 'error');
      throw new Error('rate-limited');
    }
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) { results.push(data); break; }
    results.push(...data);

    const link = res.headers.get('Link') || '';
    if (!link.includes('rel="next"')) break;
    page++;
  }

  return results;
}

// ---- Data Loading ----

async function loadData(forceRefresh = false) {
  if (!state.token) return;
  showLoading(true);

  try {
    const [issuesRaw, milestones, collaborators] = await Promise.all([
      ghFetchPaginated(`repos/${state.owner}/${state.repo}/issues?state=open`),
      ghFetchPaginated(`repos/${state.owner}/${state.repo}/milestones?state=open`).catch(() => []),
      ghFetchPaginated(`repos/${state.owner}/${state.repo}/collaborators`).catch(() => []),
    ]);

    // Exclude pull requests from the issues list
    state.issues       = issuesRaw.filter(i => !i.pull_request);
    state.milestones   = milestones;
    state.collaborators = collaborators;

    populateFilterSelects();
    renderBoard();
    renderPeople();
  } catch (err) {
    if (err.message !== 'unauthorized' && err.message !== 'rate-limited') {
      toast(`Failed to load data: ${err.message}`, 'error');
    }
  } finally {
    showLoading(false);
  }
}

// ---- Filters ----

function populateFilterSelects() {
  // Milestone select
  const msEl  = document.getElementById('milestone-filter');
  const curMs = msEl.value;
  msEl.innerHTML = '<option value="">All Projects</option>';
  state.milestones.forEach(m => {
    const o = document.createElement('option');
    o.value       = m.title;
    o.textContent = m.title;
    msEl.appendChild(o);
  });
  msEl.value = curMs;

  // Assignee select (built from open issues)
  const aEl  = document.getElementById('assignee-filter');
  const curA = aEl.value;
  aEl.innerHTML = '<option value="">All People</option>';
  const seen = new Set();
  state.issues.forEach(issue => {
    (issue.assignees || []).concat(issue.assignee ? [issue.assignee] : [])
      .forEach(a => {
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
  state.filters.milestone = document.getElementById('milestone-filter').value;
  state.filters.assignee  = document.getElementById('assignee-filter').value;
  state.filters.type      = document.getElementById('type-filter').value;
  state.filters.priority  = document.getElementById('priority-filter').value;

  const anyActive = Object.values(state.filters).some(Boolean);
  document.getElementById('active-filter-indicator').classList.toggle('hidden', !anyActive);
  renderBoard();
}

function clearFilters() {
  ['milestone-filter', 'assignee-filter', 'type-filter', 'priority-filter'].forEach(id => {
    document.getElementById(id).value = '';
  });
  state.filters = { milestone: '', assignee: '', type: '', priority: '' };
  document.getElementById('active-filter-indicator').classList.add('hidden');
  renderBoard();
}

function applyFilters(issues) {
  const { milestone, assignee, type, priority } = state.filters;
  return issues.filter(issue => {
    if (milestone && (!issue.milestone || issue.milestone.title !== milestone)) return false;

    if (assignee) {
      const assignees = new Set(
        (issue.assignees || []).concat(issue.assignee ? [issue.assignee] : []).map(a => a.login)
      );
      if (!assignees.has(assignee)) return false;
    }

    const labelNames = issue.labels.map(l => l.name);
    if (type     && !labelNames.includes(type))     return false;
    if (priority && !labelNames.includes(priority)) return false;

    return true;
  });
}

// ---- Board Render ----

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  const visible = applyFilters(state.issues);

  STAGE_LABELS.forEach(stage => {
    const stageIssues = visible.filter(i => i.labels.some(l => l.name === stage));
    board.appendChild(buildColumn(stage, stageIssues));
  });
}

function buildColumn(stage, issues) {
  const col = document.createElement('div');
  col.className    = 'column';
  col.dataset.stage = stage;

  // Header
  const header = document.createElement('div');
  header.className = 'column-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'column-title-wrap';

  const dot = document.createElement('span');
  dot.className   = 'column-dot';
  dot.style.background = STAGE_COLORS[stage];

  const title = document.createElement('span');
  title.className   = 'column-title';
  title.textContent = stage;

  titleWrap.appendChild(dot);
  titleWrap.appendChild(title);

  const count = document.createElement('span');
  count.className   = 'column-count';
  count.textContent = issues.length;

  header.appendChild(titleWrap);
  header.appendChild(count);
  col.appendChild(header);

  // Body (drop zone)
  const body = document.createElement('div');
  body.className = 'column-body';

  body.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('drop-active');
  });
  body.addEventListener('dragleave', e => {
    if (!col.contains(e.relatedTarget)) {
      col.classList.remove('drop-active');
    }
  });
  body.addEventListener('drop', e => {
    e.preventDefault();
    col.classList.remove('drop-active');
    if (state.draggedIssue) {
      moveIssueToStage(state.draggedIssue, stage);
    }
  });

  issues.forEach(issue => body.appendChild(buildCard(issue)));
  col.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'column-footer';
  const addBtn = document.createElement('button');
  addBtn.className   = 'btn add-task-btn';
  addBtn.textContent = '+ Add Task';
  addBtn.addEventListener('click', () => openNewIssue(stage));
  footer.appendChild(addBtn);
  col.appendChild(footer);

  return col;
}

function buildCard(issue) {
  const card = document.createElement('div');
  card.className            = 'card';
  card.draggable            = true;
  card.dataset.issueNumber  = issue.number;

  const labelNames = issue.labels.map(l => l.name);
  const priority   = PRIORITY_LABELS.find(p => labelNames.includes(p));
  if (priority) card.dataset.priority = priority;

  // Drag events
  card.addEventListener('dragstart', e => {
    state.draggedIssue = issue;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox
    e.dataTransfer.setData('text/plain', String(issue.number));
  });
  card.addEventListener('dragend', () => {
    state.draggedIssue = null;
    card.classList.remove('dragging');
  });

  // Title
  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  const link = document.createElement('a');
  link.href    = issue.html_url;
  link.target  = '_blank';
  link.rel     = 'noopener noreferrer';
  link.textContent = issue.title;
  // Prevent drag from triggering link navigation
  link.addEventListener('click', e => e.stopPropagation());
  titleEl.appendChild(link);
  card.appendChild(titleEl);

  // Meta section
  const meta = document.createElement('div');
  meta.className = 'card-meta';

  if (issue.milestone) {
    const proj = document.createElement('div');
    proj.className   = 'card-project';
    proj.textContent = `\u{1F4CB} ${issue.milestone.title}`;
    meta.appendChild(proj);
  }

  const assignee = getFirstAssignee(issue);
  if (assignee) {
    const aRow = document.createElement('div');
    aRow.className = 'card-assignee';
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src   = `${assignee.avatar_url}&s=36`;
    img.alt   = assignee.login;
    img.title = assignee.login;
    img.loading = 'lazy';
    aRow.appendChild(img);
    aRow.appendChild(document.createTextNode(assignee.login));
    meta.appendChild(aRow);
  }

  if (meta.children.length) card.appendChild(meta);

  // Footer: task type chip + due date
  const cardFooter = document.createElement('div');
  cardFooter.className = 'card-footer';

  const taskType = issue.labels.find(l => TASK_TYPE_LABELS.includes(l.name));
  if (taskType) {
    const chip = document.createElement('span');
    chip.className   = 'label-chip';
    chip.textContent = taskType.name;
    const hex = taskType.color.replace(/^#/, '');
    chip.style.background = `#${hex}`;
    chip.style.color = isLightHex(hex) ? '#1a1a1a' : '#ffffff';
    cardFooter.appendChild(chip);
  }

  const due = parseDueDate(issue.body);
  if (due) {
    const dueEl = document.createElement('span');
    dueEl.className = 'due-date';
    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const dueDate = new Date(`${due}T00:00:00`);
    const days    = Math.ceil((dueDate - today) / 86400000);
    if (days < 0) {
      dueEl.classList.add('overdue');
      dueEl.textContent = `Overdue: ${due}`;
    } else if (days <= 7) {
      dueEl.classList.add('soon');
      dueEl.textContent = `Due: ${due}`;
    } else {
      dueEl.textContent = `Due: ${due}`;
    }
    cardFooter.appendChild(dueEl);
  }

  if (cardFooter.children.length) card.appendChild(cardFooter);

  return card;
}

// ---- People View ----

function renderPeople() {
  const grid = document.getElementById('people-grid');
  grid.innerHTML = '';

  const peopleMap = new Map();

  state.issues.forEach(issue => {
    const assignees = (issue.assignees || []).concat(issue.assignee ? [issue.assignee] : []);
    const seen = new Set();
    assignees.forEach(a => {
      if (seen.has(a.login)) return;
      seen.add(a.login);
      if (!peopleMap.has(a.login)) {
        peopleMap.set(a.login, { user: a, issues: [] });
      }
      peopleMap.get(a.login).issues.push(issue);
    });
  });

  if (peopleMap.size === 0) {
    const empty = document.createElement('p');
    empty.className   = 'people-empty';
    empty.textContent = 'No assignees found on open issues.';
    grid.appendChild(empty);
    return;
  }

  Array.from(peopleMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([, { user, issues }]) => {
      grid.appendChild(buildPersonCard(user, issues));
    });
}

function buildPersonCard(user, issues) {
  const card = document.createElement('div');
  card.className = 'person-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.title = `Filter board to ${user.login}`;

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'person-header';

  const img = document.createElement('img');
  img.className = 'person-avatar';
  img.src     = `${user.avatar_url}&s=80`;
  img.alt     = user.login;
  img.loading = 'lazy';

  const info = document.createElement('div');

  const nameEl = document.createElement('div');
  nameEl.className   = 'person-name';
  nameEl.textContent = user.login;

  const cntEl = document.createElement('div');
  cntEl.className   = 'person-count';
  cntEl.textContent = `${issues.length} open task${issues.length !== 1 ? 's' : ''}`;

  info.appendChild(nameEl);
  info.appendChild(cntEl);
  hdr.appendChild(img);
  hdr.appendChild(info);
  card.appendChild(hdr);

  // Stage breakdown
  const stagesEl = document.createElement('div');
  stagesEl.className = 'person-stages';

  STAGE_LABELS.forEach(stage => {
    const n = issues.filter(i => i.labels.some(l => l.name === stage)).length;
    if (n === 0) return;

    const row = document.createElement('div');
    row.className = 'person-stage-row';

    const dot = document.createElement('span');
    dot.className        = 'stage-dot';
    dot.style.background = STAGE_COLORS[stage];

    const nameSpan = document.createElement('span');
    nameSpan.className   = 'stage-name';
    nameSpan.textContent = stage;

    const cntSpan = document.createElement('span');
    cntSpan.className   = 'stage-count';
    cntSpan.textContent = n;

    row.appendChild(dot);
    row.appendChild(nameSpan);
    row.appendChild(cntSpan);
    stagesEl.appendChild(row);
  });

  card.appendChild(stagesEl);

  // Click / keyboard → filter board by this person
  const filterToPerson = () => {
    document.getElementById('assignee-filter').value = user.login;
    state.filters.assignee = user.login;
    document.getElementById('active-filter-indicator').classList.remove('hidden');
    switchView('board');
    renderBoard();
  };
  card.addEventListener('click', filterToPerson);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filterToPerson(); }
  });

  return card;
}

// ---- Move Issue (Drag & Drop) ----

async function moveIssueToStage(issue, newStage) {
  const currentStages = issue.labels.filter(l => STAGE_LABELS.includes(l.name)).map(l => l.name);
  if (currentStages.includes(newStage)) return;

  const newLabelNames = issue.labels
    .map(l => l.name)
    .filter(n => !STAGE_LABELS.includes(n))
    .concat(newStage);

  // Optimistic update
  const originalLabels = issue.labels;
  issue.labels = [
    ...issue.labels.filter(l => !STAGE_LABELS.includes(l.name)),
    { name: newStage, color: STAGE_COLORS[newStage].replace('#', '') },
  ];
  renderBoard();

  try {
    const res = await ghFetch(
      `repos/${state.owner}/${state.repo}/issues/${issue.number}`,
      state.token,
      {
        method: 'PATCH',
        body: JSON.stringify({ labels: newLabelNames }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }
    const updated = await res.json();
    const idx = state.issues.findIndex(i => i.number === issue.number);
    if (idx >= 0) state.issues[idx] = updated;
    renderBoard();
    renderPeople();
    toast(`Moved to "${newStage}"`, 'success');
  } catch (err) {
    issue.labels = originalLabels;
    renderBoard();
    toast(`Could not move issue: ${err.message}`, 'error');
  }
}

// ---- View Switching ----

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('board-view').classList.toggle('hidden', view !== 'board');
  document.getElementById('people-view').classList.toggle('hidden', view !== 'people');
}

// ---- New Issue ----

function openNewIssue(stage = null) {
  const base   = `https://github.com/${state.owner}/${state.repo}/issues/new`;
  const params = new URLSearchParams();
  if (stage) params.set('labels', stage);
  const qs = params.toString();
  window.open(qs ? `${base}?${qs}` : base, '_blank', 'noopener,noreferrer');
}

// ---- Helpers ----

function getFirstAssignee(issue) {
  if (issue.assignees && issue.assignees.length) return issue.assignees[0];
  if (issue.assignee) return issue.assignee;
  return null;
}

function parseDueDate(body) {
  if (!body) return null;
  const m = body.match(/[Dd]ue:\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function isLightHex(hex) {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

function showLoading(on) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !on);
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className   = `toast${type !== 'info' ? ` ${type}` : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
