# farm-ts

Minimal split backend/frontend starter: **FastAPI + PostgreSQL** behind a
**Vite + React 19 + TypeScript** frontend, joined by a small typed fetch layer
over `/api`. This is a bare skeleton — no app features are implemented. Build on
top of it.

## Layout

```
farm-ts/
  backend/   FastAPI + asyncpg (PostgreSQL/Supabase) + Pydantic v2
  frontend/  Vite + React 19 + Tailwind v4 + shadcn/ui (TypeScript strict)
  tests/     Playwright e2e workspace (pre-scaffolded)
```

## Running

Two separate processes, managed by supervisor in the pod (see "Pod conventions"
below); to run them by hand from two terminals instead:

```bash
cd backend && uvicorn server:app --host 0.0.0.0 --port 8001 --reload   # http://localhost:8001
cd frontend && yarn dev                                                # http://localhost:3000
```

## The `/api` proxy convention

Every backend route lives under `/api` (the backend mounts one
`APIRouter(prefix="/api")`), and the frontend dev server
(`frontend/vite.config.ts`) proxies `/api/*` to `http://localhost:8001`. So
frontend code always calls a **relative** path — `apiGet("/status")` →
`/api/status` — and never an absolute backend URL. The same code works in dev
(via the Vite proxy) and in production (once both are served behind a single
origin).

## Backend

FastAPI, async throughout. `python` is the app venv interpreter
(`/root/.venv/bin/python`); backend deps are pip-installed from
`backend/requirements.txt`.

- **Entry point**: `backend/server.py` — creates `app = FastAPI()`, creates
  `api_router = APIRouter(prefix="/api")`, registers routes **on the router**,
  and calls `app.include_router(api_router)` at the bottom. CORS middleware is
  added from `CORS_ORIGINS`. Never hang a route directly off `app` — it would
  land outside `/api` and the Vite proxy would not reach it.
- **The route pattern** (copy `status` in `server.py`):
  1. a Pydantic model per request body and per response
     (`StatusCheckCreate` / `StatusCheck`);
  2. an `async def` handler decorated with
     `@api_router.post("/status", response_model=StatusCheck)`;
  3. `await` the database call inside it.
  FastAPI validates the request against the Pydantic model before your handler
  runs — a malformed body never reaches your code, it gets an automatic `422`
  with a `{"detail": [...]}` body.
- **Growing the backend**: as `server.py` gets crowded, move models to
  `backend/models/` and routers to `backend/routers/` (one module per resource,
  each exporting its own `APIRouter`, mounted from `server.py` via
  `api_router.include_router(...)` or `app.include_router(...)` with the `/api`
  prefix preserved).
- **PostgreSQL/Supabase**: import the shared handle — `from lib.db import client, db`
  (`backend/lib/db.py` self-loads `.env`). Existing route-facing CRUD calls keep
  their dictionary/list result shape; `backend/lib/postgres.py` executes them on
  PostgreSQL. The schema and foreign keys are in `backend/schema.sql`; the
  one-time Mongo data-copy procedure is in `backend/MIGRATION.md`.
- **Ids**: records use a string `id` (`uuid4`) field, not Mongo `ObjectId`;
  keep the uuid default-factory pattern from the existing models.
- **Config**: `backend/.env` — `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`,
  and optional Google/OpenAI settings. `lib/db.py` self-loads this file so
  standalone scripts inherit it too. Do not commit the real `.env`.
- **Dates**: `backend/lib/dates.py` — `today_iso(tz=None)`. The pod clock is
  UTC; anchor "today" server-side with this, never with client-side date math.
- **Interactive check**: `cd /app/backend && python -c 'import server'` catches
  syntax/import errors without waiting for the supervisor log.

## Frontend

- Vite + React 19 + TypeScript strict, dev server on port `3000`.
- Tailwind CSS v4 (via the `@tailwindcss/vite` plugin — no separate
  `tailwind.config.js` needed) + shadcn/ui, initialized with the `base-nova`
  style and `neutral` base color, `@` path alias (`@/*` → `src/*`) wired in both
  `tsconfig.app.json`/`tsconfig.json` and `vite.config.ts`.
- `react-router-dom` and `motion` are preinstalled — don't re-add them. `src/App.tsx`
  is the `<Routes>` table and nothing else; screens live in `src/pages/*.tsx` and are
  imported as `@/pages/<Name>`. `src/pages/Home.tsx` ships as the worked example. Add
  a `<Route>` for every page you write, in the same edit that creates the page — a
  page with no route is unreachable, and any URL without a matching `<Route>` renders a
  **blank page** — `<Routes>` matches nothing and mounts nothing.
- Components installed under `src/components/ui/`: button, card, input, label,
  select, dialog, sheet, tabs, badge, calendar, sonner, textarea, table, popover,
  dropdown-menu, checkbox. Add more with `npx shadcn@latest add <component>`.
- `src/lib/api.ts` — the typed fetch layer: `apiGet<T>`, `apiPost<T>`,
  `apiPut<T>`, `apiPatch<T>`, `apiDelete<T>`, all relative to base `/api`,
  throwing `ApiError` (with `status` and the parsed body) on any non-2xx.
  **Nothing infers across the Python boundary** — you declare the response type
  yourself as a TS interface mirroring the endpoint's Pydantic model, and keeping
  the two in sync is a manual discipline. When you change a Pydantic model,
  change its TS interface in the same edit.
- `src/pages/Home.tsx` is a minimal example of the wiring: TanStack Query's `useQuery`
  with `apiGet<StatusCheck[]>("/status")` as the `queryFn`. It is a **non-blocking
  connectivity probe**, not a proof of the round trip — the result is deliberately
  discarded so the splash renders identically with no backend. `apiGet<T>` does no
  runtime validation either; `T` is your assertion, not a check. See the
  static-preview rule in `TEMPLATE.md` §4 for why no page may be gated on a fetch.

## TypeScript

`frontend/tsconfig.app.json` / `tsconfig.node.json` have `strict: true`. In the
pod:

```bash
cd frontend && yarn typecheck
```

— plain `tsc --noEmit` run from `frontend/` checks ZERO files (root tsconfig uses
project references with `"files": []`) and exits 0 even with type errors. Always
use `-b` for the frontend. Lint with `cd frontend && yarn lint` (oxlint).

## Data fetching

TanStack Query is wired: `QueryClientProvider` in `src/main.tsx`, `useQuery` demo
in `src/pages/Home.tsx` (see above). Use `useQuery`/`useMutation`, not
fetch-in-`useEffect`.

## Completion gate (tier 1)

When the build is complete, run tier 1 once, all in the same turn: a curl smoke
over the key `/api` endpoints (assert status AND a response field, plus one
negative case), `cd frontend && yarn typecheck`, and ONE happy-path browser pass
through the core user journey. Clean on all three → finish; any failure is a real
bug — fix it, re-run the failed check, and escalate to the testing subagent.
No routine typecheck/lint/smoke passes during the build — tier 1 runs exactly once.


## Testing

Two lanes.

**Backend (pytest)** — specs in `backend/tests/` as `test_*.py`, run with:

```bash
cd /app/backend && pytest
```

`backend/pytest.ini` is canonical: `addopts = -n 2 --dist loadscope` (pytest-xdist,
already parallel — do not pass your own `-n`) and `asyncio_mode = auto` (so
`async def test_...` needs no marker). Serial is `-n 0`, **never**
`-p no:xdist` (that errors, because `addopts` still passes `-n`/`--dist`).
`backend/tests/conftest.py` is pre-scaffolded — a sync `client` fixture
(`httpx.Client` rooted at `/api`), an async `aclient`, and an `api_url()` helper,
all pointed at `BACKEND_URL` (default `http://localhost:8001`). Tests hit the
live uvicorn process, so the app under test is the one the browser sees. Add
app-specific fixtures below the marker; do not re-create the file.

**Frontend (Playwright)** — `/app/tests/` is pre-scaffolded:
`playwright.config.ts` (canonical — edit the marked lines only),
`fixtures/helpers.ts`, and a `package.json` that resolves
`@playwright/test@1.62.0` (node_modules baked into the image). Write specs into
`tests/e2e/`. Do NOT re-create the config/helpers or install/upgrade playwright —
matching Chromium browsers live at `/pw-browsers`.

The backend lane is pytest: this template's backend is Python, so `vitest` does
not apply to it.

## Pod conventions

This template runs under supervisord in the Emergent agent pod — supersedes any
local-run instructions above.

- Backend and frontend are supervisor programs. After code or
  config changes, restart and wait for readiness:

  ```bash
  sudo supervisorctl restart frontend backend
  until curl -sf -o /dev/null http://localhost:3000; do sleep 2; done
  ```

- Status, only after a restart you triggered:
  `sudo supervisorctl status frontend backend`. Logs:
  `/var/log/supervisor/backend.err.log`, `backend.out.log`,
  `frontend.err.log`.
- App in a browser: the pod's preview URL (frontend, port `3000`). Backend API
  directly at port `8001`.
- PostgreSQL must be reachable using `DATABASE_URL` in
  `backend/.env`.
- Both dev servers hot-reload on file edits (uvicorn `--reload` for the backend,
  Vite HMR for the frontend); no rebuild step needed for normal iteration. A
  restart is still needed after changing `.env`, `requirements.txt`, or
  `vite.config.ts`.

## Local setup (Windows)

Install PostgreSQL 17 for Windows and Python 3.11+ from python.org (enable the
Python launcher during setup), then open a new PowerShell window. Check that
`py --version` reports the installed Python, then prepare the environment:

```powershell
Copy-Item backend/.env.example backend/.env
npm install --prefix frontend
py -3 -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Edit `backend/.env` and set `DATABASE_URL` to the password chosen by the
PostgreSQL installer, for example
`postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/postgres`. PostgreSQL runs
as a Windows service; no Docker or Supabase CLI is used. The backend applies
`backend/schema.sql` automatically at startup. A hosted Supabase PostgreSQL URL
is also supported. Set separate random values for `JWT_SECRET` and
`WEBHOOK_CRON_SECRET`; the cron runner must send the latter as its bearer token.
The daily dispatcher is called every minute and sends each enabled store's
transaction summary after its local closing time.
Set `EMERGENT_EMAIL_KEY` from the configured email provider to enable delivery;
reports go to the active Pemilik accounts' stored email addresses. Failed sends
are retried no more often than every 20 minutes.
Start the backend once so it creates the schema. To create demo data, open a
second PowerShell terminal and change to `backend`,
then run `.\.venv\Scripts\python.exe seed.py`. Demo login:
`pemilik@demo.id` / `demo1234`.

To enable Google sign-in, create a Google OAuth 2.0 Web client, add the actual
frontend origin (normally `http://localhost:3000`) as an authorized JavaScript
origin, and set `GOOGLE_CLIENT_ID`. A user must first register a KasirKu
account with that verified Google email; OAuth signs in to that existing
account and never creates a store implicitly.

To enable product-image analysis, set `OPENAI_API_KEY` and optionally
`OPENAI_VISION_MODEL` in the backend environment. The key stays server-side.
Authenticated clients can send `POST /api/ai/vision/analyze` as multipart form
data with an `image` field (JPEG, PNG, or WebP; maximum 10 MB) and an optional
`question` field. The endpoint returns the model's `text` and `model`.

Staff can check in and out from the POS screen. Owners set store opening/closing
times, timezone and the daily-email toggle in **Pengaturan**; the same page lists
today's attendance records.

Run the backend and frontend in separate PowerShell terminals:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

```powershell
npm run dev
```

From the repository root, `npm run build` builds the frontend. The API requires
native PostgreSQL running and reachable through `DATABASE_URL`; Supabase CLI and
Docker are optional, not required for this local setup.
