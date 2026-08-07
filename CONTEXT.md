# TSP Task Manager — Project Context

Owner: Tony Smith (TSP). Personal productivity tool, no multi-user requirements, no authentication.

## What this is

A task manager built specifically around Tony's workflow. The core loop is:

1. **Capture** — dump tasks into the inbox quickly via `index.html` without worrying about categorization
2. **Triage** — assign category/project to inbox tasks to move them out of inbox
3. **Work** — view tasks by category, project, or status in `app.html`; log time as work happens
4. **Review** — use the "Needs Review" status to flag tasks before closing them

## Data model decisions

- `is_inbox = 1` whenever a task has neither a `category` nor a `project`. This flag is recomputed on every PUT so it stays accurate.
- `actual_minutes` on the task row is a **denormalized sum** of all `time_logs.minutes` for that task. It is recomputed transactionally whenever a time log is added or deleted — never edited directly.
- Projects are stored in a `projects` table by name; tasks store the project **name string** (not FK). This means renaming a project does not cascade to tasks — a deliberate simplicity trade-off.
- Categories are a fixed enum in code (admin/ops/accounting/marketing/sales/pm/hr/personal), not a DB table.

## Frontend architecture

Two separate HTML pages, each with all JS inline (no build step):

- `public/index.html` — inbox-only view. Fetches `GET /api/tasks?inbox=true`. Supports quick-add and inline assign (category + project).
- `public/app.html` — full app. Loads all tasks and projects on init, maintains local `state` object, re-renders on every mutation. No routing library — view state is held in `state.view` string (`'inbox'`, `'all'`, `'status:pending'`, `'category:admin'`, `'project:3'`).

The detail panel in `app.html` is a slide-in drawer (CSS `transform: translateX`). It does NOT auto-save — the user must click Save. Time logs are saved immediately when added.

## API conventions

- All filters on `GET /api/tasks` are optional query strings; they AND together.
- Default task sort: priority rank → nulls-last due date ASC → created_at DESC.
- `DELETE` endpoints return `204 No Content`.
- `better-sqlite3` is synchronous; no async/await in server.js.

## Known constraints

- SQLite on Railway requires a persistent volume. Without one, the DB resets on every deploy. See README for volume setup.
- No pagination — designed for a personal workload (hundreds of tasks, not thousands).
- No search — filter by category/project/status/priority covers the intended use cases.
