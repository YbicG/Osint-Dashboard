# Runbook

Operational reference for running, troubleshooting, and maintaining the
OSINT Dashboard. See [`README.md`](../README.md) for feature status and
[`PLAN.md`](./PLAN.md) for architecture.

## First-time setup

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres redis minio
pnpm db:migrate
pnpm db:seed
pnpm --filter @osint/web exec playwright install chromium
pnpm dev
```

Sign in at `localhost:3000` with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`
from `.env` (defaults in `.env.example` if unset — change the password
after first login).

## Docker Desktop won't start / `docker info` hangs or 500s

**Symptom:** `docker info` hangs for 15–30+ seconds, then returns:
```
Server:
ERROR: request returned 500 Internal Server Error for API route and version
.../dockerDesktopLinuxEngine/v1.55/info, check if the server supports the
requested API version
```
This means the Docker Desktop **client** is running but its Linux VM
**backend** never came up — the CLI can talk to the app, but the app can't
talk to its own engine.

### Diagnose

```bash
wsl.exe -l -v
```

- **"The Windows Subsystem for Linux is not installed."** → Docker Desktop
  is configured for (or defaulting to) the WSL2 backend, but WSL isn't
  present on the machine at all. The engine will never start. This was the
  actual root cause encountered during development of this project — the
  backend silently failed forever with the 500 above, with no clearer error
  surfaced anywhere.
- A distro list with a `Stopped` or `Running` state → WSL is present; the
  issue is something else (try the general fixes below first).

### Fix — pick one

**Option A: Install WSL2** (what Docker Desktop expects by default)
```powershell
wsl --install
```
Requires an elevated PowerShell prompt and a reboot afterward. This is the
supported/recommended path.

**Option B: Switch Docker Desktop to the Hyper-V backend** (no WSL needed,
Windows 11 Pro/Enterprise only — Home edition doesn't have Hyper-V)
1. Docker Desktop → Settings → General
2. Uncheck "Use the WSL 2 based engine"
3. Apply & Restart

Either one, then confirm with `docker info` — you want to see a `Server:`
section with real fields (`Containers:`, `Images:`, etc.), not an error.

### General fixes to try first (cheaper than the above)

- Docker Desktop → Troubleshoot (bug icon) → **Restart**
- Docker Desktop → Troubleshoot → **Clean / Purge data**, then relaunch
- Full machine reboot (catches a wedged WSL2 utility VM even when WSL
  itself is installed and looks fine)
- `wsl --shutdown` then relaunch Docker Desktop — **only useful if WSL is
  actually installed**; if `wsl.exe -l -v` says WSL isn't installed, this
  command does nothing and you should skip straight to Option A or B above.

### Once the engine is healthy

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis minio
docker compose -f infra/docker-compose.yml ps   # all three should show "healthy"
pnpm db:migrate
pnpm db:seed
```

## Day-to-day commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web app + worker, both watching, via Turborepo |
| `pnpm typecheck` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest across all packages (fixture-based — no live network, no DB) |
| `pnpm --filter @osint/connectors test:live` | Opt-in suite that hits real connector endpoints |
| `pnpm --filter @osint/web build` | Next.js production build |
| `pnpm db:generate` | Generate a new Drizzle migration after a schema change |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Idempotent — safe to re-run; creates org/admin/sources if missing |
| `pnpm db:studio` | Drizzle Studio, a GUI over the local Postgres |

## Common failure modes

**"Cannot find module" / workspace package not resolving** — run `pnpm
install` from the repo root, not inside a package. All internal packages
use `workspace:*` and need the root install to link them.

**A connector test hangs** — check `packages/connectors/src/sdk/http.ts`'s
`DEFAULT_TIMEOUT_MS` (20s) is doing its job; a hung *test* (as opposed to a
slow live call) usually means the test forgot to mock `ctx.fetch` and is
hitting the real network. All committed tests mock `ctx.fetch` — see
`packages/connectors/src/__tests__/rdap.test.ts` for the pattern.

**PDF report export fails / "Executable doesn't exist"** — Playwright's
Chromium isn't installed for the web app. Run:
```bash
pnpm --filter @osint/web exec playwright install chromium
```

**Vision service `/embed` returns 403** — you didn't send
`X-Biometric-Consent-Ack: true`. This is intentional (BIPA/CUBI compliance
gate, see `apps/vision/app/main.py`) — the caller must assert the
case-level consent check has already passed.

**Vision service is slow on first request** — it's downloading the
~280MB InsightFace `buffalo_l` model pack. Subsequent starts are fast
(cached under `INSIGHTFACE_HOME` / `MODEL_CACHE_DIR`).

**Seed says admin already exists but you don't know the password** —
`SEED_ADMIN_PASSWORD` only takes effect the *first* time that email is
created. To reset, delete the row from `app_user` (or change
`SEED_ADMIN_EMAIL` to a fresh address) and re-run `pnpm db:seed`.

## Background workflow / agent orchestration notes

(Relevant only if you're using Claude Code's `Workflow` tool to keep
extending this project the way it was built.)

- If a long-running background workflow's task ID goes untracked by the
  harness (e.g. after a session restart) and you get a `stopped` /
  "no completion record found" notification for it, that does **not** mean
  the work is lost — completed `agent()` calls are cached by the workflow's
  run ID. Relaunch with the same script and
  `Workflow({ scriptPath, resumeFromRunId: "<the run id>" })` to replay
  everything already done instantly and only re-run what's missing.
- Before assuming a stalled workflow is actually dead, check whether its
  agent transcript files (under
  `<project>/subagents/workflows/<runId>/agent-*.jsonl`) are still being
  appended to — compare their last-modified timestamp to the current time.
  If they haven't moved in many minutes, it's genuinely stalled and safe to
  resume; if the timestamp is seconds old, it's still working, just slow on
  a research-heavy task.
