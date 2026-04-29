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

corepack pnpm exec tsx src/cli.ts @args
