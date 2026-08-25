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

  Run the matching -Revert pass once the load has finished, THEN rebuild
  the dropped indexes (see the runbook -- not done here, since you may
  still be loading a second file).

.PARAMETER ComposeFile
  Path to infra/docker-compose.yml. Defaults to the file next to this
  script (infra/scripts/../docker-compose.yml).

.PARAMETER ContainerName
  Postgres container name. Defaults to osint-dashboard-postgres-1.

.PARAMETER Revert
  Flip synchronous_commit and autovacuum back to normal after the load
  completes. Does NOT touch shared_buffers/effective_cache_size (fine to
  leave) and does NOT rebuild the dropped indexes (see the runbook).

.EXAMPLE
  ./tune-for-bulk-load.ps1
  ./tune-for-bulk-load.ps1 -Revert
#>
param(
  [string]$ComposeFile = (Join-Path $PSScriptRoot '..\docker-compose.yml'),
  [string]$ContainerName = 'osint-dashboard-postgres-1',
  [switch]$Revert
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
  Write-Host "Done. shared_buffers/effective_cache_size were left as-is (fine to keep). Rebuild the csv_record indexes next -- see docs/RUNBOOK.md." -ForegroundColor Green
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
Write-Host "When the load is fully done: run this script with -Revert, then rebuild the dropped indexes (see docs/RUNBOOK.md)." -ForegroundColor Green
