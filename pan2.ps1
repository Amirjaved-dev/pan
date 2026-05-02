# Pan Agents - Terminal 2 (execute-agent.eth)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localNode = Join-Path $projectRoot ".local-node\node-v24.15.0-win-x64"

if (Test-Path $localNode) {
  $env:PATH = "$localNode;$env:PATH"
}

$nodeVersion = (& node --version) 2>$null
if (-not $nodeVersion -or $nodeVersion -notmatch "^v(22|24)\.") {
  Write-Error "Pan Agents needs Node.js 22 or 24. Found: $nodeVersion"
}

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
  corepack pnpm install
}

# Load .env
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

# Agent 2 overrides
if ($env:AGENT2_AXL_PORT)    { $env:AXL_PORT          = $env:AGENT2_AXL_PORT } else { $env:AXL_PORT = "9003" }
if ($env:AGENT2_PRIVATE_KEY) { $env:ZERO_G_PRIVATE_KEY = $env:AGENT2_PRIVATE_KEY }
if ($env:AGENT2_PRIVATE_KEY) { $env:ENS_PRIVATE_KEY    = $env:AGENT2_PRIVATE_KEY }

# Use AGENT2_ENS_NAME directly if set, else try on-chain detection
if ($env:AGENT2_ENS_NAME) {
  $env:PAN_AGENT_ENS = $env:AGENT2_ENS_NAME
} else {
  $env:PAN_AGENT_ENS = "auto"
  $env:PAN_RESOLVE_ENS = "true"
}

$env:PAN_DEFAULT_AGENT = "execute-agent"

# Kill stale AXL node on port 9003
$stale = Get-NetTCPConnection -LocalPort $env:AXL_PORT -State Listen -ErrorAction SilentlyContinue
if ($stale) {
  $stalePid = $stale | Select-Object -ExpandProperty OwningProcess -First 1
  Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
  Write-Host "  Cleared stale AXL node (pid $stalePid)" -ForegroundColor DarkGray
  Start-Sleep -Milliseconds 400
}

Write-Host ""
Write-Host "  Pan Agents - Terminal 2" -ForegroundColor Cyan
Write-Host "  ENS      : $($env:PAN_AGENT_ENS)" -ForegroundColor Green
Write-Host "  AXL Port : $($env:AXL_PORT)" -ForegroundColor Gray
Write-Host ""

corepack pnpm exec tsx src/cli.ts @args
