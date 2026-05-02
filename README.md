# Pan Agents

Claude Code-style CLI for autonomous agent workflows powered by 0G Compute, 0G Storage, ENS, and Gensyn AXL.

## Quick Start

Open PowerShell in the project folder:

```powershell
cd "C:\Users\Amir\Desktop\pan agents"
```

Run the health check:

```powershell
.\pan.ps1 doctor
```

Expected result:

```text
PASS Pan config: .pan-agents/config.json loaded
PASS Node.js runtime: v24.15.0
PASS 0G private key: configured
PASS ENS private key: configured
PASS Sepolia RPC URL: configured
PASS ENS auto-detect: amir.eth
PASS Tool sandbox: isolated-vm available
PASS Gensyn AXL: reachable on port 9002
```

If no external AXL node is listening on port `9002`, Pan auto-starts a local AXL-compatible development node.

Start the interactive shell:

```powershell
.\pan.ps1
```

Inside the shell, type:

```text
/help
/status
/agent
/tools
/network
/share <tool-name>
/import <tool-name>
/peers
Return the number 2 as JSON
/exit
```

You can also press `Ctrl+D` on an empty prompt to close the interactive shell.

## Multi-Agent Networking

Pan supports running multiple agent instances that discover each other automatically.

**Terminal 1** — research agent:

```powershell
.\pan.ps1
```

**Terminal 2** — execute agent:

```powershell
.\pan2.ps1
```

Agents auto-discover peers on ports 9002-9010. Once connected:

- `/peers` — list connected agents and their tools
- `/share <tool-name>` — share a tool from your local store with all peers
- `/import <tool-name>` — search peers for a tool and import it locally
- `/request <tool-name>` — alias for `/import`
- `/network status` — show AXL identity and peer connections
- `/network messages` — check received messages
- `/network send <peer-ens> <message>` — send a text message to a peer

Tools are persisted to the local agent store and available immediately after import.

## CLI Commands

Run a one-off task:

```powershell
.\pan.ps1 ask --agent auto-agent "Return the number 2 as JSON"
```

Agent management:

```powershell
.\pan.ps1 agent list
.\pan.ps1 agent show auto-agent
.\pan.ps1 agent create research-agent --description "Research agent" --capabilities "research,summarize,compare"
```

ENS identity:

```powershell
.\pan.ps1 identity show auto-agent
.\pan.ps1 identity publish auto-agent
```

Tool management (persisted on 0G Storage):

```powershell
.\pan.ps1 tools list --agent auto-agent
.\pan.ps1 tools search "number" --agent auto-agent
.\pan.ps1 network share-tool <tool-name>
.\pan.ps1 network import-tool <tool-name>
```

Network:

```powershell
.\pan.ps1 network status
.\pan.ps1 network messages
.\pan.ps1 network send <peer-ens> <message>
```

Decision model:

```powershell
.\pan.ps1 model
.\pan.ps1 model openrouter tencent/hy3-preview:free
.\pan.ps1 model zero-g
```

OpenRouter mode requires `OPENROUTER_API_KEY`. 0G mode uses `ZERO_G_PRIVATE_KEY`.

## Architecture

- `src/runtime/axl.ts` — shared AXL client: peer discovery, tool exchange, message helpers
- `src/runtime/local-axl-node.ts` — local HTTP AXL node (auto-scans ports 9002-9010)
- `src/runtime/axl-autostart.ts` — spawns AXL node as background process with logging
- `src/commands/network.ts` — CLI network commands (status, send, share, import, messages)
- `src/shell/commands.ts` — REPL slash commands (/share, /import, /peers, /request, /network)
- `src/runtime/patch-sandbox.ts` — tool sandbox patches with HTTP error enrichment and EvolutionEngine retry

## Why Use `pan.ps1`?

Your system Node.js is newer than `isolated-vm` supports. Pan Agents needs Node.js 22 or 24 so the secure sandbox can load correctly.

The `pan.ps1` launcher automatically prepends this project-local Node runtime:

```text
.local-node\node-v24.15.0-win-x64
```

That makes commands work on this machine without changing global Node.js.

## Required Local Files

These are intentionally git-ignored because they contain local config or secrets:

```text
.env
.pan-agents/config.json
.pan-agents/agents/*.json
.local-node/
```

Your `.env` must include:

```text
ZERO_G_PRIVATE_KEY=...
ENS_PRIVATE_KEY=...
SEPOLIA_RPC_URL=...
AXL_PORT=9002
```

Do not add `ENS_NAME`; Pan auto-detects it from `ENS_PRIVATE_KEY`.

## If PowerShell Blocks The Script

If Windows says scripts are disabled, run this once in the same PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then retry:

```powershell
.\pan.ps1 doctor
```

## Troubleshooting

Run `.\pan.ps1 doctor` first. Fix the first failing check before running tasks.

- **Node runtime not 22 or 24**: keep `.local-node\node-v24.15.0-win-x64` in this project or install Node 24 globally.
- **`isolated-vm` unavailable**: run `.\pan.ps1 doctor` through the launcher, not plain `pnpm dev` with Node 25.
- **AXL unreachable**: Pan auto-starts a local node. Check `.pan-agents/axl-{port}.log` for errors.
- **To disable auto-start**: set `.pan-agents/config.json` `axl.autoStart` to `false`.
- **ENS publish fails**: verify Sepolia RPC and that the ENS wallet has Sepolia ETH.
- **Peers not found**: make sure the other terminal (`pan2.ps1`) is running and its port is in 9002-9010.

## Development

```powershell
corepack pnpm build
corepack pnpm typecheck
```

If you run pnpm directly, make sure Node 24 is first on PATH:

```powershell
$nodeDir = (Resolve-Path ".local-node\node-v24.15.0-win-x64").Path
$env:PATH = "$nodeDir;$env:PATH"
corepack pnpm typecheck
```
