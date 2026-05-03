# Pan Agents

**Pan Agents** is a Claude Code-style CLI for autonomous agent workflows powered by **0G Compute**, **0G Storage**, **ENS**, and **Gensyn AXL**. It provides an interactive shell where AI agents can execute tasks, generate reusable tools, learn from experience, and collaborate over a local peer-to-peer network.

## Features

- **Interactive REPL Shell** — A full-featured command-line interface with slash-command autocomplete, multi-line input support, and intelligent intent routing
- **Autonomous Task Execution** — Agents automatically generate, reuse, and improve tools to complete tasks using live data from public APIs
- **Self-Evolving Tool System** — Tools are generated on-demand, persisted to 0G Storage, and refined through adaptive memory and failure pattern tracking
- **Multi-Agent Networking (AXL)** — Run multiple agent instances that auto-discover each other, share tools, and exchange messages over a local Gensyn AXL-compatible network
- **ENS Identity** — Each agent binds to an ENS name for decentralized identity on the peer network
- **Intelligent Decision Routing** — LLM-powered intent classification routes user input to the right action: chat, task execution, tool management, or network operations
- **Root Cause Analysis** — Automatic failure categorization with actionable fix suggestions and persistent failure-pattern memory
- **Strategy Selection** — Experience-weighted tool selection with failure-risk scoring to avoid repeating mistakes
- **Secure Sandbox** — All generated tools run in an `isolated-vm` sandbox with controlled network access

## Architecture

```
src/
├── cli.ts                          # Entry point; Commander.js CLI definition
├── brain/                          # Decision & intent routing layer
│   ├── system-prompt.ts            # Decision brain system prompt + built-in tool catalog
│   ├── decide-action.ts            # LLM-powered intent classifier (OpenRouter / 0G)
│   ├── action-schema.ts            # Typed decision schema
│   ├── decision-guard.ts           # Safety guardrails for decision output
│   ├── zero-g-compute.ts           # 0G Compute chat completion adapter
│   └── refine-task.ts              # Task normalization & refinement
├── shell/                          # Interactive REPL
│   ├── repl.ts                     # Main read-eval-print loop with autocomplete
│   ├── prompt.ts                   # Prompt builder & welcome screen
│   ├── commands.ts                 # Slash-command registry & handler dispatch
│   ├── intent.ts                   # Intent-to-execution mapping
│   └── execute-decision.ts         # Decision result executor
├── runtime/                        # Agent runtime & core orchestration
│   ├── create-agent.ts             # Agent factory (wires all patches & plugins)
│   ├── run-task.ts                 # Task execution pipeline with verification
│   ├── axl.ts                      # Shared AXL client (discovery, messaging, tool exchange)
│   ├── local-axl-node.ts           # Embedded HTTP AXL node (peer discovery, tool serving)
│   ├── axl-autostart.ts            # Auto-spawns AXL node as background process
│   ├── tool-generator.ts           # Patched tool generation with failure-aware hints
│   ├── strategy-selector.ts        # Experience-weighted strategy selection w/ risk scoring
│   ├── adaptive-memory.ts          # Task similarity scoring + failure-pattern persistence
│   ├── root-cause-analysis.ts      # Failure categorization + suggested-fix engine
│   ├── tool-discovery.ts           # Tool discovery & registry integration
│   ├── tool-storage.ts             # Local tool storage backend
│   ├── patch-sandbox.ts            # Sandbox patches (error enrichment, retry logic)
│   ├── patch-evaluator.ts          # Tool evaluator smoke-test patches
│   ├── patch-ens.ts               # ENS sequential-write consistency patches
│   ├── execution-gate.ts           # Pre-execution safety gate
│   ├── output-validator.ts         # Post-execution result verification
│   ├── trace.ts                    # Structured trace logging
│   ├── step-logger.ts              # Per-step event logging
│   ├── quiet-console.ts            # Console noise suppression
│   ├── built-in-tools.ts           # Built-in tool implementations
│   └── system-prompt.ts            # Core agent behavior system prompt
├── commands/                       # CLI sub-commands
│   ├── agent.ts                    # Agent CRUD (create, list, show)
│   ├── ask.ts                      # One-off task execution
│   ├── doctor.ts                   # Health check & infrastructure validation
│   ├── eval.ts                     # Routing evaluation test suite
│   ├── identity.ts                 # ENS identity management
│   ├── init.ts                     # Project initialization
│   ├── model.ts                    # Decision model configuration
│   ├── network.ts                  # Network operations (status, send, share, import)
│   └── tools.ts                    # Tool listing, search, deletion
├── config/                         # Configuration layer
│   ├── schema.ts                   # Zod config schema (AXL, ENS, sandbox, decision provider)
│   ├── load-config.ts              # Config loader with defaults
│   └── paths.ts                    # File-system path resolution
├── agents/                         # Agent persistence
│   ├── store.ts                    # Agent JSON store (save, load, list)
│   └── schema.ts                   # Agent config Zod schema
├── identity/                       # Decentralized identity
│   └── ens.ts                      # ENS identity auto-detection & creation
└── evals/                          # Test suites
    ├── builtins.ts                 # Built-in tool evaluations
    └── routing.ts                  # Intent-routing regression tests
```

## Quick Start

### Prerequisites

- **Node.js** 22–24 (required for `isolated-vm` sandbox support)
- **pnpm** package manager
- A `.env` file with credentials (see [Configuration](#configuration))

### Installation

```bash
git clone <repo-url>
cd pan-agents
pnpm install
pnpm build
```

### Health Check

Validate your infrastructure before running:

```bash
pan doctor
```

Expected output:

```
PASS Pan config: .pan-agents/config.json loaded
PASS Node.js runtime: v24.15.0
PASS 0G private key: configured
PASS ENS private key: configured
PASS Sepolia RPC URL: configured
PASS ENS auto-detect: amir.eth
PASS Tool sandbox: isolated-vm available
PASS Gensyn AXL: reachable on port 9002
```

### Interactive Shell

```bash
pan
```

Inside the shell:

```
/help                          Show available commands
/status                        Agent & infrastructure status
/agent                         List or switch agents
/tools                         List generated tools
/network status                AXL identity & peer connections
/share <tool-name>            Share a tool with all peers
/import <tool-name>           Search peers & import a tool
/peers                         List connected agents
Return the number 2 as JSON    Execute a task
/exit                          Close the shell
```

Press `Ctrl+D` on an empty line or type `/exit` to close.

### One-off Tasks

Execute a single task without entering the shell:

```bash
pan ask --agent auto-agent "Return the number 2 as JSON"
```

## Multi-Agent Networking

Pan supports multiple agent instances that discover each other on localhost ports **9002–9010**.

**Terminal 1 — Primary agent:**

```bash
pan
```

**Terminal 2 — Secondary agent (on different port):**

```bash
AXL_PORT=9003 pan
```

Once connected:

| Command | Description |
|---|---|
| `/peers` | List connected agents and their tools |
| `/share <tool>` | Share a tool with all discovered peers |
| `/import <tool>` | Search peers for a tool and import it locally |
| `/network status` | Show AXL identity and peer connections |
| `/network messages` | Check received messages |
| `/network send <ens> <msg>` | Send a text message to a peer |

Imported tools are persisted locally and available immediately.

## CLI Reference

### Agent Management

```bash
pan agent list                              List all agents
pan agent show <name>                       Show agent details
pan agent create <name> \                   Create a new agent
  --description "..." \
  --capabilities "research,summarize"
```

### Identity

```bash
pan identity show <agent>                   Show ENS identity
pan identity publish <agent>                Publish ENS records
```

### Tools

```bash
pan tools list --agent <agent>              List persisted tools
pan tools search "<query>" --agent <agent>  Search tools by name/desc
```

### Network

```bash
pan network status                           Show AXL status & peers
pan network messages                          Drain message queue
pan network send <peer-ens> <message>        Send message to peer
pan network share-tool <tool-name>           Share tool via AXL
pan network import-tool <tool-name>          Import tool from peers
```

### Decision Model

```bash
pan model                                    Show current decision provider
pan model openrouter <model>                 Switch to OpenRouter (requires OPENROUTER_API_KEY)
pan model zero-g                             Switch to 0G Compute (uses ZERO_G_PRIVATE_KEY)
```

### Evaluation

```bash
pan eval                                     Run routing regression suite
```

## Configuration

### Environment Variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `ZERO_G_PRIVATE_KEY` | Yes | 0G private key for compute & storage |
| `ENS_PRIVATE_KEY` | Yes | ENS wallet private key for identity |
| `SEPOLIA_RPC_URL` | Yes | Sepolia RPC endpoint for ENS resolution |
| `OPENROUTER_API_KEY` | Optional* | OpenRouter API key (required if using OpenRouter decision model) |
| `AXL_PORT` | No | AXL listener port (default: `9002`) |

*Required when `decision.provider` is set to `openrouter`.

### Config File (`.pan-agents/config.json`)

```json
{
  "defaultAgent": "auto-agent",
  "axl": { "enabled": true, "port": 9002, "autoStart": true },
  "ens": { "enabled": true, "rpcUrl": "https://sepolia.drpc.org" },
  "sandbox": { "allowUnsafeNodeVmFallback": false },
  "decision": {
    "provider": "openrouter",
    "openRouterModel": "tencent/hy3-preview:free"
  }
}
```

Initialize config with:

```bash
pan init
```

## How It Works

1. **Intent Classification** — User input is sent to an LLM (OpenRouter or 0G Compute) which classifies it into one of 13 actions: chat responses, task execution, tool management, agent switching, network communication, etc.

2. **Task Execution** — For executable tasks, the agent selects a strategy:
   - **Reuse** an existing tool if experience shows it works for similar tasks
   - **Generate** a new tool if no good match exists or previous tools have high failure risk
   - Tools are generated as JavaScript functions with access to `fetch()` inside an `isolated-vm` sandbox

3. **Verification & Learning** — Results are validated against the original task. Failures trigger root cause analysis (API errors, wrong endpoints, bad ticker mappings, parse errors) which are recorded to a persistent failure-pattern file. Future generations use these patterns to avoid repeating mistakes.

4. **Persistence** — Successful tools and experience records are stored via 0G Storage and locally, making them available across sessions.

5. **Networking** — Each agent runs an embedded HTTP AXL node that advertises its ENS identity and tool registry. Peers auto-discover each other via port scanning, and can request/share tools or exchange messages.

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (ES2022, NodeNext modules) |
| Runtime | Node.js 22–24 |
| Agent Framework | `@zero-agents/core` (SelfEvolvingAgent) |
| Sandboxing | `isolated-vm` |
| CLI Framework | Commander.js |
| Validation | Zod |
| Networking | HTTP (local Gensyn AXL-compatible) |
| Identity | ENS on Sepolia via Viem |
| Storage | 0G Storage |
| Compute | 0G Compute / OpenRouter |
| Styling | Chalk, Ora |

## Development

```bash
# Build
pnpm build

# Type-check (without emitting)
pnpm typecheck

# Run in development mode
pnpm dev

# Run health check
pnpm doctor

# Run evaluation suite
pan eval
```

## Troubleshooting

| Issue | Solution |
|---|---|
| `isolated-vm` unavailable | Use Node 22 or 24; run via `pan.ps1` launcher which bundles a compatible runtime |
| AXL unreachable | Pan auto-starts a local node; check `.pan-agents/axl-{port}.log` for errors. Disable with `axl.autoStart: false` |
| ENS publish fails | Verify Sepolia RPC URL and ensure wallet has Sepolia ETH |
| Peers not found | Ensure the other agent terminal is running on a port in 9002–9010 |
| OpenRouter errors | Set `OPENROUTER_API_KEY` in `.env`, or switch to `pan model zero-g` |
| Decision routing seems off | Run `pan eval` to check routing regression results |

## License

MIT
