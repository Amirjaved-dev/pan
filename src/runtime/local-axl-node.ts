import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';

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

const SCAN_PORTS = [9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010];

type ToolEntry = { name: string; description: string; version?: string; code?: string; schema?: unknown; tags?: string[] };

async function resolveIdentity(): Promise<string> {
  const explicit = process.env.PAN_AGENT_ENS;
  if (explicit && explicit !== 'auto') return explicit;

  if (process.env.PAN_RESOLVE_ENS === 'true') {
    const key = process.env.ZERO_G_PRIVATE_KEY ?? process.env.ENS_PRIVATE_KEY ?? '';
    const rpc = process.env.SEPOLIA_RPC_URL ?? 'https://sepolia.drpc.org';
    if (key && key !== '0xYOUR_AGENT2_PRIVATE_KEY_HERE') {
      try {
        const { ENSIdentityManager } = await import('@zero-agents/core');
        const identity = await ENSIdentityManager.autoDetect(key, rpc);
        if (identity?.ensName) return identity.ensName;
        if (identity && 'address' in identity && typeof (identity as any).address === 'string') {
          const addr = (identity as any).address as string;
          return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
        }
      } catch { /* fall through */ }
    }
  }

  return `pan-local-${randomUUID().slice(0, 8)}`;
}

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

async function scanForPeers(myPort: number): Promise<Array<{ ens: string; port: number; url: string }>> {
  const results = await Promise.all(
    SCAN_PORTS
      .filter(p => p !== myPort)
      .map(async (p) => {
        try {
          const res = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(1000) });
          if (!res.ok) return null;
          const data = await res.json() as { ens?: string };
          return { ens: data.ens ?? `agent-${p}.eth`, port: p, url: `http://127.0.0.1:${p}` };
        } catch {
          return null;
        }
      }),
  );
  return results.filter((r): r is NonNullable<typeof r> => r != null);
}

async function loadTools(agentEns: string): Promise<Record<string, ToolEntry>> {
  const tools: Record<string, ToolEntry> = {};
  try {
    const { getAgentLocalToolStorePath, getAgentLocalRegistryPath } = await import('../config/paths.js');
    const agentSlug = process.env.PAN_DEFAULT_AGENT || 'auto-agent';
    const storePath = getAgentLocalToolStorePath(agentSlug);
    const registryPath = getAgentLocalRegistryPath(agentSlug);

    const [storeRaw, regRaw] = await Promise.all([
      readFile(storePath, 'utf8').catch(() => null),
      readFile(registryPath, 'utf8').catch(() => null),
    ]);

    if (storeRaw && regRaw) {
      const store = JSON.parse(storeRaw) as { blobs?: Record<string, Record<string, unknown>> };
      const reg = JSON.parse(regRaw) as { rootHash?: string };
      if (store.blobs?.[reg.rootHash ?? '']) {
        const index = store.blobs[reg.rootHash!] as Record<string, unknown>;
        for (const [name, hash] of Object.entries(index)) {
          if (name.startsWith('_') || typeof hash !== 'string' || !name.trim()) continue;
          const blob = store.blobs[hash];
          if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
            tools[name] = {
              name,
              description: typeof (blob as any).description === 'string' ? (blob as any).description : '',
              version: typeof (blob as any).version === 'string' ? (blob as any).version : undefined,
              code: typeof (blob as any).code === 'string' ? (blob as any).code : undefined,
              schema: (blob as any).schema,
              tags: Array.isArray((blob as any).tags) ? (blob as any).tags : undefined,
            };
          }
        }
      }
    }

    if (Object.keys(tools).length === 0) {
      try {
        const { config: loadEnv } = await import('dotenv');
        loadEnv();
        const { ToolRegistry } = await import('@zero-agents/core');
        const { requireEnv } = await import('../identity/ens.js');
        const { createLocalToolRegistryOptions } = await import('./tool-storage.js');

        const zeroGKey = process.env.ZERO_G_PRIVATE_KEY ?? '';
        if (zeroGKey && zeroGKey !== '0xYOUR_AGENT2_PRIVATE_KEY_HERE') {
          const registry = new ToolRegistry({
            ...createLocalToolRegistryOptions(agentSlug),
            zeroGPrivateKey: zeroGKey,
          });
          const results = await registry.searchTools('');
          for (const t of (results ?? [])) {
            const entry = t as unknown as Record<string, unknown>;
            const name = typeof entry.name === 'string' ? entry.name : '';
            if (!name || name in tools) continue;
            tools[name] = {
              name,
              description: typeof entry.description === 'string' ? entry.description : '',
              version: typeof entry.version === 'string' ? entry.version : undefined,
              code: typeof entry.code === 'string' ? entry.code : undefined,
              schema: entry.schema,
              tags: Array.isArray(entry.tags) ? entry.tags : undefined,
            };
          }
        }
      } catch { /* registry unavailable */ }
    }

    if (Object.keys(tools).length === 0) {
      try {
        const { getAgentExperiencePath } = await import('../config/paths.js');
        const expPath = getAgentExperiencePath(agentSlug);
        const expRaw = await readFile(expPath, 'utf8').catch(() => null);
        if (expRaw) {
          const exp = JSON.parse(expRaw) as { experiences?: Array<{ toolUsed?: string; task?: string; success?: boolean }> };
          for (const e of exp.experiences ?? []) {
            if (!e.success || !e.toolUsed || e.toolUsed in tools) continue;
            tools[e.toolUsed] = { name: e.toolUsed, description: e.task ?? '' };
          }
        }
      } catch { /* no experiences */ }
    }
  } catch { /* empty */ }
  return tools;
}

async function main() {
  const agentEns = await resolveIdentity();
  const peerId = agentEns;
  const messages: StoredMessage[] = [];
  const allTools = await loadTools(agentEns);
  const peerRegistry: Record<string, string> = {};

  async function refreshPeers(): Promise<void> {
    const found = await scanForPeers(port);
    for (const p of found) {
      peerRegistry[p.ens] = p.url;
    }
  }

  await refreshPeers();
  const refreshTimer = setInterval(refreshPeers, 5_000);

  async function forwardToPeer(targetEns: string, body: unknown): Promise<boolean> {
    const url = peerRegistry[targetEns];
    if (!url) return false;
    try {
      const res = await fetch(`${url}/recv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-from-ens': agentEns, 'x-from-peer-id': peerId, 'x-to-ens': targetEns },
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
      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, { ok: true, peerId, ens: agentEns });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/info') {
        writeJson(res, 200, { peerId, ens: agentEns, peers: Object.keys(peerRegistry) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/topology') {
        const knownPeers = Object.entries(peerRegistry).map(([ens, addr]) => ({ peerId: ens, address: addr, status: 'connected' }));
        writeJson(res, 200, { peerId, ens: agentEns, peers: knownPeers });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/messages') {
        writeJson(res, 200, messages.splice(0, messages.length));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/tools') {
        const toolList = Object.values(allTools)
          .filter(t => typeof t.name === 'string' && t.name.trim())
          .map(t => ({ name: t.name, description: t.description ?? '', version: t.version }));
        writeJson(res, 200, { tools: toolList, ens: agentEns });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/recv') {
        const msgBody = await readBody(req);
        const fromEns  = req.headers['x-from-ens']?.toString() ?? null;
        const fromPeer = req.headers['x-from-peer-id']?.toString() ?? fromEns ?? 'unknown';
        const toEns    = req.headers['x-to-ens']?.toString() ?? agentEns;

        messages.push({
          id: randomUUID(), fromPeerId: fromPeer, fromEns,
          toPeerId: toEns, message: msgBody, receivedAt: Date.now(),
        });

        if (msgBody && typeof msgBody === 'object' && (msgBody as any).type === 'tool_request') {
          const requestedTool = ((msgBody as any).tool as string ?? '').trim().toLowerCase();
          const senderEns = fromEns ?? '';

          setTimeout(async () => {
            let tool: ToolEntry | undefined;
            let matchedName = requestedTool;

            const exactMatch = Object.entries(allTools).find(([k]) => k.toLowerCase() === requestedTool);
            const fuzzyMatch = Object.entries(allTools).find(([k, v]) =>
              k.toLowerCase().includes(requestedTool) ||
              requestedTool.includes(k.toLowerCase()) ||
              (v.description ?? '').toLowerCase().includes(requestedTool),
            );
            if (exactMatch) { [matchedName, tool] = exactMatch; }
            else if (fuzzyMatch) { [matchedName, tool] = fuzzyMatch; }
            else if (Object.keys(allTools).length > 0) {
              const first = Object.entries(allTools)[0];
              [matchedName, tool] = first;
            }

            const reply = tool
              ? { type: 'tool_share', tool: matchedName, payload: tool, from: agentEns }
              : { type: 'tool_not_found', tool: requestedTool, reason: 'not in registry', from: agentEns };

            const ok = await forwardToPeer(senderEns, reply);
            if (!ok) {
              process.stdout.write(`[axl] could not reach ${senderEns} to send tool reply\n`);
            }
          }, 300);
        }

        if (msgBody && typeof msgBody === 'object' && 'type' in msgBody) {
          const msgType = (msgBody as any).type as string;
          if (msgType === 'tool_share') {
            const toolName = (msgBody as any).tool as string;
            process.stdout.write(`\n[axl] tool received: "${toolName}" from ${fromEns ?? fromPeer}\n`);
          }
        }

        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/send') {
        const msgBody = await readBody(req);
        const destEns = req.headers['x-destination-ens']?.toString() ?? null;

        messages.push({
          id: randomUUID(), fromPeerId: peerId, fromEns: agentEns,
          toPeerId: destEns, message: msgBody, receivedAt: Date.now(),
        });

        if (destEns) {
          const peerUrl = peerRegistry[destEns];
          if (!peerUrl) {
            process.stdout.write(`[axl] unknown peer "${destEns}"\n`);
            writeJson(res, 200, { ok: true, forwarded: false, reason: `unknown peer "${destEns}"` });
            return;
          }
          const ok = await forwardToPeer(destEns, msgBody);
          if (ok) {
            process.stdout.write(`[axl] -> ${destEns}\n`);
          } else {
            process.stdout.write(`[axl] send to ${destEns} failed\n`);
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
    process.stdout.write(`[axl] listening on 127.0.0.1:${port} as ${agentEns}\n`);
    const peerCount = Object.keys(peerRegistry).length;
    if (peerCount > 0) {
      process.stdout.write(`[axl] peers: ${Object.keys(peerRegistry).join(', ')}\n`);
    }
  });

  function shutdown(): void { clearInterval(refreshTimer); server.close(() => process.exit(0)); }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  process.stderr.write(`[axl] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
