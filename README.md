# Fraxinus Kanban

A standalone Kanban board for **Fraxinus Environmental & Geomatics Limited**, powered by GitHub Issues. No server, no build step — just three files served from GitHub Pages.

---

## How it works

| GitHub concept | Kanban meaning |
|---|---|
| Issue | Task card |
| Label (stage) | Kanban column |
| Label (task type) | Coloured card badge |
| Label (priority) | Card left-border colour |
| Milestone | Project name |
| Assignee | Team member |

Dragging a card to a new column calls the GitHub Issues API to swap the stage label in real time.

---

## Setup

### 1. Enable GitHub Pages

In the `jastels-frax/fraxinus-kanban` repository:

1. Go to **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)`
4. Save — the board will be live at `https://jastels-frax.github.io/fraxinus-kanban/`

### 2. Create all required labels

Go to **Issues → Labels** in the repo and create each label below. The board uses exact name matching.

#### Stage labels (Kanban columns)

| Label name | Hex colour |
|---|---|
| `Proposal / Scoping` | `#0052cc` |
| `Permitting / Regulatory` | `#5319e7` |
| `Field Scheduled` | `#006b75` |
| `Field Active` | `#2d5a27` |
| `Reporting / Drafting` | `#b08800` |
| `Review / QA` | `#d93f0b` |
| `Delivered / Closed` | `#666666` |

#### Task type labels

| Label name | Hex colour |
|---|---|
| `Fieldwork` | `#0075ca` |
| `Reporting` | `#008672` |
| `Proposal` | `#7057ff` |
| `Permitting` | `#b60205` |
| `GIS / Data` | `#1d76db` |
| `Admin` | `#aaaaaa` |
| `Other` | `#c2e0c6` |

#### Priority labels

| Label name | Hex colour |
|---|---|
| `Priority: High` | `#d73a4a` |
| `Priority: Medium` | `#b08800` |
| `Priority: Low` | `#999999` |

### 3. Create a Personal Access Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Enable the **`repo`** scope
4. Copy the token (you only see it once)

### 4. First load

Open the board URL. The setup modal will appear — paste your token and confirm the owner/repo. The token is stored only in your browser's `localStorage` and never sent anywhere except `api.github.com`.

---

## Using the board

### Adding tasks

- Click **+ Add Task** at the bottom of any column — opens a pre-labelled GitHub issue form in a new tab
- Press **N** anywhere on the board to open a new issue
- Press **R** or click **↻ Refresh** to reload all issues

### Moving tasks

Drag any card to a different column. The API update is instant and the board reflects the change immediately (optimistic update with rollback on error).

### Due dates

Add a line `Due: YYYY-MM-DD` anywhere in an issue body. The board will parse and display it:

- **Red** — overdue
- **Amber** — due within 7 days
- **Grey** — due later

### People view

Click **People** in the header to see a grid of everyone with open tasks, broken down by stage. Click a person to filter the board to just their tasks.

### Filters

Use the filter bar to narrow by **Project** (milestone), **Assignee**, **Task Type**, or **Priority**. Click **Clear** to reset.

---

## Running locally

No build step needed. Serve the files with any static server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

---

## Limitations

- The board shows **open issues only**. Move issues to "Delivered / Closed" before closing them in GitHub if you want them visible in that column.
- The GitHub REST API allows ~5 000 authenticated requests/hour. For very large repos with many issues, pagination keeps requests minimal.
- Token is stored in `localStorage` — do not use a token with write access to repositories other than this one.
