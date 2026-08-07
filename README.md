# TSP Task Manager

Personal task manager for Tony Smith. Node/Express backend with SQLite, vanilla JS frontend. No auth — single-user.

## Setup

```bash
npm install
npm run dev      # development (nodemon)
npm start        # production
```

Runs at `http://localhost:3000`.

## Pages

| URL | Purpose |
|-----|---------|
| `/` → `index.html` | Inbox / Quick Capture — fast task entry and inbox triage |
| `/app.html` | Full Task Manager — all views, filters, time tracking, projects |

## Task fields

- **Title** — required
- **Priority** — `urgent` / `high` / `medium` / `low`
- **Category** — `admin` / `ops` / `accounting` / `marketing` / `sales` / `pm` / `hr` / `personal`
- **Project** — free-form, managed from sidebar
- **Status** — `pending` / `in-progress` / `needs-review` / `on-hold` / `complete`
- **Due date**, **Estimated minutes**, **Actual minutes** (auto-summed from time log entries)
- **Notes** — freeform text

Tasks without a category or project are automatically flagged as **inbox** items.

## REST API

```
GET    /api/tasks                    # list (filter: ?status=&category=&project=&priority=&inbox=true)
POST   /api/tasks                    # create
GET    /api/tasks/:id                # get one
PUT    /api/tasks/:id                # update
DELETE /api/tasks/:id                # delete

GET    /api/tasks/:id/time-logs      # list time log entries
POST   /api/tasks/:id/time-logs      # add entry { minutes, description? }
DELETE /api/time-logs/:id            # remove entry (recalculates actual_minutes)

GET    /api/projects                 # list
POST   /api/projects                 # create { name }
DELETE /api/projects/:id             # delete
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./tasks.db` | Path to SQLite database file |

## Railway deployment

Configured via `railway.json`. Set `DB_PATH` to a path inside a mounted Railway volume (e.g. `/data/tasks.db`) so the database persists across deploys. Without a volume the database resets on each deploy.

```
railway volume add --mount /data
railway variables set DB_PATH=/data/tasks.db
railway up
```
