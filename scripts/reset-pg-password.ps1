# =====================================================================
# FlockInsight - one-time PostgreSQL local password reset
# Run this ONCE as Administrator. It is fully reversible and additive:
#   1. Restarts Postgres (applies the temporary 'trust' localhost auth)
#   2. Sets a known password for the 'postgres' superuser
#   3. Creates the 'flockinsight' database (only if it doesn't exist)
#   4. Reverts pg_hba.conf back to secure scram-sha-256 auth
#   5. Restarts Postgres again so secure auth + new password take effect
# It does NOT delete any data, databases, roles, or files.
# =====================================================================

<#
.SYNOPSIS
  Set the local 'postgres' superuser password to a known value.

.PARAMETER Password
  The password to set. Defaults to 'flockinsight', which is what .env expects.
  Pass your own to keep a password you have already chosen elsewhere — it is
  read as plain text on your own machine and never leaves it.

.EXAMPLE
  # keep the default the rest of the project expects
  powershell -ExecutionPolicy Bypass -File scripts\reset-pg-password.ps1

.EXAMPLE
  # keep a password you chose yourself
  powershell -ExecutionPolicy Bypass -File scripts\reset-pg-password.ps1 -Password 'your-password'

.NOTES
  Run as Administrator. Touches ONLY the instance on port 5432 — the service
  install. Other local instances (ta_admin on 5433, and whatever runs on 5434)
  are left alone.
#>
param(
    [string]$Password = 'flockinsight',
    [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'

$pgVersion = '17'
$bin       = "C:\Program Files\PostgreSQL\$pgVersion\bin"
$data      = "C:\Program Files\PostgreSQL\$pgVersion\data"
$hba       = Join-Path $data 'pg_hba.conf'
$service   = "postgresql-x64-$pgVersion"
$psql      = Join-Path $bin 'psql.exe'

# --- The new local credentials (local dev only) ---
$newPassword = $Password
$dbName      = 'flockinsight'

function Restart-PG {
    Write-Host "  Restarting $service ..." -ForegroundColor Cyan
    Restart-Service -Name $service -Force
    # Wait until the server accepts connections
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        & "$bin\pg_isready.exe" -h 127.0.0.1 -p $Port | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
    }
    throw "Postgres did not become ready in time."
}

Write-Host "`n[1/5] Backing up pg_hba.conf (extra safety)..." -ForegroundColor Yellow
$stamp = (Get-Date).ToString('yyyy-MM-dd-HHmmss')
Copy-Item $hba "$hba.bak.$stamp" -Force
Write-Host "      Backup: $hba.bak.$stamp"

Write-Host "`n[2/5] Applying temporary 'trust' auth (restarting Postgres)..." -ForegroundColor Yellow
# pg_hba.conf was already switched to 'trust' on the two localhost lines.
# If for any reason it is not, force it now:
(Get-Content $hba) `
    -replace '^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)\S+', '$1trust' `
    -replace '^(host\s+all\s+all\s+::1/128\s+)\S+',        '$1trust' |
    Set-Content $hba -Encoding ascii
Restart-PG

Write-Host "`n[3/5] Setting postgres password and creating '$dbName' database..." -ForegroundColor Yellow
$env:PGPASSWORD = ''  # trust auth, no password needed
& $psql -U postgres -h 127.0.0.1 -p $Port -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD '$newPassword';"
# Create database only if it does not already exist (no data loss)
$exists = & $psql -U postgres -h 127.0.0.1 -p $Port -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName';"
if ($exists -ne '1') {
    & $psql -U postgres -h 127.0.0.1 -p $Port -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $dbName;"
    Write-Host "      Created database '$dbName'."
} else {
    Write-Host "      Database '$dbName' already exists - left untouched."
}

Write-Host "`n[4/5] Reverting pg_hba.conf to secure scram-sha-256 auth..." -ForegroundColor Yellow
(Get-Content $hba) `
    -replace '^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)\S+', '$1scram-sha-256' `
    -replace '^(host\s+all\s+all\s+::1/128\s+)\S+',        '$1scram-sha-256' |
    Set-Content $hba -Encoding ascii

Write-Host "`n[5/5] Restarting Postgres so secure auth takes effect..." -ForegroundColor Yellow
Restart-PG

Write-Host "`nVerifying new credentials..." -ForegroundColor Yellow
$env:PGPASSWORD = $newPassword
$check = & $psql -U postgres -h 127.0.0.1 -p $Port -d $dbName -tAc 'SELECT current_database();'
if ($check.Trim() -eq $dbName) {
    Write-Host "`n  SUCCESS!" -ForegroundColor Green
    Write-Host "  Database : $dbName"
    Write-Host "  User     : postgres"
    Write-Host "  Password : (the one you passed in)"
    Write-Host "  Next     : make sure DATABASE_URL in .env uses that same password."
} else {
    Write-Host "`n  Something went wrong - could not verify connection." -ForegroundColor Red
}

Write-Host "`nDone. You can close this window." -ForegroundColor Green
Read-Host "Press Enter to exit"
