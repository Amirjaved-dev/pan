# Pan Agents - Terminal 1

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localNode = Join-Path $projectRoot ".local-node\node-v24.15.0-win-x64"

if (Test-Path $localNode) {
  $env:PATH = "$localNode;$env:PATH"
}

$nodeVersion = (& node --version) 2>$null
if (-not $nodeVersion -or $nodeVersion -notmatch "^v(22|24)\.") {
  Write-Error "Pan Agents needs Node.js 22 or 24. Found: $nodeVersion. Install Node 24 or keep .local-node/node-v24.15.0-win-x64 in this project."
}

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
  corepack pnpm install
}

$envFile = Join-Path $projectRoot ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^\s*([^#=][^=]*)=(.*)$") {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim()
      [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
    }
  }
}

$env:PAN_AGENT_ENS = if ($env:AGENT1_ENS_NAME) { $env:AGENT1_ENS_NAME } else { "auto" }
$env:PAN_RESOLVE_ENS = if ($env:AGENT1_ENS_NAME) { "false" } else { "true" }

$stale = Get-NetTCPConnection -LocalPort 9002 -State Listen -ErrorAction SilentlyContinue
if ($stale) {
  $stalePid = $stale | Select-Object -ExpandProperty OwningProcess -First 1
  Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
  Write-Host "  Cleared stale AXL node (pid $stalePid) on port 9002" -ForegroundColor DarkGray
  Start-Sleep -Milliseconds 400
}

corepack pnpm exec tsx src/cli.ts @args
