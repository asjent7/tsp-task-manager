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
try { db.prepare("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'professional'").run(); } catch(e) {}
try { db.prepare('ALTER TABLE projects ADD COLUMN division TEXT').run(); } catch(e) {}

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

// Default settings
[['daily_capacity_minutes','480'],['day_start_hour','5'],['day_end_hour','21']]
  .forEach(([k,v]) => db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k,v));

// Editable categories
db.exec(`CREATE TABLE IF NOT EXISTS categories (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📁',
  color      TEXT NOT NULL DEFAULT '#6366f1',
  sort_order INTEGER NOT NULL DEFAULT 0
)`);
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
    status = 'new', due_date, estimated_minutes, notes
  } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const is_inbox = (!category && !project) ? 1 : 0;
  const result = db.prepare(`
    INSERT INTO tasks (title, priority, category, project, status, due_date, estimated_minutes, notes, is_inbox)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), priority,
    category || null, project || null,
    status, due_date || null,
    estimated_minutes ? Number(estimated_minutes) : null,
    notes || null, is_inbox
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

  const titleChanged = title !== task.title;
  db.prepare(`
    UPDATE tasks SET
      title = ?, priority = ?, category = ?, project = ?, status = ?,
      due_date = ?, estimated_minutes = ?, notes = ?, is_inbox = ?,
      blocked_by_task_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, priority, category, project, status, due_date, estimated_minutes, notes, is_inbox, blocked_by_task_id, req.params.id);

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

  const { minutes, description } = req.body;
  if (!minutes || Number(minutes) <= 0) {
    return res.status(400).json({ error: 'minutes must be a positive number' });
  }

  const log = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO time_logs (task_id, minutes, description) VALUES (?, ?, ?)'
    ).run(req.params.id, Number(minutes), description || null);
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
  const { name, type = 'professional', division_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });
  try {
    const result = db.prepare('INSERT INTO projects (name, type, division_id) VALUES (?, ?, ?)').run(name.trim(), type, division_id||null);
    res.status(201).json(withLinks(db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid)));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Project already exists' });
    throw e;
  }
});

app.put('/api/projects/:id', (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { name, type, division_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });
  const newType  = type       !== undefined ? type                  : proj.type;
  const newDivId = division_id !== undefined ? (division_id||null) : proj.division_id;
  try {
    db.transaction(() => {
      db.prepare('UPDATE projects SET name=?, type=?, division_id=? WHERE id=?').run(name.trim(), newType, newDivId, req.params.id);
      db.prepare("UPDATE tasks SET project=?, updated_at=datetime('now') WHERE project=?").run(name.trim(), proj.name);
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
  const { name, icon, color } = req.body;
  db.prepare('UPDATE categories SET name=?,icon=?,color=? WHERE slug=?')
    .run(name?.trim() ?? cat.name, icon ?? cat.icon, color ?? cat.color, cat.slug);
  res.json(db.prepare('SELECT * FROM categories WHERE slug=?').get(cat.slug));
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

// ── Settings ─────────────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const s = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => { s[r.key] = r.value; });
  res.json(s);
});

app.patch('/api/settings', (req, res) => {
  const allowed = ['daily_capacity_minutes','day_start_hour','day_end_hour','gcal_task_calendar_id'];
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
  const block = db.prepare('SELECT gcal_event_id FROM time_blocks WHERE id=?').get(req.params.id);
  if (!block) return res.status(404).json({ error: 'Time block not found' });
  db.prepare('DELETE FROM time_blocks WHERE id=?').run(req.params.id);
  if (block.gcal_event_id) deleteGoogleTaskBlockEvent(block.gcal_event_id);
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
  if (setting) return setting.value;
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
  const auth = db.prepare('SELECT refresh_token FROM google_auth WHERE id = 1').get();
  if (!auth) return null;
  try {
    const token  = await googleAccessToken(auth.refresh_token);
    const calId  = await getTaskCalendarId(token);
    const task   = db.prepare('SELECT title, category, project, due_date FROM tasks WHERE id=?').get(block.task_id);
    if (!task) return null;
    const startD = new Date(`${block.date}T${block.start_time}:00`);
    const endD   = new Date(startD.getTime() + Number(block.duration_minutes) * 60000);
    const descParts = [];
    if (task.project)  descParts.push(`Project: ${task.project}`);
    if (task.category) descParts.push(`Category: ${task.category}`);
    if (task.due_date) descParts.push(`Due: ${task.due_date}`);
    descParts.push(`${APP_BASE_URL}/app.html`);
    const body = JSON.stringify({
      summary:      `🎯 ${task.title}`,
      description:  descParts.join('\n'),
      start:        { dateTime: toRFC3339Local(startD) },
      end:          { dateTime: toRFC3339Local(endD) },
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
    scope:         'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
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

app.get('/api/auth/google/status', (req, res) => {
  const row = db.prepare('SELECT connected_at FROM google_auth WHERE id = 1').get();
  res.json({ connected: !!row, connected_at: row?.connected_at || null });
});

app.delete('/api/auth/google', (req, res) => {
  db.prepare('DELETE FROM google_auth').run();
  res.status(204).end();
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
      transparency: e.transparency || 'opaque'
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

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`TSP Task Manager → http://localhost:${PORT}`));
