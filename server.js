const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_BASE_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH ||
  (fs.existsSync('/data') ? '/data/tasks.db' : path.join(__dirname, 'tasks.db'));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    category TEXT,
    project TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    due_date TEXT,
    estimated_minutes INTEGER,
    actual_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    is_inbox INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS time_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL,
    description TEXT,
    logged_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS template_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    estimated_minutes INTEGER
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS project_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_meeting_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS focus_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    max_tasks INTEGER NOT NULL DEFAULT 7,
    max_hours INTEGER NOT NULL DEFAULT 40,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_focus_lists (
    task_id      INTEGER NOT NULL REFERENCES tasks(id)       ON DELETE CASCADE,
    focus_list_id INTEGER NOT NULL REFERENCES focus_lists(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, focus_list_id)
  );

  CREATE TABLE IF NOT EXISTS time_blocks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    date             TEXT NOT NULL,
    start_time       TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    logged           INTEGER NOT NULL DEFAULT 0,
    parent_category_block_id INTEGER,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS category_blocks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    label            TEXT NOT NULL,
    category         TEXT NOT NULL,
    date             TEXT NOT NULL,
    start_time       TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    google_event_id  TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS google_auth (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    refresh_token TEXT NOT NULL,
    connected_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sprints (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    start_date TEXT,
    end_date   TEXT,
    status     TEXT NOT NULL DEFAULT 'upcoming',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sprint_tasks (
    sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    task_id   INTEGER NOT NULL REFERENCES tasks(id)   ON DELETE CASCADE,
    PRIMARY KEY (sprint_id, task_id)
  );

  CREATE TABLE IF NOT EXISTS project_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    date       TEXT NOT NULL,
    body       TEXT,
    type       TEXT NOT NULL DEFAULT 'meeting-notes',
    phase      TEXT,
    category   TEXT,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Idempotent migrations
try { db.prepare('ALTER TABLE tasks ADD COLUMN blocked_by_task_id INTEGER').run(); } catch(e) {}
try { db.prepare('ALTER TABLE focus_lists ADD COLUMN max_tasks INTEGER NOT NULL DEFAULT 7').run(); } catch(e) {}
try { db.prepare('ALTER TABLE focus_lists ADD COLUMN max_hours INTEGER NOT NULL DEFAULT 40').run(); } catch(e) {}
try { db.prepare('ALTER TABLE task_meeting_notes ADD COLUMN label TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE time_blocks ADD COLUMN parent_category_block_id INTEGER').run(); } catch(e) {}
try { db.prepare('ALTER TABLE category_blocks ADD COLUMN google_event_id TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE time_blocks ADD COLUMN gcal_event_id TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE time_blocks ADD COLUMN gcal_linked INTEGER NOT NULL DEFAULT 0').run(); } catch(e) {}
try { db.prepare('ALTER TABLE tasks ADD COLUMN gmail_message_id TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE tasks ADD COLUMN gmail_thread_id TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE tasks ADD COLUMN source_url TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE tasks ADD COLUMN source_sender TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE tasks ADD COLUMN source_date TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE tasks ADD COLUMN phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL').run(); } catch(e) {}
try { db.prepare('ALTER TABLE focus_lists ADD COLUMN sprint_week TEXT').run(); } catch(e) {}
try { db.prepare("ALTER TABLE tasks ADD COLUMN horizon TEXT NOT NULL DEFAULT 'active'").run(); } catch(e) {}
try { db.prepare("ALTER TABLE projects ADD COLUMN horizon TEXT NOT NULL DEFAULT 'active'").run(); } catch(e) {}
try { db.prepare('ALTER TABLE time_logs ADD COLUMN gcal_event_id TEXT').run(); } catch(e) {}
// One-time: backfill source fields from existing Gmail task notes
if (!db.prepare("SELECT value FROM settings WHERE key='gmail_source_backfill_v1'").get()) {
  try {
    const rows = db.prepare("SELECT id, notes FROM tasks WHERE gmail_message_id IS NOT NULL AND source_url IS NULL AND notes IS NOT NULL").all();
    const stmt = db.prepare('UPDATE tasks SET source_url=?, source_sender=?, source_date=? WHERE id=?');
    for (const r of rows) {
      const urlM    = r.notes.match(/\[Open in Gmail\]\((https[^\)]+)\)/);
      const fromM   = r.notes.match(/^From:\s(.+)/m);
      const dateM   = r.notes.match(/^Date:\s(.+)/m);
      const url     = urlM  ? urlM[1].trim()  : null;
      const sender  = fromM ? fromM[1].trim() : null;
      const date    = dateM ? dateM[1].trim() : null;
      if (url || sender) stmt.run(url, sender, date, r.id);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('gmail_source_backfill_v1','1')").run();
  } catch(e) { console.error('[migration] gmail_source_backfill_v1 failed:', e.message); }
}
try { db.prepare("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'professional'").run(); } catch(e) {}
try { db.prepare('ALTER TABLE projects ADD COLUMN division TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE projects ADD COLUMN audience TEXT').run(); } catch(e) {}
// One-time: clear app-managed category blocks (replaced by Google Calendar theme mappings)
if (!db.prepare("SELECT value FROM settings WHERE key='cat_blocks_cleared_v1'").get()) {
  try {
    db.prepare('DELETE FROM category_blocks').run();
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('cat_blocks_cleared_v1','1')").run();
  } catch(e) { console.error('[migration] cat_blocks_cleared_v1 failed:', e.message); }
}
// Seed user_timezone default if not set
if (!db.prepare("SELECT value FROM settings WHERE key='user_timezone'").get()) {
  db.prepare("INSERT INTO settings (key,value) VALUES ('user_timezone','America/New_York')").run();
}

// project_links extra columns
try { db.prepare("ALTER TABLE project_links ADD COLUMN type TEXT NOT NULL DEFAULT 'web-link'").run(); } catch(e) {}
try { db.prepare('ALTER TABLE project_links ADD COLUMN phase TEXT').run(); } catch(e) {}
try { db.prepare('ALTER TABLE project_links ADD COLUMN category TEXT').run(); } catch(e) {}

// Editable divisions
db.exec(`CREATE TABLE IF NOT EXISTS divisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6366f1',
  sort_order INTEGER NOT NULL DEFAULT 0
)`);
[['TSP','#3b82f6',1],['Legendary Stages','#8b5cf6',2],['Xtrava','#10b981',3],['WOW Speakers','#f59e0b',4]]
  .forEach(([name,color,sort_order]) => {
    try { db.prepare('INSERT OR IGNORE INTO divisions (name,color,sort_order) VALUES (?,?,?)').run(name,color,sort_order); } catch(e) {}
  });
try { db.prepare('ALTER TABLE projects ADD COLUMN division_id INTEGER REFERENCES divisions(id)').run(); } catch(e) {}
try { db.prepare("ALTER TABLE divisions ADD COLUMN type TEXT NOT NULL DEFAULT 'professional'").run(); } catch(e) {}

// Phases
db.exec(`CREATE TABLE IF NOT EXISTS phases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'not-started'
)`);

// Division phase templates
db.exec(`CREATE TABLE IF NOT EXISTS division_phase_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  division_id INTEGER NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
)`);

// One-time migration: map projects.division (text) → division_id
if (!db.prepare("SELECT value FROM settings WHERE key='divisions_migration_v1'").get()) {
  try {
    db.transaction(() => {
      db.prepare("UPDATE projects SET division_id=(SELECT id FROM divisions WHERE name=projects.division) WHERE division IS NOT NULL").run();
      const broken = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE division IS NOT NULL AND division_id IS NULL").get().n;
      if (broken > 0) throw new Error(`${broken} project(s) could not be mapped to a division`);
      db.prepare("INSERT INTO settings (key,value) VALUES ('divisions_migration_v1','1')").run();
    })();
    console.log('[migration] divisions_migration_v1 complete');
  } catch(e) { console.error('[migration] divisions_migration_v1 failed:', e.message); }
}

// Unified notes store
db.exec(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  type       TEXT NOT NULL DEFAULT 'meeting-notes',
  phase      TEXT,
  category   TEXT,
  note_date  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// additive column migrations for notes
try { db.prepare("ALTER TABLE notes ADD COLUMN ai_summary_url TEXT").run(); } catch(e) {}

db.exec(`CREATE TABLE IF NOT EXISTS note_shares (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id            INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  token              TEXT NOT NULL UNIQUE,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at         TEXT,
  revoked_at         TEXT,
  include_ai_summary INTEGER NOT NULL DEFAULT 0
)`);

// One-time migration: project_notes + task_meeting_notes → notes
if (!db.prepare("SELECT value FROM settings WHERE key='notes_migration_v1'").get()) {
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO notes (project_id,task_id,title,body,type,phase,category,note_date,created_at)
        SELECT project_id,task_id,title,body,type,phase,category,date,created_at FROM project_notes`).run();
      db.prepare(`INSERT INTO notes (project_id,task_id,title,body,type,note_date,created_at)
        SELECT (SELECT p.id FROM projects p JOIN tasks t2 ON t2.project=p.name WHERE t2.id=mn.task_id LIMIT 1),
               mn.task_id,
               COALESCE(NULLIF(TRIM(mn.label),''),'Meeting Note'),
               mn.url, 'meeting-link', mn.date, mn.created_at
        FROM task_meeting_notes mn`).run();
      db.prepare("INSERT INTO settings (key,value) VALUES ('notes_migration_v1','1')").run();
    })();
    console.log('[migration] notes_migration_v1 complete');
  } catch(e) { console.error('[migration] notes_migration_v1 failed:', e.message); }
}

// 6-stage workflow: preserve old statuses, then remap
try { db.prepare('ALTER TABLE tasks ADD COLUMN legacy_status TEXT').run(); } catch(e) {}
db.prepare('UPDATE tasks SET legacy_status = status WHERE legacy_status IS NULL').run();
[['pending','new'],['needs-review','on-hold'],['blocked','on-hold']].forEach(([from, to]) => {
  const n = db.prepare('UPDATE tasks SET status = ? WHERE status = ?').run(to, from).changes;
  if (n > 0) console.log(`[migration] Remapped ${n} task(s) from '${from}' to '${to}'`);
});
// Rename needs-review stage → review (any stragglers not caught above)
{ const n = db.prepare("UPDATE tasks SET status='review' WHERE status='needs-review'").run().changes; if (n > 0) console.log(`[migration] Remapped ${n} task(s) needs-review → review`); }

// One-time: convert "Priority Push" focus list to current week's sprint
if (!db.prepare("SELECT value FROM settings WHERE key='weekly_sprint_v1'").get()) {
  try {
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const wk = mon.toISOString().slice(0, 10);
    db.transaction(() => {
      const fl = db.prepare("SELECT * FROM focus_lists WHERE LOWER(name) LIKE '%priority push%'").get();
      if (fl && !fl.sprint_week) {
        db.prepare('UPDATE focus_lists SET sprint_week=?, name=? WHERE id=?').run(wk, `Week of ${wk}`, fl.id);
      }
      db.prepare("INSERT INTO settings (key,value) VALUES ('weekly_sprint_v1','1')").run();
    })();
    console.log('[migration] weekly_sprint_v1 complete');
  } catch(e) { console.error('[migration] weekly_sprint_v1 failed:', e.message); }
}

// Default settings
[['daily_capacity_minutes','480'],['day_start_hour','5'],['day_end_hour','21'],
 ['gmail_capture_enabled','0'],
 ['category_capacity_hours','{"sales-marketing":7.5,"operations":10,"systems":10,"client-services":12.5,"personal":5}']]
  .forEach(([k,v]) => db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k,v));

// Editable categories
db.exec(`CREATE TABLE IF NOT EXISTS categories (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📁',
  color      TEXT NOT NULL DEFAULT '#6366f1',
  sort_order INTEGER NOT NULL DEFAULT 0
)`);
try { db.prepare('ALTER TABLE categories ADD COLUMN test_question TEXT').run(); } catch(e) {}
// Only seed legacy categories if the v2 merge hasn't run yet
if (!db.prepare("SELECT value FROM settings WHERE key='category_merge_v2'").get()) {
  [
    ['admin',      'Admin',              '🗂',  '#6366f1', 1],
    ['ops',        'Ops',                '⚙️', '#0ea5e9', 2],
    ['accounting', 'Accounting',         '💰', '#10b981', 3],
    ['marketing',  'Marketing',          '📣', '#ec4899', 4],
    ['sales',      'Sales',              '💼', '#14b8a6', 5],
    ['pm',         'Project Management', '📐', '#8b5cf6', 6],
    ['hr',         'HR',                 '👥', '#f59e0b', 7],
    ['personal',   'Personal',           '🏠', '#ef4444', 8],
  ].forEach(([slug,name,icon,color,sort_order]) => {
    try { db.prepare('INSERT OR IGNORE INTO categories (slug,name,icon,color,sort_order) VALUES (?,?,?,?,?)').run(slug,name,icon,color,sort_order); } catch(e) {}
  });
}

// ── Category merge v2 (idempotent, single transaction, persistent backup) ──────
const CATEGORY_MERGE_MAP = {
  'sales':      'sales-marketing',
  'marketing':  'sales-marketing',
  'admin':      'operations',
  'ops':        'operations',
  'accounting': 'operations',
  'hr':         'operations',
  'pm':         'client-services',
  'personal':   'personal',
};
const NEW_CATEGORIES = [
  ['sales-marketing', 'Sales & Marketing', '💼', '#14b8a6', 1, 'Will this bring in NEW business?'],
  ['operations',      'Operations',        '⚙️', '#0ea5e9', 2, 'Is this RECURRING upkeep that keeps things running?'],
  ['systems',         'Systems',           '🔧', '#8b5cf6', 3, 'Am I BUILDING or IMPROVING how the business works?'],
  ['client-services', 'Client Services',   '🤝', '#f59e0b', 4, 'Is a SPECIFIC client or partner waiting on this?'],
  ['personal',        'Personal',          '🏠', '#ef4444', 5, 'Is this for my life outside the business?'],
];

function runCategoryMergeV2() {
  if (db.prepare("SELECT value FROM settings WHERE key='category_merge_v2'").get()) return;

  // Write backup to persistent volume (same dir as DB)
  const backupDir = path.join(path.dirname(DB_PATH), 'backups');
  try { fs.mkdirSync(backupDir, { recursive: true }); } catch(e) {}
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `categories_backup_${timestamp}.json`);
  const backup = {
    timestamp,
    categories: db.prepare('SELECT * FROM categories').all(),
    task_categories: db.prepare('SELECT id, title, category FROM tasks WHERE category IS NOT NULL').all(),
    template_task_categories: db.prepare('SELECT id, title, category FROM template_tasks WHERE category IS NOT NULL').all(),
    category_block_categories: db.prepare('SELECT id, label, category FROM category_blocks WHERE category IS NOT NULL').all(),
    project_link_categories: db.prepare('SELECT id, label, category FROM project_links WHERE category IS NOT NULL').all(),
    note_categories: db.prepare('SELECT id, title, category FROM notes WHERE category IS NOT NULL').all(),
  };
  try { fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2)); } catch(e) { console.error('[category_merge_v2] backup write failed:', e.message); }

  // Count before
  const beforeCounts = {};
  db.prepare('SELECT category, COUNT(*) AS n FROM tasks WHERE category IS NOT NULL GROUP BY category').all()
    .forEach(r => { beforeCounts[r.category] = r.n; });

  try {
    db.transaction(() => {
      // Upsert new categories
      for (const [slug,name,icon,color,sort_order,test_question] of NEW_CATEGORIES) {
        db.prepare(`INSERT INTO categories (slug,name,icon,color,sort_order,test_question)
          VALUES (?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,icon=excluded.icon,color=excluded.color,sort_order=excluded.sort_order,test_question=excluded.test_question`
        ).run(slug, name, icon, color, sort_order, test_question);
      }

      // Remap all references
      for (const [oldSlug, newSlug] of Object.entries(CATEGORY_MERGE_MAP)) {
        if (oldSlug === newSlug) continue;
        db.prepare('UPDATE tasks SET category=? WHERE category=?').run(newSlug, oldSlug);
        db.prepare('UPDATE template_tasks SET category=? WHERE category=?').run(newSlug, oldSlug);
        db.prepare('UPDATE category_blocks SET category=? WHERE category=?').run(newSlug, oldSlug);
        db.prepare('UPDATE project_links SET category=? WHERE category=?').run(newSlug, oldSlug);
        db.prepare('UPDATE notes SET category=? WHERE category=?').run(newSlug, oldSlug);
      }

      // Delete old categories that were fully merged away
      const oldSlugs = Object.keys(CATEGORY_MERGE_MAP).filter(s => CATEGORY_MERGE_MAP[s] !== s && !NEW_CATEGORIES.find(nc => nc[0] === s));
      for (const s of oldSlugs) {
        db.prepare('DELETE FROM categories WHERE slug=?').run(s);
      }

      db.prepare("INSERT INTO settings (key,value) VALUES ('category_merge_v2','1')").run();
    })();

    // Count after and log
    const afterCounts = {};
    db.prepare('SELECT category, COUNT(*) AS n FROM tasks WHERE category IS NOT NULL GROUP BY category').all()
      .forEach(r => { afterCounts[r.category] = r.n; });
    console.log('[category_merge_v2] Before counts:', JSON.stringify(beforeCounts));
    console.log('[category_merge_v2] After counts:', JSON.stringify(afterCounts));
    console.log('[category_merge_v2] Backup written to:', backupPath);

    // Log tasks whose category was NOT in the merge map (left unchanged, non-null)
    const knownOld = new Set(Object.keys(CATEGORY_MERGE_MAP));
    const knownNew = new Set(NEW_CATEGORIES.map(nc => nc[0]));
    const allCats = db.prepare('SELECT DISTINCT category FROM tasks WHERE category IS NOT NULL').all().map(r => r.category);
    const unmapped = allCats.filter(c => !knownOld.has(c) && !knownNew.has(c));
    if (unmapped.length) console.log('[category_merge_v2] Unmapped categories left unchanged:', unmapped.join(', '));

    console.log('[category_merge_v2] complete');
  } catch(e) {
    console.error('[category_merge_v2] FAILED, rolled back:', e.message);
  }
}
runCategoryMergeV2();

app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.use(express.static(path.join(__dirname, 'public')));

// ── Tasks ────────────────────────────────────────────────────────────────────

app.get('/api/tasks', (req, res) => {
  const { status, category, project, priority, inbox } = req.query;
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];

  if (status)   { sql += ' AND status = ?';    params.push(status); }
  if (category) { sql += ' AND category = ?';  params.push(category); }
  if (project)  { sql += ' AND project = ?';   params.push(project); }
  if (priority) { sql += ' AND priority = ?';  params.push(priority); }
  if (inbox !== undefined) {
    sql += ' AND is_inbox = ?';
    params.push(inbox === 'true' ? 1 : 0);
  }

  sql += `
    ORDER BY
      CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END,
      CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
      due_date ASC,
      created_at DESC`;

  const tasks = db.prepare(sql).all(...params);

  const subRows = db.prepare('SELECT task_id, COUNT(*) AS total, SUM(completed) AS done FROM subtasks GROUP BY task_id').all();
  const cmap = {};
  subRows.forEach(r => { cmap[r.task_id] = r; });

  const mnCounts = {};
  db.prepare('SELECT task_id, COUNT(*) AS cnt FROM notes WHERE task_id IS NOT NULL GROUP BY task_id').all()
    .forEach(r => { mnCounts[r.task_id] = { cnt: r.cnt }; });
  db.prepare(`SELECT n.task_id, n.body AS url FROM notes n
    WHERE n.task_id IS NOT NULL AND n.type='meeting-link'
    AND n.id=(SELECT id FROM notes WHERE task_id=n.task_id AND type='meeting-link' ORDER BY note_date DESC,id DESC LIMIT 1)`).all()
    .forEach(r => { if (mnCounts[r.task_id]) mnCounts[r.task_id].latest_url = r.url; });

  const flRows = db.prepare('SELECT task_id, focus_list_id FROM task_focus_lists').all();
  const flMap  = {};
  flRows.forEach(r => { (flMap[r.task_id] = flMap[r.task_id] || []).push(r.focus_list_id); });

  const schedRows = db.prepare('SELECT task_id, SUM(duration_minutes) AS total FROM time_blocks GROUP BY task_id').all();
  const schedMap  = {};
  schedRows.forEach(r => { schedMap[r.task_id] = r.total; });

  res.json(tasks.map(t => ({
    ...t,
    subtask_count: cmap[t.id]?.total || 0,
    subtask_done:  cmap[t.id]?.done  || 0,
    meeting_notes_count:      mnCounts[t.id]?.cnt        || 0,
    meeting_notes_latest_url: mnCounts[t.id]?.latest_url || null,
    focus_list_ids: flMap[t.id] || [],
    scheduled_minutes: schedMap[t.id] || 0,
  })));
});

app.get('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.post('/api/tasks', (req, res) => {
  const {
    title, priority = 'medium', category, project,
    status = 'new', due_date, estimated_minutes, notes, horizon = 'active'
  } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const is_inbox = (!category && !project) ? 1 : 0;
  const result = db.prepare(`
    INSERT INTO tasks (title, priority, category, project, status, due_date, estimated_minutes, notes, is_inbox, horizon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), priority,
    category || null, project || null,
    status, due_date || null,
    estimated_minutes ? Number(estimated_minutes) : null,
    notes || null, is_inbox, horizon
  );

  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const body = req.body;
  const title    = body.title     !== undefined ? body.title     : task.title;
  const priority = body.priority  !== undefined ? body.priority  : task.priority;
  const category = body.category  !== undefined ? (body.category  || null) : task.category;
  const project  = body.project   !== undefined ? (body.project   || null) : task.project;
  const status   = body.status    !== undefined ? body.status    : task.status;
  const due_date = body.due_date  !== undefined ? (body.due_date  || null) : task.due_date;
  const estimated_minutes = body.estimated_minutes !== undefined
    ? (body.estimated_minutes ? Number(body.estimated_minutes) : null)
    : task.estimated_minutes;
  const notes    = body.notes !== undefined ? (body.notes || null) : task.notes;
  const is_inbox = (!category && !project) ? 1 : 0;
  const blocked_by_task_id = body.blocked_by_task_id !== undefined
    ? (body.blocked_by_task_id ? Number(body.blocked_by_task_id) : null)
    : task.blocked_by_task_id;
  const phase_id = body.phase_id !== undefined
    ? (body.phase_id ? Number(body.phase_id) : null)
    : task.phase_id;
  const horizon = body.horizon !== undefined ? body.horizon : (task.horizon || 'active');

  const titleChanged = title !== task.title;
  const goingSomeday = horizon === 'someday' && (task.horizon || 'active') === 'active';
  db.transaction(() => {
    db.prepare(`
      UPDATE tasks SET
        title = ?, priority = ?, category = ?, project = ?, status = ?,
        due_date = ?, estimated_minutes = ?, notes = ?, is_inbox = ?,
        blocked_by_task_id = ?, phase_id = ?, horizon = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(title, priority, category, project, status, due_date, estimated_minutes, notes, is_inbox, blocked_by_task_id, phase_id, horizon, req.params.id);
    if (goingSomeday) {
      db.prepare('DELETE FROM task_focus_lists WHERE task_id = ?').run(req.params.id);
    }
  })();

  // Fire-and-forget: update GCal titles for future blocks on task rename
  if (titleChanged) {
    const today = new Date().toISOString().slice(0, 10);
    const futureBlocks = db.prepare('SELECT * FROM time_blocks WHERE task_id=? AND date>=? AND gcal_event_id IS NOT NULL').all(req.params.id, today);
    if (futureBlocks.length) {
      (async () => {
        for (const b of futureBlocks) await syncTaskBlockToGoogle(b, b.gcal_event_id);
      })().catch(e => console.error('Task rename GCal update error:', e.message));
    }
  }

  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

app.delete('/api/tasks/:id/future-blocks', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const futureBlocks = db.prepare('SELECT * FROM time_blocks WHERE task_id=? AND date>=?').all(req.params.id, today);
  const eventIds = futureBlocks.map(b => b.gcal_event_id).filter(Boolean);
  db.prepare('DELETE FROM time_blocks WHERE task_id=? AND date>=?').run(req.params.id, today);
  if (eventIds.length) Promise.all(eventIds.map(id => deleteGoogleTaskBlockEvent(id))).catch(() => {});
  res.json({ deleted: futureBlocks.length });
});

app.delete('/api/tasks/:id', (req, res) => {
  // Collect future event IDs before cascade-delete removes the blocks
  const today = new Date().toISOString().slice(0, 10);
  const futureEventIds = db.prepare('SELECT gcal_event_id FROM time_blocks WHERE task_id=? AND date>=? AND gcal_event_id IS NOT NULL').all(req.params.id, today).map(r => r.gcal_event_id);
  const result = db.transaction(() => {
    db.prepare('UPDATE tasks SET blocked_by_task_id = NULL WHERE blocked_by_task_id = ?').run(req.params.id);
    return db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  })();
  if (!result.changes) return res.status(404).json({ error: 'Task not found' });
  if (futureEventIds.length) Promise.all(futureEventIds.map(id => deleteGoogleTaskBlockEvent(id))).catch(() => {});
  res.status(204).end();
});

// ── Bulk Task Endpoints ───────────────────────────────────────────────────────

app.patch('/api/tasks/bulk', (req, res) => {
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'patch required' });
  db.transaction(() => {
    for (const id of ids) {
      const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
      if (!task) continue;
      const category = 'category' in patch ? (patch.category||null) : task.category;
      const project  = 'project'  in patch ? (patch.project||null)  : task.project;
      const phase_id = 'phase_id' in patch ? (patch.phase_id||null) : task.phase_id;
      const priority = 'priority' in patch ? patch.priority : task.priority;
      const status   = 'status'   in patch ? patch.status   : task.status;
      const horizon  = 'horizon'  in patch ? patch.horizon  : (task.horizon||'active');
      const estimated_minutes = 'estimated_minutes' in patch
        ? (patch.estimated_minutes ? Number(patch.estimated_minutes) : null)
        : task.estimated_minutes;
      let due_date = task.due_date;
      if ('due_date' in patch) {
        if (patch.due_date === null || patch.due_date === '') {
          due_date = null;
        } else if (patch.due_date && typeof patch.due_date === 'object' && 'shift' in patch.due_date) {
          if (due_date) {
            const d = new Date(due_date + 'T00:00:00');
            d.setDate(d.getDate() + patch.due_date.shift);
            due_date = d.toISOString().slice(0, 10);
          }
        } else {
          due_date = patch.due_date;
        }
      }
      const is_inbox = (!category && !project) ? 1 : 0;
      const goingSomeday = horizon === 'someday' && (task.horizon||'active') === 'active';
      db.prepare(`UPDATE tasks SET category=?,project=?,phase_id=?,priority=?,status=?,due_date=?,estimated_minutes=?,horizon=?,is_inbox=?,updated_at=datetime('now') WHERE id=?`)
        .run(category, project, phase_id, priority, status, due_date, estimated_minutes, horizon, is_inbox, id);
      if (goingSomeday) db.prepare('DELETE FROM task_focus_lists WHERE task_id=?').run(id);
    }
    if (patch.sprint === 'add' || patch.sprint === 'remove') {
      const sprint = db.prepare("SELECT * FROM focus_lists WHERE sprint_week IS NOT NULL ORDER BY sprint_week DESC LIMIT 1").get();
      if (sprint) {
        const ins = db.prepare('INSERT OR IGNORE INTO task_focus_lists (task_id,focus_list_id) VALUES (?,?)');
        const del = db.prepare('DELETE FROM task_focus_lists WHERE task_id=? AND focus_list_id=?');
        ids.forEach(id => patch.sprint === 'add' ? ins.run(id, sprint.id) : del.run(id, sprint.id));
      }
    }
  })();
  const ph = ids.map(()=>'?').join(',');
  res.json(db.prepare(`SELECT * FROM tasks WHERE id IN (${ph})`).all(...ids));
});

app.delete('/api/tasks/bulk', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  const today = new Date().toISOString().slice(0, 10);
  const ph = ids.map(()=>'?').join(',');
  const futureEventIds = db.prepare(`SELECT gcal_event_id FROM time_blocks WHERE task_id IN (${ph}) AND date>=? AND gcal_event_id IS NOT NULL`)
    .all(...ids, today).map(r => r.gcal_event_id);
  db.transaction(() => {
    db.prepare(`UPDATE tasks SET blocked_by_task_id=NULL WHERE blocked_by_task_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...ids);
  })();
  if (futureEventIds.length) Promise.all(futureEventIds.map(id => deleteGoogleTaskBlockEvent(id))).catch(() => {});
  res.json({ deleted: ids.length });
});

// Restore heterogeneous per-task patches (used for Undo)
app.post('/api/tasks/bulk-restore', (req, res) => {
  const { snapshots } = req.body; // [{ id, category, project, phase_id, priority, status, due_date, estimated_minutes, horizon }]
  if (!Array.isArray(snapshots) || !snapshots.length) return res.status(400).json({ error: 'snapshots required' });
  db.transaction(() => {
    for (const s of snapshots) {
      const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(s.id);
      if (!task) continue;
      const is_inbox = (!s.category && !s.project) ? 1 : 0;
      db.prepare(`UPDATE tasks SET category=?,project=?,phase_id=?,priority=?,status=?,due_date=?,estimated_minutes=?,horizon=?,is_inbox=?,updated_at=datetime('now') WHERE id=?`)
        .run(s.category||null, s.project||null, s.phase_id||null, s.priority, s.status, s.due_date||null, s.estimated_minutes||null, s.horizon||'active', is_inbox, s.id);
    }
  })();
  const ids = snapshots.map(s => s.id);
  const ph = ids.map(()=>'?').join(',');
  res.json(db.prepare(`SELECT * FROM tasks WHERE id IN (${ph})`).all(...ids));
});

app.patch('/api/projects/bulk', (req, res) => {
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  db.transaction(() => {
    for (const id of ids) {
      const proj = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
      if (!proj) continue;
      const div_id   = 'division_id' in patch ? (patch.division_id||null) : proj.division_id;
      const type     = 'type'        in patch ? patch.type                : proj.type;
      const horizon  = 'horizon'     in patch ? patch.horizon             : (proj.horizon||'active');
      const rawAud   = 'audience'    in patch ? (patch.audience||null)    : proj.audience;
      const audience = type === 'personal' ? null : rawAud;
      const goingSomeday = horizon === 'someday' && (proj.horizon||'active') === 'active';
      db.prepare('UPDATE projects SET division_id=?,type=?,horizon=?,audience=? WHERE id=?').run(div_id, type, horizon, audience, id);
      if (goingSomeday) db.prepare('DELETE FROM task_focus_lists WHERE task_id IN (SELECT id FROM tasks WHERE project=?)').run(proj.name);
    }
  })();
  const divMap = {};
  db.prepare('SELECT * FROM divisions').all().forEach(d => { divMap[d.id] = d; });
  const ph = ids.map(()=>'?').join(',');
  res.json(db.prepare(`SELECT * FROM projects WHERE id IN (${ph})`).all(...ids).map(p => {
    const div = p.division_id ? divMap[p.division_id] : null;
    return { ...p, division: div?.name||null, division_color: div?.color||null };
  }));
});

// ── Time Logs ─────────────────────────────────────────────────────────────────

const syncActualMinutes = (taskId) => {
  db.prepare(`
    UPDATE tasks
    SET actual_minutes = (SELECT COALESCE(SUM(minutes), 0) FROM time_logs WHERE task_id = ?),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(taskId, taskId);
};

app.get('/api/tasks/:id/time-logs', (req, res) => {
  res.json(
    db.prepare('SELECT * FROM time_logs WHERE task_id = ? ORDER BY logged_at DESC').all(req.params.id)
  );
});

app.post('/api/tasks/:id/time-logs', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { minutes, description, gcal_event_id } = req.body;
  if (!minutes || Number(minutes) <= 0) {
    return res.status(400).json({ error: 'minutes must be a positive number' });
  }

  const log = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO time_logs (task_id, minutes, description, gcal_event_id) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, Number(minutes), description || null, gcal_event_id || null);
    syncActualMinutes(req.params.id);
    return db.prepare('SELECT * FROM time_logs WHERE id = ?').get(r.lastInsertRowid);
  })();

  res.status(201).json(log);
});

app.delete('/api/time-logs/:id', (req, res) => {
  const log = db.prepare('SELECT task_id FROM time_logs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Time log not found' });

  db.transaction(() => {
    db.prepare('DELETE FROM time_logs WHERE id = ?').run(req.params.id);
    syncActualMinutes(log.task_id);
  })();

  res.status(204).end();
});

// ── Subtasks ──────────────────────────────────────────────────────────────────

app.get('/api/tasks/:id/subtasks', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY created_at ASC').all(req.params.id));
});

app.post('/api/tasks/:id/subtasks', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const r = db.prepare('INSERT INTO subtasks (task_id, title) VALUES (?, ?)').run(req.params.id, title.trim());
  res.status(201).json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(r.lastInsertRowid));
});

app.patch('/api/subtasks/:id', (req, res) => {
  const sub = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subtask not found' });
  const title     = req.body.title     !== undefined ? (req.body.title?.trim() || sub.title) : sub.title;
  const completed = req.body.completed !== undefined ? (req.body.completed ? 1 : 0)           : sub.completed;
  db.prepare('UPDATE subtasks SET title = ?, completed = ? WHERE id = ?').run(title, completed, req.params.id);
  res.json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(req.params.id));
});

app.delete('/api/subtasks/:id', (req, res) => {
  const result = db.prepare('DELETE FROM subtasks WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Subtask not found' });
  res.status(204).end();
});

// ── Meeting Notes ─────────────────────────────────────────────────────────────

app.get('/api/tasks/:id/meeting-notes', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(db.prepare('SELECT * FROM task_meeting_notes WHERE task_id = ? ORDER BY date DESC, id DESC').all(req.params.id));
});

app.post('/api/tasks/:id/meeting-notes', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { date, url, label } = req.body;
  if (!date?.trim()) return res.status(400).json({ error: 'Date is required' });
  if (!url?.trim())  return res.status(400).json({ error: 'URL is required' });
  const r = db.prepare('INSERT INTO task_meeting_notes (task_id, date, url, label) VALUES (?, ?, ?, ?)').run(req.params.id, date.trim(), url.trim(), label?.trim() || null);
  res.status(201).json(db.prepare('SELECT * FROM task_meeting_notes WHERE id = ?').get(r.lastInsertRowid));
});

app.delete('/api/meeting-notes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM task_meeting_notes WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Meeting note not found' });
  res.status(204).end();
});

// ── Task Updates (running log) ────────────────────────────────────────────────

app.get('/api/tasks/:id/updates', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(db.prepare('SELECT * FROM task_updates WHERE task_id = ? ORDER BY created_at DESC').all(req.params.id));
});

app.post('/api/tasks/:id/updates', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
  const r = db.prepare('INSERT INTO task_updates (task_id, content) VALUES (?, ?)').run(req.params.id, content.trim());
  res.status(201).json(db.prepare('SELECT * FROM task_updates WHERE id = ?').get(r.lastInsertRowid));
});

app.delete('/api/updates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM task_updates WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Update not found' });
  res.status(204).end();
});

// ── Projects ──────────────────────────────────────────────────────────────────

const withLinks = (proj) => {
  const div = proj.division_id ? db.prepare('SELECT name,color FROM divisions WHERE id=?').get(proj.division_id) : null;
  return { ...proj, division: div?.name||null, division_color: div?.color||null,
    links: db.prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at ASC').all(proj.id) };
};

app.get('/api/projects', (req, res) => {
  const divMap = {};
  db.prepare('SELECT * FROM divisions').all().forEach(d => { divMap[d.id] = d; });
  res.json(db.prepare('SELECT * FROM projects ORDER BY name ASC').all().map(p => {
    const div = p.division_id ? divMap[p.division_id] : null;
    return { ...p, division: div?.name||null, division_color: div?.color||null,
      links: db.prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at ASC').all(p.id) };
  }));
});

app.post('/api/projects', (req, res) => {
  const { name, type = 'professional', division_id, audience } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });
  try {
    const aud = type === 'personal' ? null : (audience || null);
    const result = db.prepare('INSERT INTO projects (name, type, division_id, audience) VALUES (?, ?, ?, ?)').run(name.trim(), type, division_id||null, aud);
    const projId = result.lastInsertRowid;
    if (division_id) {
      const tpls = db.prepare('SELECT * FROM division_phase_templates WHERE division_id = ? ORDER BY sort_order').all(division_id);
      if (tpls.length) {
        const ins = db.prepare('INSERT INTO phases (project_id, name, sort_order, status) VALUES (?,?,?,?)');
        db.transaction(() => {
          tpls.forEach((t, i) => ins.run(projId, t.name, i + 1, i === 0 ? 'active' : 'not-started'));
        })();
      }
    }
    res.status(201).json(withLinks(db.prepare('SELECT * FROM projects WHERE id = ?').get(projId)));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Project already exists' });
    throw e;
  }
});

app.put('/api/projects/:id', (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { name, type, division_id, horizon, audience } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });
  const newType     = type        !== undefined ? type                   : proj.type;
  const newDivId    = division_id !== undefined ? (division_id||null)    : proj.division_id;
  const newHorizon  = horizon     !== undefined ? horizon                : (proj.horizon || 'active');
  const newAudience = audience    !== undefined ? (audience||null)       : proj.audience;
  const finalAudience = newType === 'personal' ? null : newAudience;
  const goingSomeday = newHorizon === 'someday' && (proj.horizon || 'active') === 'active';
  try {
    db.transaction(() => {
      db.prepare('UPDATE projects SET name=?, type=?, division_id=?, horizon=?, audience=? WHERE id=?').run(name.trim(), newType, newDivId, newHorizon, finalAudience, req.params.id);
      db.prepare("UPDATE tasks SET project=?, updated_at=datetime('now') WHERE project=?").run(name.trim(), proj.name);
      if (goingSomeday) {
        // Remove all of this project's tasks from focus lists (sprint)
        db.prepare('DELETE FROM task_focus_lists WHERE task_id IN (SELECT id FROM tasks WHERE project=?)').run(name.trim());
      }
    })();
    res.json(withLinks(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Project name already exists' });
    throw e;
  }
});

app.post('/api/projects/:id/merge', (req, res) => {
  const source = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source project not found' });
  const { targetProjectId } = req.body;
  if (!targetProjectId) return res.status(400).json({ error: 'targetProjectId is required' });
  const target = db.prepare('SELECT * FROM projects WHERE id = ?').get(targetProjectId);
  if (!target) return res.status(404).json({ error: 'Target project not found' });
  if (source.id === target.id) return res.status(400).json({ error: 'Cannot merge project into itself' });

  db.transaction(() => {
    db.prepare('UPDATE tasks SET project = ?, updated_at = datetime(\'now\') WHERE project = ?').run(target.name, source.name);
    db.prepare('DELETE FROM projects WHERE id = ?').run(source.id);
  })();

  res.json({ merged: true, target });
});

app.delete('/api/projects/:id', (req, res) => {
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Project not found' });
  res.status(204).end();
});

// ── Project Links ─────────────────────────────────────────────────────────────

app.get('/api/projects/:id/links', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(db.prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at ASC').all(req.params.id));
});

app.post('/api/projects/:id/links', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { label, url, type = 'web-link', phase, category } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Label is required' });
  if (!url?.trim())   return res.status(400).json({ error: 'URL is required' });
  const r = db.prepare('INSERT INTO project_links (project_id, label, url, type, phase, category) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, label.trim(), url.trim(), type, phase || null, category || null);
  res.status(201).json(db.prepare('SELECT * FROM project_links WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/project-links/:id', (req, res) => {
  const link = db.prepare('SELECT * FROM project_links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const { label, url, type, phase, category } = req.body;
  db.prepare('UPDATE project_links SET label = ?, url = ?, type = ?, phase = ?, category = ? WHERE id = ?')
    .run(label?.trim() ?? link.label, url?.trim() ?? link.url, type ?? link.type, phase ?? link.phase, category ?? link.category, req.params.id);
  res.json(db.prepare('SELECT * FROM project_links WHERE id = ?').get(req.params.id));
});

app.delete('/api/project-links/:id', (req, res) => {
  const result = db.prepare('DELETE FROM project_links WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Link not found' });
  res.status(204).end();
});

// ── Divisions ─────────────────────────────────────────────────────────────────

app.get('/api/divisions', (req, res) => {
  res.json(db.prepare('SELECT * FROM divisions ORDER BY sort_order, name').all());
});

app.post('/api/divisions', (req, res) => {
  const { name, color = '#6366f1', type = 'professional' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const maxOrd = db.prepare('SELECT MAX(sort_order) AS m FROM divisions').get()?.m || 0;
  try {
    const r = db.prepare('INSERT INTO divisions (name,color,sort_order,type) VALUES (?,?,?,?)').run(name.trim(), color, maxOrd + 1, type);
    res.status(201).json(db.prepare('SELECT * FROM divisions WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Division name already exists' });
    throw e;
  }
});

app.put('/api/divisions/:id', (req, res) => {
  const div = db.prepare('SELECT * FROM divisions WHERE id=?').get(req.params.id);
  if (!div) return res.status(404).json({ error: 'Division not found' });
  const { name, color, type } = req.body;
  if (type && type !== div.type) {
    const cnt = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE division_id=?').get(div.id).n;
    if (cnt > 0) return res.status(409).json({ error: `Cannot change type: ${cnt} project${cnt!==1?'s':''} use this division` });
  }
  try {
    db.prepare('UPDATE divisions SET name=?,color=?,type=? WHERE id=?').run(name?.trim()??div.name, color??div.color, type??div.type, div.id);
    res.json(db.prepare('SELECT * FROM divisions WHERE id=?').get(div.id));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Division name already exists' });
    throw e;
  }
});

app.patch('/api/divisions/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const upd = db.prepare('UPDATE divisions SET sort_order=? WHERE id=?');
  db.transaction(() => order.forEach((id, i) => upd.run(i + 1, id)))();
  res.json(db.prepare('SELECT * FROM divisions ORDER BY sort_order').all());
});

app.delete('/api/divisions/:id', (req, res) => {
  const div = db.prepare('SELECT * FROM divisions WHERE id=?').get(req.params.id);
  if (!div) return res.status(404).json({ error: 'Division not found' });
  const { reassign_to_id } = req.body;
  db.transaction(() => {
    db.prepare('UPDATE projects SET division_id=? WHERE division_id=?').run(reassign_to_id||null, div.id);
    db.prepare('DELETE FROM divisions WHERE id=?').run(div.id);
  })();
  res.json({ ok: true });
});

// ── Division Phase Templates ───────────────────────────────────────────────────

app.get('/api/divisions/:id/phase-template', (req, res) => {
  const div = db.prepare('SELECT id FROM divisions WHERE id = ?').get(req.params.id);
  if (!div) return res.status(404).json({ error: 'Division not found' });
  res.json(db.prepare('SELECT * FROM division_phase_templates WHERE division_id = ? ORDER BY sort_order').all(req.params.id));
});

app.put('/api/divisions/:id/phase-template', (req, res) => {
  const div = db.prepare('SELECT id FROM divisions WHERE id = ?').get(req.params.id);
  if (!div) return res.status(404).json({ error: 'Division not found' });
  const { phases } = req.body;
  if (!Array.isArray(phases)) return res.status(400).json({ error: 'phases must be an array' });
  db.transaction(() => {
    db.prepare('DELETE FROM division_phase_templates WHERE division_id = ?').run(req.params.id);
    phases.filter(p => p?.name?.trim()).forEach((p, i) => {
      db.prepare('INSERT INTO division_phase_templates (division_id, name, sort_order) VALUES (?,?,?)').run(req.params.id, p.name.trim(), i + 1);
    });
  })();
  res.json(db.prepare('SELECT * FROM division_phase_templates WHERE division_id = ? ORDER BY sort_order').all(req.params.id));
});

// ── Categories ────────────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all());
});

app.post('/api/categories', (req, res) => {
  const { name, icon = '📁', color = '#6366f1' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  let base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!base) return res.status(400).json({ error: 'name must contain alphanumeric characters' });
  let slug = base, n = 2;
  while (db.prepare('SELECT slug FROM categories WHERE slug=?').get(slug)) slug = `${base}-${n++}`;
  const maxOrd = db.prepare('SELECT MAX(sort_order) AS m FROM categories').get()?.m || 0;
  db.prepare('INSERT INTO categories (slug,name,icon,color,sort_order) VALUES (?,?,?,?,?)').run(slug, name.trim(), icon, color, maxOrd + 1);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE slug=?').get(slug));
});

app.patch('/api/categories/reorder', (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
  const upd = db.prepare('UPDATE categories SET sort_order=? WHERE slug=?');
  db.transaction(() => order.forEach((slug, i) => upd.run(i + 1, slug)))();
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
});

app.put('/api/categories/:slug', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE slug=?').get(req.params.slug);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const { name, icon, color, test_question } = req.body;
  db.prepare('UPDATE categories SET name=?,icon=?,color=?,test_question=? WHERE slug=?')
    .run(name?.trim() ?? cat.name, icon ?? cat.icon, color ?? cat.color,
         test_question !== undefined ? (test_question || null) : cat.test_question, cat.slug);
  res.json(db.prepare('SELECT * FROM categories WHERE slug=?').get(cat.slug));
});

app.post('/api/categories/:slug/merge', (req, res) => {
  const src = db.prepare('SELECT * FROM categories WHERE slug=?').get(req.params.slug);
  if (!src) return res.status(404).json({ error: 'Source category not found' });
  const { into } = req.body;
  if (!into) return res.status(400).json({ error: 'into is required' });
  const dst = db.prepare('SELECT * FROM categories WHERE slug=?').get(into);
  if (!dst) return res.status(404).json({ error: 'Target category not found' });
  if (src.slug === dst.slug) return res.status(400).json({ error: 'Cannot merge into itself' });
  db.transaction(() => {
    db.prepare('UPDATE tasks SET category=? WHERE category=?').run(dst.slug, src.slug);
    db.prepare('UPDATE template_tasks SET category=? WHERE category=?').run(dst.slug, src.slug);
    db.prepare('UPDATE category_blocks SET category=? WHERE category=?').run(dst.slug, src.slug);
    db.prepare('UPDATE project_links SET category=? WHERE category=?').run(dst.slug, src.slug);
    db.prepare('UPDATE notes SET category=? WHERE category=?').run(dst.slug, src.slug);
    db.prepare('DELETE FROM categories WHERE slug=?').run(src.slug);
  })();
  res.json({ ok: true, merged_into: dst });
});

app.delete('/api/categories/:slug', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE slug=?').get(req.params.slug);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const { reassign_to_slug } = req.body;
  const newSlug = reassign_to_slug || null;
  db.transaction(() => {
    db.prepare('UPDATE tasks SET category=? WHERE category=?').run(newSlug, cat.slug);
    db.prepare('UPDATE category_blocks SET category=? WHERE category=?').run(newSlug, cat.slug);
    db.prepare('UPDATE notes SET category=? WHERE category=?').run(newSlug, cat.slug);
    db.prepare('UPDATE project_links SET category=? WHERE category=?').run(newSlug, cat.slug);
    db.prepare('UPDATE template_tasks SET category=? WHERE category=?').run(newSlug, cat.slug);
    db.prepare('DELETE FROM categories WHERE slug=?').run(cat.slug);
  })();
  res.json({ ok: true });
});

// ── Project Notes ─────────────────────────────────────────────────────────────

app.get('/api/projects/:id/notes', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(db.prepare('SELECT * FROM project_notes WHERE project_id = ? ORDER BY date DESC, id DESC').all(req.params.id));
});

app.post('/api/projects/:id/notes', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { title, date, body, type = 'meeting-notes', phase, category, task_id } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!date?.trim())  return res.status(400).json({ error: 'Date is required' });
  const r = db.prepare('INSERT INTO project_notes (project_id, title, date, body, type, phase, category, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, title.trim(), date.trim(), body || null, type, phase || null, category || null, task_id || null);
  res.status(201).json(db.prepare('SELECT * FROM project_notes WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/project-notes/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM project_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const { title, date, body, type, phase, category, task_id } = req.body;
  db.prepare('UPDATE project_notes SET title = ?, date = ?, body = ?, type = ?, phase = ?, category = ?, task_id = ? WHERE id = ?')
    .run(title?.trim() ?? note.title, date?.trim() ?? note.date, body ?? note.body, type ?? note.type,
         phase !== undefined ? (phase || null) : note.phase, category !== undefined ? (category || null) : note.category,
         task_id !== undefined ? (task_id || null) : note.task_id, req.params.id);
  res.json(db.prepare('SELECT * FROM project_notes WHERE id = ?').get(req.params.id));
});

app.delete('/api/project-notes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM project_notes WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Note not found' });
  res.status(204).end();
});

// ── Unified Notes ─────────────────────────────────────────────────────────────

app.get('/api/notes/search', (req, res) => {
  const { q = '', type, project_id } = req.query;
  if (!q.trim()) return res.json([]);
  const like = `%${q.trim()}%`;
  let sql = `SELECT n.*, p.name AS project_name FROM notes n LEFT JOIN projects p ON p.id=n.project_id WHERE (n.title LIKE ? OR n.body LIKE ?)`;
  const params = [like, like];
  if (type)       { sql += ` AND n.type=?`;       params.push(type); }
  if (project_id) { sql += ` AND n.project_id=?`; params.push(Number(project_id)); }
  sql += ` ORDER BY n.note_date DESC, n.id DESC LIMIT 50`;
  res.json(db.prepare(sql).all(...params));
});

const NOTE_WITH_SHARES = `SELECT n.*,
  (SELECT COUNT(*) FROM note_shares s WHERE s.note_id=n.id AND s.revoked_at IS NULL
   AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))) AS active_share_count
FROM notes n`;

app.get('/api/notes', (req, res) => {
  const { project_id, task_id } = req.query;
  if (project_id) return res.json(db.prepare(`${NOTE_WITH_SHARES} WHERE n.project_id=? ORDER BY n.note_date DESC,n.id DESC`).all(Number(project_id)));
  if (task_id)    return res.json(db.prepare(`${NOTE_WITH_SHARES} WHERE n.task_id=? ORDER BY n.note_date DESC,n.id DESC`).all(Number(task_id)));
  res.status(400).json({ error: 'project_id or task_id required' });
});

app.post('/api/notes', (req, res) => {
  const { project_id, task_id, title, body, type='meeting-notes', phase, category, note_date, ai_summary_url } = req.body;
  if (!title?.trim())     return res.status(400).json({ error: 'title required' });
  if (!note_date?.trim()) return res.status(400).json({ error: 'note_date required' });
  const r = db.prepare(`INSERT INTO notes (project_id,task_id,title,body,type,phase,category,note_date,ai_summary_url) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(project_id||null, task_id||null, title.trim(), body||null, type, phase||null, category||null, note_date.trim(), ai_summary_url||null);
  res.status(201).json(db.prepare('SELECT * FROM notes WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/notes/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const { title, body, type, phase, category, note_date, task_id, project_id, ai_summary_url } = req.body;
  db.prepare(`UPDATE notes SET title=?,body=?,type=?,phase=?,category=?,note_date=?,task_id=?,project_id=?,ai_summary_url=?,updated_at=datetime('now') WHERE id=?`)
    .run(
      title?.trim()  ?? note.title,
      body  !== undefined ? (body||null)  : note.body,
      type  ?? note.type,
      phase !== undefined ? (phase||null) : note.phase,
      category !== undefined ? (category||null) : note.category,
      note_date?.trim() ?? note.note_date,
      task_id    !== undefined ? (task_id||null)    : note.task_id,
      project_id !== undefined ? (project_id||null) : note.project_id,
      ai_summary_url !== undefined ? (ai_summary_url||null) : note.ai_summary_url,
      note.id
    );
  res.json(db.prepare('SELECT * FROM notes WHERE id=?').get(note.id));
});

app.delete('/api/notes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Note not found' });
  res.json({ ok: true });
});

// ── Sprints ───────────────────────────────────────────────────────────────────

const withSprintTasks = (sprint) => ({
  ...sprint,
  task_ids: db.prepare('SELECT task_id FROM sprint_tasks WHERE sprint_id = ?').all(sprint.id).map(r => r.task_id),
});

app.get('/api/projects/:id/sprints', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const sprints = db.prepare('SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(sprints.map(withSprintTasks));
});

app.post('/api/projects/:id/sprints', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { name, start_date, end_date, status = 'upcoming' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  if (status === 'active') {
    db.prepare("UPDATE sprints SET status = 'parked' WHERE project_id = ? AND status = 'active'").run(req.params.id);
  }
  const r = db.prepare('INSERT INTO sprints (project_id, name, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, name.trim(), start_date || null, end_date || null, status);
  res.status(201).json(withSprintTasks(db.prepare('SELECT * FROM sprints WHERE id = ?').get(r.lastInsertRowid)));
});

app.put('/api/sprints/:id', (req, res) => {
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  const { name, start_date, end_date, status } = req.body;
  if (status === 'active' && sprint.status !== 'active') {
    db.prepare("UPDATE sprints SET status = 'parked' WHERE project_id = ? AND status = 'active' AND id != ?")
      .run(sprint.project_id, req.params.id);
  }
  db.prepare('UPDATE sprints SET name = ?, start_date = ?, end_date = ?, status = ? WHERE id = ?')
    .run(name?.trim() ?? sprint.name, start_date ?? sprint.start_date, end_date ?? sprint.end_date, status ?? sprint.status, req.params.id);
  res.json(withSprintTasks(db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id)));
});

app.delete('/api/sprints/:id', (req, res) => {
  const result = db.prepare('DELETE FROM sprints WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Sprint not found' });
  res.status(204).end();
});

app.post('/api/sprints/:id/tasks', (req, res) => {
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ error: 'task_id is required' });
  try {
    db.prepare('INSERT INTO sprint_tasks (sprint_id, task_id) VALUES (?, ?)').run(req.params.id, task_id);
  } catch(_) {}
  res.status(201).json(withSprintTasks(db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id)));
});

app.delete('/api/sprints/:id/tasks/:taskId', (req, res) => {
  db.prepare('DELETE FROM sprint_tasks WHERE sprint_id = ? AND task_id = ?').run(req.params.id, req.params.taskId);
  res.status(204).end();
});

// ── Phases ────────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/phases', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(db.prepare('SELECT * FROM phases WHERE project_id = ? ORDER BY sort_order, id').all(req.params.id));
});

app.post('/api/projects/:id/phases', (req, res) => {
  const proj = db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { name, status = 'not-started' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const maxOrd = db.prepare('SELECT MAX(sort_order) AS m FROM phases WHERE project_id = ?').get(req.params.id)?.m || 0;
  if (status === 'active') {
    db.prepare("UPDATE phases SET status='not-started' WHERE project_id=? AND status='active'").run(req.params.id);
  }
  const r = db.prepare('INSERT INTO phases (project_id, name, sort_order, status) VALUES (?,?,?,?)').run(req.params.id, name.trim(), maxOrd + 1, status);
  res.status(201).json(db.prepare('SELECT * FROM phases WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/phases/:id', (req, res) => {
  const phase = db.prepare('SELECT * FROM phases WHERE id = ?').get(req.params.id);
  if (!phase) return res.status(404).json({ error: 'Phase not found' });
  const { name, status, sort_order } = req.body;
  if (status === 'active' && phase.status !== 'active') {
    db.prepare("UPDATE phases SET status='not-started' WHERE project_id=? AND status='active' AND id!=?").run(phase.project_id, req.params.id);
  }
  db.prepare('UPDATE phases SET name=?, status=?, sort_order=? WHERE id=?').run(
    name?.trim() ?? phase.name, status ?? phase.status, sort_order ?? phase.sort_order, req.params.id
  );
  res.json(db.prepare('SELECT * FROM phases WHERE id = ?').get(req.params.id));
});

app.patch('/api/phases/:id', (req, res) => {
  const phase = db.prepare('SELECT * FROM phases WHERE id = ?').get(req.params.id);
  if (!phase) return res.status(404).json({ error: 'Phase not found' });
  const { status } = req.body;
  if (status === 'active') {
    db.prepare("UPDATE phases SET status='not-started' WHERE project_id=? AND status='active' AND id!=?").run(phase.project_id, req.params.id);
  }
  db.prepare('UPDATE phases SET status=? WHERE id=?').run(status ?? phase.status, req.params.id);
  res.json(db.prepare('SELECT * FROM phases WHERE id = ?').get(req.params.id));
});

app.delete('/api/phases/:id', (req, res) => {
  const result = db.prepare('DELETE FROM phases WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Phase not found' });
  res.status(204).end();
});

app.post('/api/projects/:id/apply-phase-template', (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  if (!proj.division_id) return res.status(400).json({ error: 'Project has no division' });
  const tpls = db.prepare('SELECT * FROM division_phase_templates WHERE division_id = ? ORDER BY sort_order').all(proj.division_id);
  if (!tpls.length) return res.status(400).json({ error: 'No phase template for this division' });
  const maxOrd = db.prepare('SELECT MAX(sort_order) AS m FROM phases WHERE project_id = ?').get(proj.id)?.m || 0;
  const ins = db.prepare('INSERT INTO phases (project_id, name, sort_order, status) VALUES (?,?,?,?)');
  db.transaction(() => {
    tpls.forEach((t, i) => ins.run(proj.id, t.name, maxOrd + i + 1, 'not-started'));
  })();
  res.json(db.prepare('SELECT * FROM phases WHERE project_id = ? ORDER BY sort_order').all(proj.id));
});

// ── Focus Lists ───────────────────────────────────────────────────────────────

const focusListStats = (id) => {
  const { task_count } = db.prepare('SELECT COUNT(*) AS task_count FROM task_focus_lists WHERE focus_list_id = ?').get(id);
  const { estimated_minutes } = db.prepare(`
    SELECT COALESCE(SUM(t.estimated_minutes), 0) AS estimated_minutes
    FROM tasks t JOIN task_focus_lists tfl ON t.id = tfl.task_id
    WHERE tfl.focus_list_id = ?`).get(id);
  return { task_count, estimated_minutes };
};

app.get('/api/focus-lists', (req, res) => {
  const lists = db.prepare('SELECT * FROM focus_lists ORDER BY name ASC').all();
  res.json(lists.map(fl => ({ ...fl, ...focusListStats(fl.id) })));
});

app.post('/api/focus-lists', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const r = db.prepare('INSERT INTO focus_lists (name) VALUES (?)').run(name.trim());
    const fl = db.prepare('SELECT * FROM focus_lists WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ ...fl, task_count: 0, estimated_minutes: 0 });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Focus list name already exists' });
    throw e;
  }
});

app.patch('/api/focus-lists/:id', (req, res) => {
  const fl = db.prepare('SELECT * FROM focus_lists WHERE id = ?').get(req.params.id);
  if (!fl) return res.status(404).json({ error: 'Focus list not found' });
  const name      = req.body.name      !== undefined ? req.body.name.trim()      : fl.name;
  const max_tasks = req.body.max_tasks !== undefined ? Number(req.body.max_tasks) : fl.max_tasks;
  const max_hours = req.body.max_hours !== undefined ? Number(req.body.max_hours) : fl.max_hours;
  if (!name)         return res.status(400).json({ error: 'Name is required' });
  if (max_tasks < 1) return res.status(400).json({ error: 'max_tasks must be at least 1' });
  if (max_hours < 1) return res.status(400).json({ error: 'max_hours must be at least 1' });
  try {
    db.prepare('UPDATE focus_lists SET name = ?, max_tasks = ?, max_hours = ? WHERE id = ?').run(name, max_tasks, max_hours, req.params.id);
    const updated = db.prepare('SELECT * FROM focus_lists WHERE id = ?').get(req.params.id);
    res.json({ ...updated, ...focusListStats(req.params.id) });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Focus list name already exists' });
    throw e;
  }
});

app.delete('/api/focus-lists/:id', (req, res) => {
  const result = db.prepare('DELETE FROM focus_lists WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Focus list not found' });
  res.status(204).end();
});

app.post('/api/tasks/:taskId/focus-lists/:focusListId', (req, res) => {
  const task = db.prepare('SELECT id, estimated_minutes FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const fl = db.prepare('SELECT * FROM focus_lists WHERE id = ?').get(req.params.focusListId);
  if (!fl) return res.status(404).json({ error: 'Focus list not found' });

  const already = db.prepare('SELECT 1 FROM task_focus_lists WHERE task_id = ? AND focus_list_id = ?').get(req.params.taskId, req.params.focusListId);
  if (already) return res.status(409).json({ error: 'Task is already in this focus list' });

  const { cnt } = db.prepare('SELECT COUNT(*) AS cnt FROM task_focus_lists WHERE focus_list_id = ?').get(req.params.focusListId);
  if (cnt >= fl.max_tasks) return res.status(400).json({ error: `Focus list is full — max ${fl.max_tasks} tasks. Remove one or raise the limit first.` });

  const { total } = db.prepare(`SELECT COALESCE(SUM(t.estimated_minutes), 0) AS total
    FROM tasks t JOIN task_focus_lists tfl ON t.id = tfl.task_id
    WHERE tfl.focus_list_id = ?`).get(req.params.focusListId);
  if ((total || 0) + (task.estimated_minutes || 0) > fl.max_hours * 60) {
    return res.status(400).json({ error: `Adding this task would put the focus list over its ${fl.max_hours} hour cap.` });
  }

  db.prepare('INSERT INTO task_focus_lists (task_id, focus_list_id) VALUES (?, ?)').run(req.params.taskId, req.params.focusListId);
  res.status(201).json({ task_id: Number(req.params.taskId), focus_list_id: Number(req.params.focusListId) });
});

app.delete('/api/tasks/:taskId/focus-lists/:focusListId', (req, res) => {
  const result = db.prepare('DELETE FROM task_focus_lists WHERE task_id = ? AND focus_list_id = ?').run(req.params.taskId, req.params.focusListId);
  if (!result.changes) return res.status(404).json({ error: 'Task is not in this focus list' });
  res.status(204).end();
});

// ── Weekly Sprint ─────────────────────────────────────────────────────────────

function monStr(d) {
  d = d ? new Date(d) : new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

app.get('/api/sprint/week', (req, res) => {
  const week = req.query.week || monStr();
  const fl = db.prepare('SELECT * FROM focus_lists WHERE sprint_week = ?').get(week);
  if (!fl) return res.json(null);
  const tasks = db.prepare('SELECT t.* FROM tasks t JOIN task_focus_lists tfl ON t.id=tfl.task_id WHERE tfl.focus_list_id=? ORDER BY t.due_date,t.id').all(fl.id);
  res.json({ ...fl, ...focusListStats(fl.id), tasks });
});

app.post('/api/sprint/week', (req, res) => {
  const week = req.body.week || monStr();
  let fl = db.prepare('SELECT * FROM focus_lists WHERE sprint_week = ?').get(week);
  if (!fl) {
    const name = `Week of ${week}`;
    try {
      const r = db.prepare('INSERT INTO focus_lists (name, sprint_week) VALUES (?, ?)').run(name, week);
      fl = db.prepare('SELECT * FROM focus_lists WHERE id = ?').get(r.lastInsertRowid);
    } catch (e) {
      if (!e.message.includes('UNIQUE')) throw e;
      const r = db.prepare('INSERT INTO focus_lists (name, sprint_week) VALUES (?, ?)').run(`${name} (2)`, week);
      fl = db.prepare('SELECT * FROM focus_lists WHERE id = ?').get(r.lastInsertRowid);
    }
  }
  const tasks = db.prepare('SELECT t.* FROM tasks t JOIN task_focus_lists tfl ON t.id=tfl.task_id WHERE tfl.focus_list_id=? ORDER BY t.due_date,t.id').all(fl.id);
  res.json({ ...fl, ...focusListStats(fl.id), tasks });
});

app.post('/api/sprint/week/close', (req, res) => {
  const week = req.body.week || monStr();
  const fl = db.prepare('SELECT * FROM focus_lists WHERE sprint_week = ?').get(week);
  if (!fl) return res.status(404).json({ error: 'No sprint for this week' });
  const { rolls = [], returns = [] } = req.body;
  const d = new Date(week + 'T00:00:00');
  d.setDate(d.getDate() + 7);
  const nextWeek = d.toISOString().slice(0, 10);
  db.transaction(() => {
    if (rolls.length) {
      let nextFl = db.prepare('SELECT * FROM focus_lists WHERE sprint_week = ?').get(nextWeek);
      if (!nextFl) {
        const r = db.prepare('INSERT INTO focus_lists (name, sprint_week) VALUES (?, ?)').run(`Week of ${nextWeek}`, nextWeek);
        nextFl = db.prepare('SELECT * FROM focus_lists WHERE id = ?').get(r.lastInsertRowid);
      }
      rolls.forEach(tid => {
        try { db.prepare('INSERT INTO task_focus_lists (task_id, focus_list_id) VALUES (?,?)').run(tid, nextFl.id); } catch(_) {}
        db.prepare('DELETE FROM task_focus_lists WHERE task_id=? AND focus_list_id=?').run(tid, fl.id);
      });
    }
    returns.forEach(tid => {
      db.prepare('DELETE FROM task_focus_lists WHERE task_id=? AND focus_list_id=?').run(tid, fl.id);
    });
  })();
  res.json({ ok: true, nextWeek });
});

// ── Settings ─────────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const s = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => { s[r.key] = r.value; });
  res.json(s);
});

app.patch('/api/settings', (req, res) => {
  const allowed = ['daily_capacity_minutes','day_start_hour','day_end_hour','gcal_task_calendar_id','user_timezone','gcal_theme_mappings','week_start_day','category_capacity_hours'];
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  Object.entries(req.body).filter(([k]) => allowed.includes(k)).forEach(([k,v]) => stmt.run(k, String(v)));
  const s = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => { s[r.key] = r.value; });
  res.json(s);
});

// ── GCal utility routes ───────────────────────────────────────────────────────

app.get('/api/gcal/calendars', async (req, res) => {
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id=1').get();
  if (!auth) return res.json([]);
  try {
    const token = await googleAccessToken(auth.refresh_token);
    const data  = await httpsReq({ hostname:'www.googleapis.com', path:'/calendar/v3/users/me/calendarList', method:'GET', headers:{ Authorization:'Bearer '+token } });
    if (data?.error) return res.json([]);
    res.json((data.items || []).map(c => ({ id: c.id, name: c.summary, primary: c.primary || false })));
  } catch(e) { console.error('List calendars error:', e.message); res.json([]); }
});

// Link a GCal event to a task — creates a gcal_linked=1 block
app.post('/api/gcal/link', (req, res) => {
  const { task_id, gcal_event_id, date, start_time, duration_minutes } = req.body;
  if (!task_id || !gcal_event_id || !date || !start_time)
    return res.status(400).json({ error: 'task_id, gcal_event_id, date, start_time required' });
  if (!db.prepare('SELECT id FROM tasks WHERE id=?').get(Number(task_id)))
    return res.status(404).json({ error: 'Task not found' });
  const existing = db.prepare('SELECT id FROM time_blocks WHERE gcal_event_id=?').get(gcal_event_id);
  if (existing) return res.status(409).json({ error: 'Already linked', block_id: existing.id });
  const r = db.prepare(
    'INSERT INTO time_blocks (task_id, date, start_time, duration_minutes, gcal_event_id, gcal_linked) VALUES (?,?,?,?,?,1)'
  ).run(Number(task_id), date, start_time, Number(duration_minutes || 60), gcal_event_id);
  res.status(201).json(blockWithTask(r.lastInsertRowid));
});

// Unlink — removes the block but does NOT delete the GCal event
app.delete('/api/gcal/link/:id', (req, res) => {
  const block = db.prepare('SELECT id, gcal_linked FROM time_blocks WHERE id=?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Block not found' });
  if (!block.gcal_linked) return res.status(400).json({ error: 'Not a linked block' });
  db.prepare('DELETE FROM time_blocks WHERE id=?').run(req.params.id);
  res.status(204).end();
});

// Returns {[gcal_event_id]: total_minutes} for all events that have logged time
app.get('/api/gcal/event-logs', (req, res) => {
  const rows = db.prepare(
    'SELECT gcal_event_id, SUM(minutes) AS total FROM time_logs WHERE gcal_event_id IS NOT NULL GROUP BY gcal_event_id'
  ).all();
  const result = {};
  rows.forEach(r => { result[r.gcal_event_id] = r.total; });
  res.json(result);
});

// Find or create "General – <block_name>" task in the "General" project
app.post('/api/gcal/ensure-general-task', (req, res) => {
  const { block_name, category } = req.body;
  if (!block_name) return res.status(400).json({ error: 'block_name required' });
  const title = `General – ${block_name}`;
  db.transaction(() => {
    if (!db.prepare('SELECT id FROM projects WHERE name=?').get('General')) {
      db.prepare('INSERT OR IGNORE INTO projects (name) VALUES (?)').run('General');
    }
  })();
  let task = db.prepare(
    "SELECT * FROM tasks WHERE title=? AND project='General' AND status!='complete' LIMIT 1"
  ).get(title);
  if (!task) {
    const r = db.prepare(
      "INSERT INTO tasks (title, status, priority, project, category, is_inbox) VALUES (?,?,?,?,?,0)"
    ).run(title, 'active', 'medium', 'General', category || null);
    task = db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid);
  }
  res.json(task);
});

// Batch-log time from a Google Calendar event to one or more tasks
app.post('/api/gcal/log-batch', (req, res) => {
  const { gcal_event_id, entries } = req.body;
  if (!gcal_event_id || !Array.isArray(entries) || !entries.length)
    return res.status(400).json({ error: 'gcal_event_id and entries[] required' });
  const logs = db.transaction(() => {
    return entries.map(({ task_id, minutes, description }) => {
      if (!task_id || !minutes || Number(minutes) <= 0) return null;
      if (!db.prepare('SELECT id FROM tasks WHERE id=?').get(Number(task_id))) return null;
      const r = db.prepare(
        'INSERT INTO time_logs (task_id, minutes, description, gcal_event_id) VALUES (?,?,?,?)'
      ).run(Number(task_id), Number(minutes), description || null, gcal_event_id);
      syncActualMinutes(Number(task_id));
      return db.prepare('SELECT * FROM time_logs WHERE id=?').get(r.lastInsertRowid);
    }).filter(Boolean);
  })();
  res.status(201).json({ logged: logs, total_minutes: logs.reduce((s, l) => s + l.minutes, 0) });
});

app.post('/api/time-blocks/backfill', async (req, res) => {
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id=1').get();
  if (!auth) return res.status(400).json({ error: 'Google Calendar not connected' });
  const today  = new Date().toISOString().slice(0, 10);
  const blocks = db.prepare(`
    SELECT tb.*, t.title AS task_title, t.category AS task_category
    FROM time_blocks tb JOIN tasks t ON tb.task_id = t.id
    WHERE tb.date >= ? AND tb.gcal_event_id IS NULL ORDER BY tb.date, tb.start_time
  `).all(today);
  let synced = 0, failed = 0, scopeError = false;
  for (const b of blocks) {
    const result = await syncTaskBlockToGoogle(b, null);
    if (result && typeof result === 'object' && result.scopeError) { scopeError = true; failed++; break; }
    if (result) { db.prepare('UPDATE time_blocks SET gcal_event_id=? WHERE id=?').run(result, b.id); synced++; }
    else failed++;
  }
  res.json({ total: blocks.length, synced, failed, scopeError });
});

// ── Time Blocks ───────────────────────────────────────────────────────────────

const blockWithTask = (id) => db.prepare(`
  SELECT tb.*, t.title AS task_title, t.category AS task_category,
         t.priority AS task_priority, t.status AS task_status
  FROM time_blocks tb JOIN tasks t ON tb.task_id = t.id WHERE tb.id = ?
`).get(id);

app.get('/api/time-blocks', (req, res) => {
  const { date, from, to, task_id } = req.query;
  const sel = `SELECT tb.*, t.title AS task_title, t.category AS task_category,
               t.priority AS task_priority, t.status AS task_status
               FROM time_blocks tb JOIN tasks t ON tb.task_id = t.id`;
  if (task_id) {
    return res.json(db.prepare(sel + ' WHERE tb.task_id = ? ORDER BY tb.date ASC, tb.start_time ASC').all(Number(task_id)));
  }
  if (from && to) {
    return res.json(db.prepare(sel + ' WHERE tb.date >= ? AND tb.date <= ? ORDER BY tb.date ASC, tb.start_time ASC').all(from, to));
  }
  if (!date) return res.status(400).json({ error: 'date or from/to required' });
  res.json(db.prepare(sel + ' WHERE tb.date = ? ORDER BY tb.start_time ASC').all(date));
});

app.post('/api/time-blocks', async (req, res) => {
  const { task_id, date, start_time, duration_minutes = 60 } = req.body;
  if (!task_id || !date || !start_time)
    return res.status(400).json({ error: 'task_id, date, and start_time are required' });
  if (new Date(date + 'T00:00:00').getDay() === 0)
    return res.status(400).json({ error: 'No time blocks on Sundays' });
  if (!db.prepare('SELECT id FROM tasks WHERE id = ?').get(task_id))
    return res.status(404).json({ error: 'Task not found' });
  const r = db.prepare(
    'INSERT INTO time_blocks (task_id, date, start_time, duration_minutes) VALUES (?,?,?,?)'
  ).run(Number(task_id), date, start_time, Number(duration_minutes));
  let block = blockWithTask(r.lastInsertRowid);
  const eventResult = await syncTaskBlockToGoogle(block, null);
  if (eventResult && typeof eventResult === 'string') {
    db.prepare('UPDATE time_blocks SET gcal_event_id=? WHERE id=?').run(eventResult, block.id);
    block = blockWithTask(block.id);
  }
  res.status(201).json(block);
});

app.patch('/api/time-blocks/:id', async (req, res) => {
  const block = db.prepare('SELECT * FROM time_blocks WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Time block not found' });
  const date             = req.body.date             ?? block.date;
  const start_time       = req.body.start_time       ?? block.start_time;
  const duration_minutes = req.body.duration_minutes !== undefined
    ? Number(req.body.duration_minutes) : block.duration_minutes;
  if (new Date(date + 'T00:00:00').getDay() === 0)
    return res.status(400).json({ error: 'No time blocks on Sundays' });
  db.prepare('UPDATE time_blocks SET date=?, start_time=?, duration_minutes=? WHERE id=?')
    .run(date, start_time, duration_minutes, req.params.id);
  const updated = blockWithTask(req.params.id);
  const eventResult = await syncTaskBlockToGoogle(updated, updated.gcal_event_id);
  if (eventResult && typeof eventResult === 'string' && eventResult !== updated.gcal_event_id) {
    db.prepare('UPDATE time_blocks SET gcal_event_id=? WHERE id=?').run(eventResult, updated.id);
    return res.json(blockWithTask(req.params.id));
  }
  res.json(updated);
});

app.delete('/api/time-blocks/:id', (req, res) => {
  const block = db.prepare('SELECT gcal_event_id, gcal_linked FROM time_blocks WHERE id=?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Time block not found' });
  db.prepare('DELETE FROM time_blocks WHERE id=?').run(req.params.id);
  if (block.gcal_event_id && !block.gcal_linked) deleteGoogleTaskBlockEvent(block.gcal_event_id);
  res.status(204).end();
});

app.post('/api/time-blocks/:id/log', (req, res) => {
  const block = db.prepare('SELECT * FROM time_blocks WHERE id=?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Time block not found' });
  if (block.logged) return res.status(409).json({ error: 'Already logged' });
  const log = db.transaction(() => {
    const r = db.prepare('INSERT INTO time_logs (task_id, minutes, description) VALUES (?,?,?)')
      .run(block.task_id, block.duration_minutes, `Time block on ${block.date}`);
    syncActualMinutes(block.task_id);
    db.prepare('UPDATE time_blocks SET logged=1 WHERE id=?').run(block.id);
    return db.prepare('SELECT * FROM time_logs WHERE id=?').get(r.lastInsertRowid);
  })();
  res.status(201).json({ time_log: log });
});

// ── Category Blocks ───────────────────────────────────────────────────────────

app.get('/api/category-blocks', (req, res) => {
  const { date, from, to } = req.query;
  if (from && to) return res.json(db.prepare('SELECT * FROM category_blocks WHERE date >= ? AND date <= ? ORDER BY date, start_time').all(from, to));
  if (date)       return res.json(db.prepare('SELECT * FROM category_blocks WHERE date = ? ORDER BY start_time').all(date));
  res.status(400).json({ error: 'date or from/to required' });
});

app.post('/api/category-blocks', async (req, res) => {
  const { label, category, date, start_time, duration_minutes = 60 } = req.body;
  if (!label || !category || !date || !start_time) return res.status(400).json({ error: 'label, category, date, start_time required' });
  const r = db.prepare('INSERT INTO category_blocks (label, category, date, start_time, duration_minutes) VALUES (?,?,?,?,?)').run(label, category, date, start_time, Number(duration_minutes));
  const created = db.prepare('SELECT * FROM category_blocks WHERE id = ?').get(r.lastInsertRowid);
  const eventId = await syncCatBlockToGoogle(created, null);
  if (eventId) {
    db.prepare('UPDATE category_blocks SET google_event_id = ? WHERE id = ?').run(eventId, created.id);
    created.google_event_id = eventId;
  }
  res.status(201).json(created);
});

app.patch('/api/category-blocks/:id', async (req, res) => {
  const cb = db.prepare('SELECT * FROM category_blocks WHERE id = ?').get(req.params.id);
  if (!cb) return res.status(404).json({ error: 'Not found' });
  const label            = req.body.label            ?? cb.label;
  const category         = req.body.category         ?? cb.category;
  const date             = req.body.date             ?? cb.date;
  const start_time       = req.body.start_time       ?? cb.start_time;
  const duration_minutes = req.body.duration_minutes !== undefined ? Number(req.body.duration_minutes) : cb.duration_minutes;
  db.prepare('UPDATE category_blocks SET label=?,category=?,date=?,start_time=?,duration_minutes=? WHERE id=?').run(label, category, date, start_time, duration_minutes, req.params.id);
  await syncCatBlockToGoogle({ label, category, date, start_time, duration_minutes }, cb.google_event_id);
  res.json(db.prepare('SELECT * FROM category_blocks WHERE id = ?').get(req.params.id));
});

app.delete('/api/category-blocks/:id', async (req, res) => {
  const cb = db.prepare('SELECT google_event_id FROM category_blocks WHERE id = ?').get(req.params.id);
  if (!cb) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM category_blocks WHERE id=?').run(req.params.id);
  if (cb.google_event_id) deleteGoogleCatBlockEvent(cb.google_event_id);
  res.status(204).end();
});

// ── Templates ─────────────────────────────────────────────────────────────────

app.get('/api/templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM templates ORDER BY name ASC').all();
  res.json(templates.map(t => ({
    ...t,
    tasks: db.prepare('SELECT * FROM template_tasks WHERE template_id = ?').all(t.id)
  })));
});

app.post('/api/templates', (req, res) => {
  const { name, tasks = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const tmpl = db.transaction(() => {
      const r = db.prepare('INSERT INTO templates (name) VALUES (?)').run(name.trim());
      const id = r.lastInsertRowid;
      tasks.forEach(t => {
        db.prepare(`
          INSERT INTO template_tasks (template_id, title, category, priority, estimated_minutes)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, t.title, t.category || null, t.priority || 'medium', t.estimated_minutes || null);
      });
      return {
        ...db.prepare('SELECT * FROM templates WHERE id = ?').get(id),
        tasks: db.prepare('SELECT * FROM template_tasks WHERE template_id = ?').all(id)
      };
    })();
    res.status(201).json(tmpl);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Template name already exists' });
    throw e;
  }
});

app.delete('/api/templates/:id', (req, res) => {
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Template not found' });
  res.status(204).end();
});

app.post('/api/templates/:id/apply', (req, res) => {
  const template = db.prepare('SELECT id FROM templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  const { project } = req.body;
  if (!project?.trim()) return res.status(400).json({ error: 'Project name is required' });

  const templateTasks = db.prepare('SELECT * FROM template_tasks WHERE template_id = ?').all(req.params.id);
  const created = db.transaction(() =>
    templateTasks.map(tt => {
      const r = db.prepare(`
        INSERT INTO tasks (title, priority, category, project, status, estimated_minutes, is_inbox)
        VALUES (?, ?, ?, ?, 'new', ?, 0)
      `).run(tt.title, tt.priority, tt.category || null, project.trim(), tt.estimated_minutes || null);
      return db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid);
    })
  )();

  res.status(201).json(created);
});

// ── Google Calendar ───────────────────────────────────────────────────────────

function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (!data) { resolve(null); return; }
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function toRFC3339Local(d) {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const h  = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const oh  = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const om  = String(Math.abs(off) % 60).padStart(2, '0');
  return `${y}-${mo}-${dy}T${h}:${mi}:00${off >= 0 ? '+' : '-'}${oh}:${om}`;
}

async function syncCatBlockToGoogle(cb, existingEventId) {
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
  if (!auth) return null;
  try {
    const token   = await googleAccessToken(auth.refresh_token);
    const startD  = new Date(`${cb.date}T${cb.start_time}:00`);
    const endD    = new Date(startD.getTime() + Number(cb.duration_minutes) * 60000);
    const body    = JSON.stringify({
      summary:      `Busy — ${cb.label}`,
      start:        { dateTime: toRFC3339Local(startD) },
      end:          { dateTime: toRFC3339Local(endD) },
      transparency: 'opaque'
    });
    const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    let data;
    if (existingEventId) {
      data = await httpsReq({ hostname: 'www.googleapis.com', path: `/calendar/v3/calendars/primary/events/${existingEventId}`, method: 'PUT', headers }, body);
    } else {
      data = await httpsReq({ hostname: 'www.googleapis.com', path: '/calendar/v3/calendars/primary/events', method: 'POST', headers }, body);
    }
    if (data?.error) throw new Error(data.error.message);
    return data?.id || null;
  } catch(e) {
    console.error('Google Calendar cat-block sync error:', e.message);
    return null;
  }
}

async function deleteGoogleCatBlockEvent(eventId) {
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
  if (!auth || !eventId) return;
  try {
    const token = await googleAccessToken(auth.refresh_token);
    await httpsReq({ hostname: 'www.googleapis.com', path: `/calendar/v3/calendars/primary/events/${eventId}`, method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  } catch(e) {
    console.error('Google Calendar cat-block delete error:', e.message);
  }
}

// ── Task block GCal sync ──────────────────────────────────────────────────────

async function getTaskCalendarId(token) {
  const setting = db.prepare("SELECT value FROM settings WHERE key='gcal_task_calendar_id'").get();
  if (setting?.value) return setting.value;
  try {
    const cals = await httpsReq({ hostname:'www.googleapis.com', path:'/calendar/v3/users/me/calendarList', method:'GET', headers:{ Authorization:'Bearer '+token } });
    if (cals?.error) return 'primary';
    const existing = (cals.items || []).find(c => c.summary === 'TSP Time Blocks');
    if (existing) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('gcal_task_calendar_id',?)").run(existing.id);
      return existing.id;
    }
    const body = JSON.stringify({ summary: 'TSP Time Blocks' });
    const created = await httpsReq({ hostname:'www.googleapis.com', path:'/calendar/v3/calendars', method:'POST',
      headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, body);
    if (created?.id) {
      db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('gcal_task_calendar_id',?)").run(created.id);
      return created.id;
    }
  } catch(e) { console.error('getTaskCalendarId error:', e.message); }
  return 'primary';
}

async function syncTaskBlockToGoogle(block, existingEventId) {
  if (block.gcal_linked) return null; // owned by Google, never push back
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
  if (!auth) return null;
  try {
    const token  = await googleAccessToken(auth.refresh_token);
    const calId  = await getTaskCalendarId(token);
    const task   = db.prepare('SELECT title, category, project, due_date FROM tasks WHERE id=?').get(block.task_id);
    if (!task) return null;
    const tz = (db.prepare("SELECT value FROM settings WHERE key='user_timezone'").get())?.value || 'America/New_York';
    const startDtStr = `${block.date}T${block.start_time}:00`;
    const startMs    = new Date(startDtStr).getTime();
    const endMs      = startMs + Number(block.duration_minutes) * 60000;
    const endD       = new Date(endMs);
    const endDateStr = `${endD.getFullYear()}-${String(endD.getMonth()+1).padStart(2,'0')}-${String(endD.getDate()).padStart(2,'0')}`;
    const endTimeStr = `${String(endD.getHours()).padStart(2,'0')}:${String(endD.getMinutes()).padStart(2,'0')}:00`;
    const descParts = [];
    if (task.project)  descParts.push(`Project: ${task.project}`);
    if (task.category) descParts.push(`Category: ${task.category}`);
    if (task.due_date) descParts.push(`Due: ${task.due_date}`);
    descParts.push(`${APP_BASE_URL}/app.html?task=${block.task_id}`);
    const body = JSON.stringify({
      summary:      `🎯 ${task.title}`,
      description:  descParts.join('\n'),
      start:        { dateTime: startDtStr, timeZone: tz },
      end:          { dateTime: `${endDateStr}T${endTimeStr}`, timeZone: tz },
      transparency: 'opaque'
    });
    const headers = { Authorization:'Bearer '+token, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) };
    const calEnc = encodeURIComponent(calId);
    let data;
    if (existingEventId) {
      data = await httpsReq({ hostname:'www.googleapis.com', path:`/calendar/v3/calendars/${calEnc}/events/${existingEventId}`, method:'PUT', headers }, body);
    } else {
      data = await httpsReq({ hostname:'www.googleapis.com', path:`/calendar/v3/calendars/${calEnc}/events`, method:'POST', headers }, body);
    }
    if (data?.error) {
      if (data.error.code === 401 || data.error.code === 403) return { scopeError: true };
      throw new Error(data.error.message);
    }
    return data?.id || null;
  } catch(e) {
    console.error('Google task-block sync error:', e.message);
    return null;
  }
}

async function deleteGoogleTaskBlockEvent(eventId) {
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
  if (!auth || !eventId) return;
  try {
    const token  = await googleAccessToken(auth.refresh_token);
    const calId  = (db.prepare("SELECT value FROM settings WHERE key='gcal_task_calendar_id'").get())?.value || 'primary';
    const calEnc = encodeURIComponent(calId);
    await httpsReq({ hostname:'www.googleapis.com', path:`/calendar/v3/calendars/${calEnc}/events/${eventId}`, method:'DELETE', headers:{ Authorization:'Bearer '+token } });
  } catch(e) { console.error('Google task-block delete error:', e.message); }
}

async function googleAccessToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type:    'refresh_token'
  }).toString();
  const data = await httpsReq({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (!data.access_token) throw new Error(data.error_description || 'Failed to get access token');
  return data.access_token;
}

const GOOGLE_REDIRECT_URI = 'https://tsp-task-manager-production.up.railway.app/api/auth/google/callback';

app.get('/api/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email',
    access_type:   'offline',
    prompt:        'consent'
  });
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?google_error=' + encodeURIComponent(error || 'no_code'));
  try {
    const body = new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code'
    }).toString();
    const data = await httpsReq({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    if (!data.refresh_token) return res.redirect('/?google_error=no_refresh_token');
    db.prepare('DELETE FROM google_auth').run();
    db.prepare('INSERT INTO google_auth (id, refresh_token) VALUES (1, ?)').run(data.refresh_token);
    res.redirect('/?google_connected=1');
  } catch(e) {
    console.error('Google OAuth callback error:', e.message);
    res.redirect('/?google_error=callback_failed');
  }
});

app.get('/api/auth/google/status', async (req, res) => {
  const row = db.prepare('SELECT refresh_token, connected_at FROM google_auth WHERE id = 1').get();
  if (!row) return res.json({ connected: false, connected_at: null, email: null, write_scope: false, gmail_scope: false });
  try {
    const token = await googleAccessToken(row.refresh_token);
    const info = await httpsReq({ hostname:'www.googleapis.com', path:`/oauth2/v1/tokeninfo?access_token=${token}`, method:'GET', headers:{} });
    const grantedScopes = info?.scope || '';
    const writeScope = grantedScopes.includes('auth/calendar') || grantedScopes.includes('auth/calendar.events');
    const gmailScope  = grantedScopes.includes('auth/gmail.modify');
    const email = info?.email || null;
    res.json({ connected: true, connected_at: row.connected_at, email, write_scope: writeScope, gmail_scope: gmailScope });
  } catch(e) {
    res.json({ connected: true, connected_at: row.connected_at, email: null, write_scope: false, gmail_scope: false });
  }
});

app.delete('/api/auth/google', (req, res) => {
  db.prepare('DELETE FROM google_auth').run();
  // Clear cached Gmail label IDs so they're re-fetched after reconnect
  ['gmail_label_to_task_id','gmail_label_tasked_id'].forEach(k =>
    db.prepare('DELETE FROM settings WHERE key=?').run(k));
  res.status(204).end();
});

app.post('/api/repair/timezone', async (req, res) => {
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
  if (!auth) return res.json({ fixed: 0, skipped: 0, error: 'not_connected' });
  try {
    const today  = new Date().toISOString().slice(0, 10);
    const blocks = db.prepare('SELECT * FROM time_blocks WHERE gcal_event_id IS NOT NULL AND date >= ?').all(today);
    let fixed = 0, skipped = 0;
    for (const block of blocks) {
      const result = await syncTaskBlockToGoogle(block, block.gcal_event_id);
      if (result && !result.scopeError) fixed++;
      else skipped++;
    }
    res.json({ fixed, skipped, total: blocks.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/calendar/google-events', async (req, res) => {
  const { start, end, timeMin: tMin, timeMax: tMax } = req.query;
  // Accept either full RFC-3339 timestamps (timezone-correct) or bare date strings (legacy fallback)
  const resolvedMin = tMin || (start && start + 'T00:00:00Z');
  const resolvedMax = tMax || (end   && end   + 'T23:59:59Z');
  if (!resolvedMin || !resolvedMax) return res.status(400).json({ error: 'time range required' });
  const row = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
  if (!row) return res.json([]);
  try {
    const token = await googleAccessToken(row.refresh_token);
    const params = new URLSearchParams({
      timeMin: resolvedMin,
      timeMax: resolvedMax,
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '250'
    });
    const data = await httpsReq({
      hostname: 'www.googleapis.com',
      path:     '/calendar/v3/calendars/primary/events?' + params,
      method:   'GET',
      headers:  { Authorization: 'Bearer ' + token }
    });
    if (data.error) throw new Error(data.error.message);
    res.json((data.items || []).map(e => ({
      id:           e.id,
      title:        e.summary || '(No title)',
      start:        e.start?.dateTime || e.start?.date,
      end:          e.end?.dateTime   || e.end?.date,
      all_day:      !e.start?.dateTime,
      transparency: e.transparency || 'opaque',
      htmlLink:     e.htmlLink || null,
      description:  e.description || null,
    })));
  } catch(e) {
    console.error('Google Calendar events error:', e.message);
    res.json([]);
  }
});

// ── Dashboard endpoints ───────────────────────────────────────────────────────

app.get('/api/dashboard/sprint-tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, s.id AS sprint_id, s.name AS sprint_name, p.id AS project_id, p.name AS project_name
    FROM sprint_tasks st
    JOIN sprints s ON s.id = st.sprint_id AND s.status = 'active'
    JOIN tasks t ON t.id = st.task_id
    JOIN projects p ON p.name = t.project
    WHERE t.status != 'complete'
    ORDER BY p.name, s.name, t.title
  `).all();
  res.json(rows);
});

app.get('/api/dashboard/recent-notes', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5, 50);
  const rows = db.prepare(`
    SELECT n.id, n.title, n.type, n.note_date, n.task_id, n.project_id,
           p.name AS project_name,
           (SELECT title FROM tasks WHERE id = n.task_id) AS task_title
    FROM notes n LEFT JOIN projects p ON p.id = n.project_id
    ORDER BY n.note_date DESC, n.id DESC
    LIMIT ?
  `).all(limit);
  res.json(rows);
});

app.get('/api/links/search', (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json([]);
  const like = `%${q.trim()}%`;
  const rows = db.prepare(`
    SELECT pl.*, p.name AS project_name
    FROM project_links pl JOIN projects p ON p.id = pl.project_id
    WHERE pl.label LIKE ? OR pl.url LIKE ?
    ORDER BY pl.created_at DESC LIMIT 20
  `).all(like, like);
  res.json(rows);
});

// ── Note shares ───────────────────────────────────────────────────────────────

const ACTIVE_SHARE = `s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))`;

app.get('/api/notes/:id/shares', (req, res) => {
  const note = db.prepare('SELECT id FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const shares = db.prepare(`SELECT * FROM note_shares s WHERE s.note_id=? AND ${ACTIVE_SHARE} ORDER BY s.created_at DESC`).all(note.id);
  res.json(shares);
});

app.post('/api/notes/:id/shares', (req, res) => {
  const note = db.prepare('SELECT id FROM notes WHERE id=?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  const { expires_in_days, include_ai_summary = 0 } = req.body;
  const token = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const expires_at = expires_in_days
    ? db.prepare("SELECT datetime('now', ? || ' days') AS t").get(`+${Number(expires_in_days)}`).t
    : null;
  const r = db.prepare('INSERT INTO note_shares (note_id,token,expires_at,include_ai_summary) VALUES (?,?,?,?)')
    .run(note.id, token, expires_at, include_ai_summary ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM note_shares WHERE id=?').get(r.lastInsertRowid));
});

app.delete('/api/shares/:token', (req, res) => {
  const share = db.prepare('SELECT id FROM note_shares WHERE token=?').get(req.params.token);
  if (!share) return res.status(404).json({ error: 'Share not found' });
  db.prepare("UPDATE note_shares SET revoked_at=datetime('now') WHERE id=?").run(share.id);
  res.json({ ok: true });
});

// Public endpoint — returns only the fields the share page needs
app.get('/api/share/:token', (req, res) => {
  const share = db.prepare('SELECT * FROM note_shares WHERE token=?').get(req.params.token);
  if (!share) return res.status(404).json({ error: 'Not found' });
  if (share.revoked_at) return res.status(410).json({ error: 'revoked' });
  if (share.expires_at && share.expires_at < new Date().toISOString().replace('T',' ').slice(0,19)) {
    return res.status(410).json({ error: 'expired' });
  }
  const note = db.prepare('SELECT n.title, n.note_date, n.body, n.ai_summary_url, p.name AS project_name FROM notes n LEFT JOIN projects p ON p.id=n.project_id WHERE n.id=?').get(share.note_id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  res.json({
    title:         note.title,
    note_date:     note.note_date,
    body:          note.body,
    project_name:  note.project_name,
    ai_summary_url: share.include_ai_summary ? note.ai_summary_url : null,
  });
});

// Serve share page for /share/n/:token
app.get('/share/n/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// ── Gmail capture ─────────────────────────────────────────────────────────────

function extractGmailText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === 'text/plain' && p.body?.data)
        return Buffer.from(p.body.data, 'base64url').toString('utf8');
    }
    for (const p of payload.parts) { const t = extractGmailText(p); if (t) return t; }
  }
  return '';
}

function gmailHdr(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function gmailEnsureLabels(token) {
  const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
  const toTaskId = getSetting('gmail_label_to_task_id');
  const taskedId = getSetting('gmail_label_tasked_id');
  if (toTaskId && taskedId) return { toTaskId, taskedId };

  const data = await httpsReq({ hostname:'www.googleapis.com', path:'/gmail/v1/users/me/labels',
    method:'GET', headers:{ Authorization:'Bearer '+token } });
  if (data?.error) throw new Error(data.error.message);
  const labels = data?.labels || [];

  async function ensureLabel(name) {
    let lbl = labels.find(l => l.name === name);
    if (!lbl) {
      const body = JSON.stringify({ name, labelListVisibility:'labelShow', messageListVisibility:'show' });
      lbl = await httpsReq({ hostname:'www.googleapis.com', path:'/gmail/v1/users/me/labels', method:'POST',
        headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, body);
      if (lbl?.error) throw new Error(lbl.error.message);
    }
    return lbl;
  }

  const [toTask, tasked] = await Promise.all([ensureLabel('→ Task'), ensureLabel('✓ Tasked')]);
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('gmail_label_to_task_id', toTask.id);
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('gmail_label_tasked_id',  tasked.id);
  return { toTaskId: toTask.id, taskedId: tasked.id };
}

async function gmailModifyLabels(token, msgId, remove, add) {
  const body = JSON.stringify({ removeLabelIds: remove, addLabelIds: add });
  const r = await httpsReq({ hostname:'www.googleapis.com',
    path:`/gmail/v1/users/me/messages/${msgId}/modify`, method:'POST',
    headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, body);
  if (r?.error) throw new Error(r.error.message);
}

async function gmailModifyThread(token, threadId, remove, add) {
  const body = JSON.stringify({ removeLabelIds: remove, addLabelIds: add });
  const r = await httpsReq({ hostname:'www.googleapis.com',
    path:`/gmail/v1/users/me/threads/${threadId}/modify`, method:'POST',
    headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, body);
  if (r?.error) throw new Error(r.error.message);
}

function stripEmailQuotes(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Stop at quoted-reply markers
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (/^From:\s.+Sent:\s/.test(line)) break;
    if (/^-{3,}\s*Original Message\s*-{3,}/i.test(line)) break;
    if (/^_{3,}/.test(line)) break;
    // Skip lines that are quoted (start with >)
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  // Trim trailing blank lines
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

async function gmailCheckInbox() {
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id=1').get();
  if (!auth) return { count: 0, error: 'Not connected' };
  try {
    const token = await googleAccessToken(auth.refresh_token);
    const { toTaskId, taskedId } = await gmailEnsureLabels(token);

    const listData = await httpsReq({ hostname:'www.googleapis.com',
      path:`/gmail/v1/users/me/threads?labelIds=${encodeURIComponent(toTaskId)}&maxResults=50`,
      method:'GET', headers:{ Authorization:'Bearer '+token } });
    if (listData?.error) throw new Error(listData.error.message);

    const threads = listData?.threads || [];
    let count = 0;

    for (const t of threads) {
      const threadId = t.id;

      // Fetch full thread to get all messages
      const threadData = await httpsReq({ hostname:'www.googleapis.com',
        path:`/gmail/v1/users/me/threads/${threadId}?format=full`,
        method:'GET', headers:{ Authorization:'Bearer '+token } });
      if (threadData?.error) { console.error('Gmail get thread error:', threadData.error.message); continue; }

      const msgs = threadData?.messages || [];
      if (!msgs.length) continue;

      // Always use the most recent message
      const msg = msgs[msgs.length - 1];
      const hdrs    = msg.payload?.headers || [];
      const subject = gmailHdr(hdrs, 'Subject');
      const from    = gmailHdr(hdrs, 'From');
      const date    = gmailHdr(hdrs, 'Date');
      const gmailUrl = `https://mail.google.com/mail/u/0/#all/${threadId}`;

      // Check thread-level dedup first
      const existsByThread = db.prepare('SELECT id FROM tasks WHERE gmail_thread_id=?').get(threadId);
      if (existsByThread) {
        // Thread already has a task — add an Updates Log entry
        const updateContent = `New email from ${from} · ${date}\n[Open in Gmail](${gmailUrl})`;
        db.prepare('INSERT INTO task_updates (task_id, content) VALUES (?, ?)').run(existsByThread.id, updateContent);
        await gmailModifyThread(token, threadId, [toTaskId], [taskedId]).catch(e =>
          console.error('Gmail label swap error:', e.message));
        console.log(`[Gmail] Thread ${threadId} already has task #${existsByThread.id} — added update`);
        continue;
      }

      // Legacy message-level dedup (for tasks created before thread tracking)
      const existsByMsg = db.prepare('SELECT id FROM tasks WHERE gmail_message_id=?').get(msg.id);
      if (existsByMsg) {
        // Backfill thread ID and remove label
        db.prepare('UPDATE tasks SET gmail_thread_id=? WHERE id=?').run(threadId, existsByMsg.id);
        await gmailModifyThread(token, threadId, [toTaskId], [taskedId]).catch(() => {});
        continue;
      }

      // New thread — create task
      let title = subject.replace(/^(re:|fwd:|fw:)\s*/gi, '').trim();
      if (!title) title = `Email from ${from}`;

      let priority = 'medium';
      if (/!urgent/i.test(title)) { priority = 'urgent'; title = title.replace(/!urgent\s*/gi, '').trim(); }
      else if (/!high/i.test(title)) { priority = 'high'; title = title.replace(/!high\s*/gi, '').trim(); }
      if (!title) title = `Email from ${from}`;

      const rawBody   = extractGmailText(msg.payload).trim();
      const cleaned   = stripEmailQuotes(rawBody);
      const bodySnip  = cleaned.slice(0, 2000) + (cleaned.length > 2000 ? '…' : '');
      const notes     = bodySnip;

      db.prepare(`INSERT INTO tasks (title, priority, status, notes, is_inbox, gmail_message_id, gmail_thread_id, source_url, source_sender, source_date)
        VALUES (?, ?, 'new', ?, 1, ?, ?, ?, ?, ?)`)
        .run(title, priority, notes, msg.id, threadId, gmailUrl, from, date);
      count++;

      await gmailModifyThread(token, threadId, [toTaskId], [taskedId]).catch(e =>
        console.error('Gmail label swap error:', e.message));
    }

    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('gmail_last_checked', new Date().toISOString());
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('gmail_last_error', '');
    console.log(`[Gmail] Processed ${threads.length} thread(s), created ${count} task(s)`);
    return { count };
  } catch(e) {
    console.error('[Gmail] capture error:', e.message);
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('gmail_last_error', e.message);
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('gmail_last_checked', new Date().toISOString());
    return { count: 0, error: e.message };
  }
}

app.get('/api/gmail/status', (req, res) => {
  const s = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
  const today      = new Date().toISOString().slice(0, 10);
  const taskCount  = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE gmail_message_id IS NOT NULL AND date(created_at)=?").get(today).n;
  const lastError  = s('gmail_last_error');
  res.json({
    enabled:       s('gmail_capture_enabled') === '1',
    last_checked:  s('gmail_last_checked') || null,
    tasks_today:   taskCount,
    last_error:    lastError || null,
    connected:     !!db.prepare('SELECT id FROM google_auth WHERE id=1').get(),
  });
});

app.post('/api/gmail/check', async (req, res) => {
  if (!db.prepare('SELECT id FROM google_auth WHERE id=1').get())
    return res.status(400).json({ error: 'Google not connected' });
  const result = await gmailCheckInbox();
  res.json(result);
});

app.patch('/api/gmail/settings', (req, res) => {
  const { enabled } = req.body;
  if (enabled !== undefined)
    db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('gmail_capture_enabled', enabled ? '1' : '0');
  const s = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
  res.json({ enabled: s('gmail_capture_enabled') === '1' });
});

// Show duplicate Gmail tasks grouped by subject (message_id dedup, thread_id null)
app.get('/api/gmail/duplicates', (req, res) => {
  const tasks = db.prepare(`
    SELECT id, title, created_at, gmail_message_id, gmail_thread_id, status, notes
    FROM tasks WHERE gmail_message_id IS NOT NULL
    ORDER BY title, created_at
  `).all();
  const groups = {};
  for (const t of tasks) {
    const key = t.title.toLowerCase().trim();
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  const dupes = Object.values(groups).filter(g => g.length > 1);
  res.json(dupes);
});

// Delete untouched duplicate Gmail tasks (keep newest by created_at, delete others if status=new, no time blocks, no updates beyond auto)
app.post('/api/gmail/dedupe', (req, res) => {
  const tasks = db.prepare(`
    SELECT id, title, created_at FROM tasks WHERE gmail_message_id IS NOT NULL ORDER BY title, created_at
  `).all();
  const groups = {};
  for (const t of tasks) {
    const key = t.title.toLowerCase().trim();
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  let deleted = 0;
  for (const group of Object.values(groups)) {
    if (group.length < 2) continue;
    // Keep the last (newest), delete earlier ones if untouched
    const toDelete = group.slice(0, -1);
    for (const t of toDelete) {
      const status = db.prepare('SELECT status FROM tasks WHERE id=?').get(t.id)?.status;
      const hasBlocks = db.prepare('SELECT COUNT(*) AS n FROM time_blocks WHERE task_id=?').get(t.id).n;
      const hasUpdates = db.prepare('SELECT COUNT(*) AS n FROM task_updates WHERE task_id=?').get(t.id).n;
      if (status === 'new' && hasBlocks === 0 && hasUpdates === 0) {
        db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
        deleted++;
      }
    }
  }
  res.json({ deleted });
});

// Background poll every 2 minutes
setInterval(async () => {
  const enabled = db.prepare("SELECT value FROM settings WHERE key='gmail_capture_enabled'").get()?.value;
  if (enabled !== '1') return;
  await gmailCheckInbox();
}, 2 * 60 * 1000);

// ── Reports ───────────────────────────────────────────────────────────────────

app.get('/api/reports/time-by-category', (req, res) => {
  const { week } = req.query; // ISO week start date YYYY-MM-DD (Monday or Sunday)
  let dateFilter = '';
  const params = [];
  if (week) {
    dateFilter = 'AND tl.logged_at >= ? AND tl.logged_at < datetime(?, \'+7 days\')';
    params.push(week, week);
  }
  const rows = db.prepare(`
    SELECT t.category, SUM(tl.minutes) AS total_minutes
    FROM time_logs tl
    JOIN tasks t ON t.id = tl.task_id
    WHERE t.category IS NOT NULL ${dateFilter}
    GROUP BY t.category
    ORDER BY total_minutes DESC
  `).all(...params);
  const cap = db.prepare("SELECT value FROM settings WHERE key='category_capacity_hours'").get()?.value;
  const capacity = cap ? JSON.parse(cap) : {};
  res.json({ rows, capacity });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`TSP Task Manager → http://localhost:${PORT}`));
