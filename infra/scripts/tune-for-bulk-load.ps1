<#
.SYNOPSIS
  One-shot Postgres tuning for a large CSV bulk load (see docs/RUNBOOK.md
  "Bulk-loading very large CSV files"). Drops the csv_record search indexes
  (7 total as of the typed-lookup-column redesign -- 6 B-tree + 1 trigram,
  see packages/db/migrations/0008_csv_record_lookup_columns.sql), disables
  autovacuum on it, relaxes durability, and bumps memory settings -- then
  restarts the postgres container so shared_buffers/effective_cache_size
  take effect. Assumes you're fine with the container restarting (this
  script exists specifically for the "add the CSV source folder AFTER
  running this" sequence in the runbook -- run it before anything is
  writing to csv_record, not mid-load).

  Run the matching -Revert pass once the load has finished, THEN
  -RebuildIndexes to actually build the seven dropped indexes back.

.PARAMETER ComposeFile
  Path to infra/docker-compose.yml. Defaults to the file next to this
  script (infra/scripts/../docker-compose.yml).

.PARAMETER ContainerName
  Postgres container name. Defaults to osint-dashboard-postgres-1.

.PARAMETER Revert
  Flip synchronous_commit and autovacuum back to normal after the load
  completes. Does NOT touch shared_buffers/effective_cache_size (fine to
  leave) and does NOT rebuild the dropped indexes -- run -RebuildIndexes
  for that, typically right after this.

.PARAMETER RebuildIndexes
  Builds the seven csv_record search indexes back (see
  packages/db/migrations/0008_csv_record_lookup_columns.sql), -Parallelism
  at a time instead of one after another -- CREATE INDEX on one column
  doesn't block CREATE INDEX on another, so running a few concurrently
  uses CPU/IO headroom a single sequential build leaves idle. Also raises
  maintenance_work_mem for this (a session-level setting, so it only
  affects new connections, which is exactly the index-build sessions this
  spins up) beyond what the load itself used, since nothing else is
  competing for memory once the load is done. Run -Revert first if you
  haven't already.

.PARAMETER Parallelism
  How many CREATE INDEX statements to run at once during -RebuildIndexes.
  Defaults to 3. Peak extra memory is roughly Parallelism *
  RebuildMaintenanceWorkMem (3 * 8GB = 24GB by default) -- keep that
  comfortably under your free RAM alongside shared_buffers (16GB by
  default from the main tuning pass).

.PARAMETER RebuildMaintenanceWorkMem
  Per-session maintenance_work_mem during -RebuildIndexes. Defaults to
  8GB (vs. 4GB during the load itself) -- each index build gets its own
  session-local allocation, so this is per CONCURRENT build, not a shared
  total; see -Parallelism's note on peak memory.

.EXAMPLE
  ./tune-for-bulk-load.ps1
  ./tune-for-bulk-load.ps1 -Revert
  ./tune-for-bulk-load.ps1 -RebuildIndexes
  ./tune-for-bulk-load.ps1 -RebuildIndexes -Parallelism 4 -RebuildMaintenanceWorkMem 6GB
#>
param(
  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.yml'),
  [string]$ContainerName = 'osint-dashboard-postgres-1',
  [switch]$Revert,
  [switch]$RebuildIndexes,
  [int]$Parallelism = 3,
  [string]$RebuildMaintenanceWorkMem = '8GB'
)

$ErrorActionPreference = 'Stop'

function Invoke-Psql {
  param([string[]]$Statements)
  $args = @('exec', '-i', $ContainerName, 'psql', '-U', 'osint', '-d', 'osint')
  foreach ($stmt in $Statements) { $args += @('-c', $stmt) }
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "psql exited with code $LASTEXITCODE" }
}

if ($Revert) {
  Write-Host "Reverting durability/vacuum settings..." -ForegroundColor Cyan
  Invoke-Psql @(
    "ALTER TABLE csv_record SET (autovacuum_enabled = true);",
    "ALTER SYSTEM SET synchronous_commit = on;",
    "SELECT pg_reload_conf();"
  )
  Write-Host "Done. shared_buffers/effective_cache_size were left as-is (fine to keep). Run -RebuildIndexes next to build the csv_record indexes back." -ForegroundColor Green
  exit 0
}

if ($RebuildIndexes) {
  # The seven indexes dropped at the top of this script's normal (non-Revert,
  # non-RebuildIndexes) pass -- see 0008_csv_record_lookup_columns.sql for
  # why ssn gets both a btree (equality/prefix) and a trigram GIN
  # (substring/suffix, e.g. last 4 digits).
  $indexStatements = @(
    'CREATE INDEX IF NOT EXISTS csv_record_ssn_idx ON csv_record USING btree (ssn);',
    'CREATE INDEX IF NOT EXISTS csv_record_last_name_idx ON csv_record USING btree (last_name);',
    'CREATE INDEX IF NOT EXISTS csv_record_first_name_idx ON csv_record USING btree (first_name);',
    'CREATE INDEX IF NOT EXISTS csv_record_phone_idx ON csv_record USING btree (phone);',
    'CREATE INDEX IF NOT EXISTS csv_record_zip_idx ON csv_record USING btree (zip);',
    'CREATE INDEX IF NOT EXISTS csv_record_dob_idx ON csv_record USING btree (dob);',
    'CREATE INDEX IF NOT EXISTS csv_record_ssn_trgm_idx ON csv_record USING gin (ssn gin_trgm_ops);'
  )

  Write-Host "Raising maintenance_work_mem to $RebuildMaintenanceWorkMem for index builds (session-level -- only affects new connections, doesn't need a restart)..." -ForegroundColor Cyan
  Invoke-Psql @(
    "ALTER SYSTEM SET maintenance_work_mem = '$RebuildMaintenanceWorkMem';",
    "SELECT pg_reload_conf();"
  )

  Write-Host "Building $($indexStatements.Count) indexes, $Parallelism at a time..." -ForegroundColor Cyan
  for ($i = 0; $i -lt $indexStatements.Count; $i += $Parallelism) {
    $batch = $indexStatements[$i..([Math]::Min($i + $Parallelism - 1, $indexStatements.Count - 1))]
    Write-Host "  Batch $([Math]::Floor($i / $Parallelism) + 1): $($batch.Count) index(es)..." -ForegroundColor DarkCyan

    $jobs = foreach ($stmt in $batch) {
      Start-Job -ScriptBlock {
        param($Container, $Sql)
        docker exec -i $Container psql -U osint -d osint -c $Sql
        if ($LASTEXITCODE -ne 0) { throw "psql exited with code $LASTEXITCODE for: $Sql" }
      } -ArgumentList $ContainerName, $stmt
    }
    $jobs | Wait-Job | Out-Null

    $batchFailed = $false
    foreach ($job in $jobs) {
      Receive-Job -Job $job 2>&1 | ForEach-Object { Write-Host "    $_" }
      if ($job.State -eq 'Failed') { $batchFailed = $true }
      Remove-Job -Job $job
    }
    if ($batchFailed) { throw "One or more index builds in this batch failed -- see output above." }
  }

  Write-Host "Running ANALYZE csv_record..." -ForegroundColor Cyan
  Invoke-Psql @("ANALYZE csv_record;")

  Write-Host "All 7 indexes built. If you haven't already, run this script with -Revert to restore durability/autovacuum settings." -ForegroundColor Green
  exit 0
}

if (-not (Test-Path $ComposeFile)) {
  throw "Compose file not found at '$ComposeFile'. Pass -ComposeFile explicitly, e.g. -ComposeFile 'D:\path\to\infra\docker-compose.yml'."
}

Write-Host "Dropping csv_record search indexes..." -ForegroundColor Cyan
Invoke-Psql @(
  "DROP INDEX IF EXISTS csv_record_ssn_idx;",
  "DROP INDEX IF EXISTS csv_record_last_name_idx;",
  "DROP INDEX IF EXISTS csv_record_first_name_idx;",
  "DROP INDEX IF EXISTS csv_record_phone_idx;",
  "DROP INDEX IF EXISTS csv_record_zip_idx;",
  "DROP INDEX IF EXISTS csv_record_dob_idx;",
  "DROP INDEX IF EXISTS csv_record_ssn_trgm_idx;"
)

Write-Host "Disabling autovacuum on csv_record and relaxing durability/checkpoint settings..." -ForegroundColor Cyan
Invoke-Psql @(
  "ALTER TABLE csv_record SET (autovacuum_enabled = false);",
  "ALTER SYSTEM SET synchronous_commit = off;",
  "ALTER SYSTEM SET maintenance_work_mem = '4GB';",
  "ALTER SYSTEM SET work_mem = '256MB';",
  "ALTER SYSTEM SET max_wal_size = '16GB';",
  "ALTER SYSTEM SET checkpoint_timeout = '30min';"
)

Write-Host "Setting shared_buffers/effective_cache_size (requires restart)..." -ForegroundColor Cyan
Invoke-Psql @(
  "ALTER SYSTEM SET shared_buffers = '16GB';",
  "ALTER SYSTEM SET effective_cache_size = '48GB';"
)

Write-Host "Restarting postgres container to apply shared_buffers..." -ForegroundColor Cyan
docker compose -f $ComposeFile restart postgres
if ($LASTEXITCODE -ne 0) { throw "docker compose restart exited with code $LASTEXITCODE" }

Write-Host "Waiting for postgres to report healthy..." -ForegroundColor Cyan
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  $status = docker inspect --format='{{.State.Health.Status}}' $ContainerName 2>$null
  if ($status -eq 'healthy') { $healthy = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $healthy) { Write-Warning "Container didn't report healthy within 60s -- check 'docker compose ps' before proceeding." }

Write-Host "Tuning applied. Add your CSV source folder(s) now -- indexing starts as soon as the worker sees them." -ForegroundColor Green
Write-Host "When the load is fully done: run this script with -Revert, then with -RebuildIndexes." -ForegroundColor Green
