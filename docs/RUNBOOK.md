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

## Schema migrations

- **Adding a `NOT NULL` column with no default** — `pnpm db:generate` will
  happily emit `ALTER TABLE ... ADD COLUMN ... NOT NULL`, which fails
  outright against a table that already has rows (there's nothing to
  populate the new column with). It works today because this is a
  pre-launch schema with no production data yet. Once real rows exist, do
  the same three-step rollout `entity.match_key` used: (a) migration adds
  the column nullable, no default; (b) a `tsx` backfill script computes and
  writes the value for every existing row *in application code* (never in
  raw SQL) so the backfill logic can't drift from what the app itself would
  compute; (c) a hand-written migration (below) adds the `NOT NULL`
  constraint once every row has a value.
- **A migration needing something drizzle-kit can't express** (a partial
  index, a `NOT NULL` added after a backfill, a `CHECK` constraint) —
  `pnpm --filter @osint/db exec drizzle-kit generate --custom --name
  <description>` emits an empty numbered `.sql` file in `migrations/` for
  you to hand-write. It still gets tracked in `_journal.json` and applied
  by `pnpm db:migrate` like any generated migration.
- **Adding an index to a table that already has significant rows in a live
  environment** — a plain `CREATE INDEX` takes a lock that blocks writes for
  the duration of the build. Hand-edit the generated migration (or use a
  `--custom` one) to say `CREATE INDEX CONCURRENTLY` instead, and be aware
  drizzle's own migrator wraps each migration file in a transaction by
  default — `CREATE INDEX CONCURRENTLY` cannot run inside one, so a
  concurrent-index migration needs `-- drizzle:no-transaction` or a
  hand-rolled `psql` invocation outside `pnpm db:migrate`, whichever
  drizzle's currently-pinned version supports; check its changelog before
  relying on either.

## Bulk-loading very large CSV files (100M+ rows)

The CSV Search feature (`packages/db/src/schema/csv-search.ts`,
`apps/worker/src/csv/`) was originally sized for "hundreds of thousands to
low millions of rows" on one local Postgres instance. Past that, three
things dominate and are each addressed below: GIN index maintenance,
Postgres's stock (tiny) default memory settings, and per-row/per-batch
INSERT overhead.

### 1. Run the tuning script (drops indexes + tunes Postgres, one shot)

`infra/scripts/tune-for-bulk-load.ps1` does everything in this section in
one go: drops `csv_record_search_vector_idx` and
`csv_record_search_text_trgm_idx` (both GIN — incremental maintenance on
every insert, the trigram one especially, is usually the single biggest
cost at this scale, so build fresh after loading instead), disables
autovacuum on `csv_record`, relaxes durability/checkpoint settings, bumps
`shared_buffers`/`effective_cache_size`/`maintenance_work_mem`/`work_mem`,
and **restarts the postgres container** (required for `shared_buffers` to
take effect — run this before anything is writing to `csv_record`, not
mid-load):

```powershell
./infra/scripts/tune-for-bulk-load.ps1
```

Then add the CSV source folder(s) — that's what actually starts indexing.

Once the load is fully done, revert the durability/vacuum settings and
rebuild the two indexes:

```powershell
./infra/scripts/tune-for-bulk-load.ps1 -Revert
```

```bash
docker exec -it osint-dashboard-postgres-1 psql -U osint -d osint -c "CREATE INDEX csv_record_search_vector_idx ON csv_record USING gin (search_vector); CREATE INDEX csv_record_search_text_trgm_idx ON csv_record USING gin (search_text gin_trgm_ops); ANALYZE csv_record;"
```
(non-concurrently is fine — and faster — if nothing else needs to query
the table meanwhile; use `CREATE INDEX CONCURRENTLY` instead if it does)

The script defaults `shared_buffers=16GB`/`effective_cache_size=48GB` —
sized off a 64GB host, not a universal default. Pass different values by
editing the script's `Invoke-Psql` calls, or run the statements by hand
(below) if you're not on Windows/PowerShell. Also check Docker Desktop's
own VM memory cap (Settings → Resources) isn't set lower than what you're
asking Postgres for — the container will fail to (re)start otherwise.

<details>
<summary>What the script runs, if you need to do it by hand</summary>

**`ALTER SYSTEM` cannot run in a transaction block** — and psql wraps
multiple `;`-separated statements passed to a single `-c` string in an
implicit transaction, so chaining `ALTER SYSTEM` in with other statements
that way fails with `ALTER SYSTEM cannot run inside a transaction block`.
Pass each statement as its own `-c` flag instead:

```bash
docker exec -it osint-dashboard-postgres-1 psql -U osint -d osint -c "DROP INDEX IF EXISTS csv_record_search_vector_idx;" -c "DROP INDEX IF EXISTS csv_record_search_text_trgm_idx;" -c "ALTER TABLE csv_record SET (autovacuum_enabled = false);" -c "ALTER SYSTEM SET synchronous_commit = off;" -c "ALTER SYSTEM SET maintenance_work_mem = '4GB';" -c "ALTER SYSTEM SET work_mem = '256MB';" -c "ALTER SYSTEM SET max_wal_size = '16GB';" -c "ALTER SYSTEM SET checkpoint_timeout = '30min';" -c "ALTER SYSTEM SET shared_buffers = '16GB';" -c "ALTER SYSTEM SET effective_cache_size = '48GB';"
```

`docker compose` resolves `-f infra/docker-compose.yml` relative to your
current directory, so `cd` into the repo root first:

```bash
cd /path/to/Osint-Dashboard
docker compose -f infra/docker-compose.yml restart postgres
```

Revert:

```bash
docker exec -it osint-dashboard-postgres-1 psql -U osint -d osint -c "ALTER TABLE csv_record SET (autovacuum_enabled = true);" -c "ALTER SYSTEM SET synchronous_commit = on;" -c "SELECT pg_reload_conf();"
```

</details>

### 2. The worker's own load path: batched INSERT vs. COPY

`apps/worker/src/csv/index-file.ts` streams each file through `csv-parse`
and writes to `csv_record` via Postgres `COPY FROM STDIN`
(`pgClient\`copy ...\`.writable()`, the raw postgres.js client exported as
`pgClient` from `packages/db/src/client.ts` — Drizzle's own `sql` helper
only builds fragments for `db.execute()`, it doesn't expose COPY). This
replaced an earlier batched-`INSERT` version once file sizes grew into the
hundreds of millions of rows, where per-statement planning/parameter-binding
overhead (even batched at thousands of rows/statement) became the
bottleneck. Deliberate trade-offs, both accepted for this scale:

- **Rows are written in chunks of `COPY_CHUNK_ROWS` (500,000), not one COPY
  for the whole file.** COPY FROM STDIN is one implicit transaction — a
  hard failure (dropped connection, etc.) rolls back whatever hasn't
  committed in the *current* chunk, not the whole file. Chunking bounds
  that blast radius; it doesn't eliminate it. A failure still loses up to
  ~500K rows of progress, versus ~10K under the old batched-INSERT version.
- **`rowCount`/`errorRowCount` are approximate**, not a confirmed
  post-write count from Postgres — they reflect what the worker attempted
  to write. `ON_ERROR ignore` (Postgres 17+; confirmed via
  `infra/docker-compose.yml`'s `pgvector/pgvector:pg17` image) lets
  Postgres silently skip a row that fails server-side type conversion
  without aborting the chunk, and that skip isn't reflected back into the
  counts. Getting an exact count would mean a `COUNT(*)` per chunk, which
  itself gets slower as the table grows — working against the reason for
  this change in the first place. Rows that fail to parse as CSV at all are
  still caught and counted client-side, before ever reaching COPY, same as
  before.
- **This has not been run against a live multi-hundred-million-row load in
  this environment** (Docker Compose isn't available in every dev sandbox
  used on this project). Trial it against one real file before pointing it
  at the largest one — the fallback if something's wrong is the same as
  ever: check `csv_source_file.status`/`error_message` for that file.

If you need to change the chunk size, it's the one constant at the top of
`index-file.ts` — larger reduces per-invocation overhead further but
raises the worst-case rows-lost-on-failure; smaller does the reverse.

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
