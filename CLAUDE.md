# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install deps (better-sqlite3, express, nodemon)
npm run dev          # start with nodemon (auto-restart on changes)
npm start            # production start
```

No build step. No test suite. No linter configured.

## Architecture

Node/Express + SQLite (`better-sqlite3`) backend. Two static vanilla JS pages — no framework, no bundler.

**server.js** — single file; all routes, DB init, and schema migration via `db.exec()` on startup. `better-sqlite3` is synchronous so there is no async/await in server code. The server computes `actual_minutes` as a denormalized sum of `time_logs` and keeps it in sync transactionally on every time log add/delete.

**public/index.html** — Inbox/quick-capture page. Minimal JS, only calls `GET /api/tasks?inbox=true` and `POST /api/tasks`.

**public/app.html** — Full task manager. All JS is inline. Maintains a `state` object (`tasks[]`, `projects[]`, `view`, `filters`, `selectedId`, `timeLogs[]`). No client-side routing — the current view is a string in `state.view` (`'inbox'`, `'all'`, `'status:pending'`, `'category:admin'`, `'project:3'`). Re-renders on every mutation by calling `renderSidebar()` + `renderTaskList()`. The detail panel is a CSS slide-in drawer; it does **not** auto-save.

## Key data model rules

- `is_inbox` on a task is `1` when the task has neither `category` nor `project`. Recomputed on every PUT.
- `actual_minutes` is a denormalized sum, never set directly — always derived from `time_logs`.
- Projects are stored by **name string** on the task row (not by FK). Renaming a project does not cascade.
- Categories are a hardcoded enum: `admin / ops / accounting / marketing / sales / pm / hr / personal`.

## Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `3000` | |
| `DB_PATH` | `./tasks.db` | Set to `/data/tasks.db` on Railway with a volume |

## Deployment

Railway — configured in `railway.json`. Needs a volume mounted at `/data` with `DB_PATH=/data/tasks.db` or the DB resets on redeploy.
