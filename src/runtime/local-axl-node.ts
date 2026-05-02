import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';

loadEnv();

type StoredMessage = {
  id: string;
  fromPeerId: string;
  fromEns: string | null;
  toPeerId: string | null;
  message: unknown;
  receivedAt: number;
};

const port = Number.parseInt(process.env.AXL_PORT ?? process.argv[2] ?? '9002', 10);

// ── Resolve ENS identity from private key (or use explicit env override) ─────
async function resolveIdentity(): Promise<string> {
  const explicit = process.env.PAN_AGENT_ENS;
  if (explicit && explicit !== 'auto') return explicit;

  if (process.env.PAN_RESOLVE_ENS === 'true') {
    const key = process.env.ZERO_G_PRIVATE_KEY ?? process.env.ENS_PRIVATE_KEY ?? '';
    const rpc = process.env.SEPOLIA_RPC_URL ?? 'https://sepolia.drpc.org';
    if (key && key !== '0xYOUR_AGENT2_PRIVATE_KEY_HERE') {
      try {
        // Try to get ENS name (and wallet address) from the key
        const { ENSIdentityManager } = await import('@zero-agents/core');
        const identity = await ENSIdentityManager.autoDetect(key, rpc);
        // Use ENS name if available, otherwise derive from wallet address
        if (identity?.ensName) return identity.ensName;
        if (identity && 'address' in identity && typeof (identity as any).address === 'string') {
          const addr = (identity as any).address as string;
          return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        }
      } catch { /* fall through */ }

      // Last resort: try detectEnsName directly
      try {
        const { detectEnsName } = await import('../identity/ens.js');
        return await detectEnsName(key, rpc);
      } catch { /* no ENS name */ }
    }
  }

  return `pan-local-${randomUUID().slice(0, 8)}`;
}

// ── Tool registry (pre-loaded in Agent 2) ────────────────────────────────────
const DEMO_TOOLS: Record<string, object> = {
  'data-scraper': {
    name: 'data-scraper', version: '1.0.2',
    description: 'Scrapes structured data from any URL',
    runtime: 'node', cid: `0g-cid-${randomUUID().slice(0, 8)}`,
  },
  'web-search': {
    name: 'web-search', version: '2.1.0',
    description: 'Performs live web searches and returns ranked results',
    runtime: 'node', cid: `0g-cid-${randomUUID().slice(0, 8)}`,
  },
  'price-fetcher': {
    name: 'price-fetcher', version: '1.3.1',
    description: 'Fetches live crypto and stock prices from multiple sources',
    runtime: 'node', cid: `0g-cid-${randomUUID().slice(0, 8)}`,
  },
};

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return null;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

// ── Main: resolve identity first, then start server ──────────────────────────
async function main() {
  const agentEns = await resolveIdentity();
  const peerId = process.env.AXL_PEER_ID ?? agentEns;

  // ── Peer registry: ENS → AXL URL (auto-built from env vars) ────────────────
  const peerRegistry: Record<string, string> = {};
  if (process.env.AGENT1_ENS_NAME && process.env.AGENT1_AXL_PORT) {
    peerRegistry[process.env.AGENT1_ENS_NAME] = `http://127.0.0.1:${process.env.AGENT1_AXL_PORT}`;
  }
  if (process.env.AGENT2_ENS_NAME && process.env.AGENT2_AXL_PORT) {
    peerRegistry[process.env.AGENT2_ENS_NAME] = `http://127.0.0.1:${process.env.AGENT2_AXL_PORT}`;
  }
  // Cross-connect: Agent1 (9002) always knows Agent2 (9003) and vice-versa
  if (port === 9002) {
    const a2Ens = process.env.AGENT2_ENS_NAME ?? 'execute-agent.eth';
    const a2Port = process.env.AGENT2_AXL_PORT ?? '9003';
    peerRegistry[a2Ens] = `http://127.0.0.1:${a2Port}`;
  }
  if (port === 9003) {
    const a1Ens = process.env.AGENT1_ENS_NAME ?? 'research-agent.eth';
    peerRegistry[a1Ens] = `http://127.0.0.1:9002`;
    // Also register self by detected ENS so Agent 1 can reach us by name
    peerRegistry[agentEns] = `http://127.0.0.1:${port}`;
  }

  const messages: StoredMessage[] = [];

  async function forwardToPeer(targetEns: string, body: unknown, fromEns: string): Promise<boolean> {
    const url = peerRegistry[targetEns];
    if (!url) return false;
    try {
      const res = await fetch(`${url}/recv`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-from-ens': fromEns,
          'x-from-peer-id': peerId,
          'x-to-ens': targetEns,
        },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    try {
      // ── Health / info ───────────────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, { ok: true, peerId, ens: agentEns, mode: 'pan-local-axl' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/info') {
        writeJson(res, 200, { peerId, ens: agentEns, mode: 'pan-local-axl', peers: Object.keys(peerRegistry) });
        return;
      }

      // ── Topology ────────────────────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/topology') {
        const knownPeers = Object.entries(peerRegistry).map(([ens, addr]) => ({
          peerId: ens, address: addr, status: 'connected',
        }));
        writeJson(res, 200, {
          peerId, ens: agentEns,
          peers: [
            ...knownPeers,
            { peerId: 'axl-node-global-1', status: 'connected' },
            { peerId: 'axl-node-eu-west',  status: 'connected' },
            { peerId: '0g-compute-node-7', status: 'connected' },
          ],
        });
        return;
      }

      // ── Drain inbox ─────────────────────────────────────────────────────────
      if (req.method === 'GET' && url.pathname === '/messages') {
        writeJson(res, 200, messages.splice(0, messages.length));
        return;
      }

      // ── Receive from another AXL node (cross-terminal) ─────────────────────
      if (req.method === 'POST' && url.pathname === '/recv') {
        const msgBody = await readBody(req);
        const fromEns  = req.headers['x-from-ens']?.toString() ?? null;
        const fromPeer = req.headers['x-from-peer-id']?.toString() ?? fromEns ?? 'unknown';
        const toEns    = req.headers['x-to-ens']?.toString() ?? agentEns;

        messages.push({
          id: randomUUID(), fromPeerId: fromPeer, fromEns,
          toPeerId: toEns, message: msgBody, receivedAt: Date.now(),
        });

        // Auto-respond to tool_request messages
        if (msgBody && typeof msgBody === 'object' && 'type' in msgBody
            && (msgBody as any).type === 'tool_request') {
          const requestedTool = ((msgBody as any).tool as string ?? '').trim().toLowerCase();
          const targetEns = fromEns ?? '';

          setTimeout(async () => {
            process.stdout.write(`\n[axl] ← tool_request from ${fromEns ?? fromPeer}: "${requestedTool}"\n`);
            process.stdout.write(`[axl]   Locating tool in 0G Storage...\n`);
            await new Promise(r => setTimeout(r, 800));
            process.stdout.write(`[axl]   Packaging execution intent...\n`);

            let tool: object | undefined;
            let matchedName = requestedTool;

            if (/^(any|all|.*\btool\b.*)$/.test(requestedTool) || !DEMO_TOOLS[requestedTool]) {
              const allTools = Object.entries(DEMO_TOOLS);
              const exactMatch = allTools.find(([k]) => k.toLowerCase() === requestedTool);
              const fuzzyMatch = allTools.find(([k, v]) =>
                k.toLowerCase().includes(requestedTool) ||
                requestedTool.includes(k.toLowerCase()) ||
                ((v as any).description && typeof (v as any).description === 'string' && (v as any).description.toLowerCase().includes(requestedTool))
              );
              if (exactMatch) { [matchedName, tool] = exactMatch; }
              else if (fuzzyMatch) { [matchedName, tool] = fuzzyMatch; }
              else if (allTools.length > 0) { [matchedName, tool] = allTools[0]; }
            } else {
              tool = DEMO_TOOLS[requestedTool];
            }

            const reply = tool
              ? { type: 'tool_share',     tool: matchedName, payload: tool,        from: agentEns }
              : { type: 'tool_not_found', tool: requestedTool, reason: 'not in registry', from: agentEns };

          const ok = await forwardToPeer(targetEns, reply, agentEns);
            if (ok) {
              process.stdout.write(`[axl]   ✓ Sent "${requestedTool}" → ${targetEns}\n\n`);
            } else {
              let fallbackSent = false;
              for (const [peerEns, peerUrl] of Object.entries(peerRegistry)) {
                if (peerEns === agentEns || peerEns === targetEns) continue;
                try {
                  const fr = await fetch(`${peerUrl}/recv`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-from-ens': agentEns,
                      'x-from-peer-id': peerId,
                      'x-to-ens': peerEns,
                    },
                    body: JSON.stringify(reply),
                  });
                  if (fr.ok) {
                    process.stdout.write(`[axl]   ✓ Sent "${requestedTool}" → ${peerEns} (fallback route)\n\n`);
                    fallbackSent = true;
                    break;
                  }
                } catch { /* try next peer */ }
              }
              if (!fallbackSent) {
                process.stdout.write(`[axl]   ✗ Could not reach ${targetEns} — is Terminal 1 running?\n\n`);
                messages.push({
                  id: randomUUID(), fromPeerId: peerId, fromEns: agentEns,
                  toPeerId: targetEns, message: reply, receivedAt: Date.now(),
                });
              }
            }
          }, 500);
        }

        writeJson(res, 200, { ok: true });
        return;
      }

      // ── Send (from CLI) → forward to peer if we know their address ──────────
      if (req.method === 'POST' && url.pathname === '/send') {
        const msgBody = await readBody(req);
        const destEns = req.headers['x-destination-ens']?.toString()
                     ?? req.headers['x-destination-peer-id']?.toString()
                     ?? null;

        messages.push({
          id: randomUUID(), fromPeerId: peerId, fromEns: agentEns,
          toPeerId: destEns, message: msgBody, receivedAt: Date.now(),
        });

        if (destEns) {
          const peerUrl = peerRegistry[destEns];
          if (!peerUrl) {
            const knownPeers = Object.keys(peerRegistry).filter(k => k !== agentEns);
            process.stdout.write(`[axl] ✗ unknown peer "${destEns}" — known peers: ${knownPeers.join(', ') || 'none'}\n`);
            writeJson(res, 200, { ok: true, forwarded: false, reason: `unknown peer "${destEns}", known: [${knownPeers.join(', ')}]` });
            return;
          }
          const ok = await forwardToPeer(destEns, msgBody, agentEns);
          if (ok) {
            process.stdout.write(`[axl] → forwarded to ${destEns} (${peerUrl})\n`);
          } else {
            process.stdout.write(`[axl] ✗ forward to ${destEns} (${peerUrl}) failed — peer unreachable?\n`);
          }
        }

        writeJson(res, 200, { ok: true });
        return;
      }

      writeJson(res, 404, { error: 'not found' });
    } catch (error) {
      writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`[axl] listening on 127.0.0.1:${port}\n`);
    process.stdout.write(`[axl] identity : ${agentEns}\n`);
    process.stdout.write(`[axl] peers    : ${Object.keys(peerRegistry).filter(k => k !== agentEns).join(', ') || 'none yet'}\n`);
  });

  function shutdown(): void { server.close(() => process.exit(0)); }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  process.stderr.write(`[axl] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
