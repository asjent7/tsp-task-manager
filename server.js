const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
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
`);

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
  db.prepare('SELECT task_id, COUNT(*) AS cnt FROM task_meeting_notes GROUP BY task_id').all()
    .forEach(r => { mnCounts[r.task_id] = { cnt: r.cnt }; });
  db.prepare(`SELECT mn.task_id, mn.url FROM task_meeting_notes mn
    WHERE mn.id = (SELECT id FROM task_meeting_notes WHERE task_id = mn.task_id ORDER BY date DESC, id DESC LIMIT 1)`).all()
    .forEach(r => { if (mnCounts[r.task_id]) mnCounts[r.task_id].latest_url = r.url; });

  res.json(tasks.map(t => ({
    ...t,
    subtask_count: cmap[t.id]?.total || 0,
    subtask_done:  cmap[t.id]?.done  || 0,
    meeting_notes_count:      mnCounts[t.id]?.cnt        || 0,
    meeting_notes_latest_url: mnCounts[t.id]?.latest_url || null,
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
    status = 'pending', due_date, estimated_minutes, notes
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

  db.prepare(`
    UPDATE tasks SET
      title = ?, priority = ?, category = ?, project = ?, status = ?,
      due_date = ?, estimated_minutes = ?, notes = ?, is_inbox = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(title, priority, category, project, status, due_date, estimated_minutes, notes, is_inbox, req.params.id);

  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Task not found' });
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
  const { date, url } = req.body;
  if (!date?.trim()) return res.status(400).json({ error: 'Date is required' });
  if (!url?.trim())  return res.status(400).json({ error: 'URL is required' });
  const r = db.prepare('INSERT INTO task_meeting_notes (task_id, date, url) VALUES (?, ?, ?)').run(req.params.id, date.trim(), url.trim());
  res.status(201).json(db.prepare('SELECT * FROM task_meeting_notes WHERE id = ?').get(r.lastInsertRowid));
});

app.delete('/api/meeting-notes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM task_meeting_notes WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Meeting note not found' });
  res.status(204).end();
});

// ── Projects ──────────────────────────────────────────────────────────────────

const withLinks = (proj) => ({
  ...proj,
  links: db.prepare('SELECT * FROM project_links WHERE project_id = ? ORDER BY created_at ASC').all(proj.id)
});

app.get('/api/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY name ASC').all().map(withLinks));
});

app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });
  try {
    const result = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name.trim());
    res.status(201).json(withLinks(db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid)));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Project already exists' });
    throw e;
  }
});

app.put('/api/projects/:id', (req, res) => {
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });
  try {
    db.transaction(() => {
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
      db.prepare('UPDATE tasks SET project = ?, updated_at = datetime(\'now\') WHERE project = ?').run(name.trim(), proj.name);
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
  const { label, url } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Label is required' });
  if (!url?.trim())   return res.status(400).json({ error: 'URL is required' });
  const r = db.prepare('INSERT INTO project_links (project_id, label, url) VALUES (?, ?, ?)').run(req.params.id, label.trim(), url.trim());
  res.status(201).json(db.prepare('SELECT * FROM project_links WHERE id = ?').get(r.lastInsertRowid));
});

app.delete('/api/project-links/:id', (req, res) => {
  const result = db.prepare('DELETE FROM project_links WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Link not found' });
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
        VALUES (?, ?, ?, ?, 'pending', ?, 0)
      `).run(tt.title, tt.priority, tt.category || null, project.trim(), tt.estimated_minutes || null);
      return db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid);
    })
  )();

  res.status(201).json(created);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`TSP Task Manager → http://localhost:${PORT}`));
