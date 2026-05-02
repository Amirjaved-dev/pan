import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config/load-config.js';
import { getAgentLocalToolStorePath, getAgentLocalRegistryPath } from '../config/paths.js';

export type PeerInfo = {
  ens: string;
  port: number;
  url: string;
  connected: boolean;
  latencyMs: number;
};

export type ToolSharePayload = {
  name: string;
  description: string;
  version?: string;
  code?: string;
  schema?: unknown;
  tags?: string[];
  sourceAgent?: string;
  uses?: number;
};

export type ToolSummary = {
  name: string;
  description: string;
};

export type AxlMessage = {
  type: 'tool_request' | 'tool_share' | 'tool_not_found' | 'message' | 'mesh_handshake' | 'mesh_heartbeat' | 'mesh_leave';
  from: string;
  to?: string;
  id: string;
  timestamp: number;
};

const SCAN_PORTS = [9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010];

export async function getMyPort(): Promise<number> {
  const config = await loadConfig();
  return Number.parseInt(process.env.AXL_PORT ?? String(config.axl.port), 10);
}

export async function discoverPeers(retry = true): Promise<PeerInfo[]> {
  const myPort = await getMyPort();
  let peers: PeerInfo[] = await scanPorts(myPort);

  if (peers.length === 0 && retry) {
    await new Promise(r => setTimeout(r, 2000));
    peers = await scanPorts(myPort);
  }

  return peers;
}

async function scanPorts(myPort: number): Promise<PeerInfo[]> {
  const peers: PeerInfo[] = [];
  const checks = SCAN_PORTS
    .filter(p => p !== myPort)
    .map(async (port) => {
      const url = `http://127.0.0.1:${port}`;
      const start = Date.now();
      try {
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return null;
        const data = await res.json() as { ens?: string };
        return {
          ens: data.ens ?? `agent-${port}.eth`,
          port,
          url,
          connected: true,
          latencyMs: Date.now() - start,
        } satisfies PeerInfo;
      } catch {
        return null;
      }
    });

  const results = await Promise.all(checks);
  for (const r of results) {
    if (r) peers.push(r);
  }
  return peers;
}

export function createMessage(type: AxlMessage['type'], extra: Record<string, unknown> = {}): AxlMessage {
  return {
    type,
    from: process.env.PAN_AGENT_ENS ?? 'unknown',
    id: randomUUID(),
    timestamp: Date.now(),
    ...extra,
  };
}

export async function sendMessage(peerUrl: string, message: AxlMessage): Promise<boolean> {
  try {
    const res = await fetch(`${peerUrl}/recv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-from-ens': message.from },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendMessageToAxl(port: number, destinationEns: string, body: unknown): Promise<boolean> {
  const myEns = process.env.PAN_AGENT_ENS ?? 'unknown';
  const url = `http://localhost:${port}/send`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-destination-ens': destinationEns,
        'x-from-ens': myEns,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function drainMessages(port: number): Promise<Array<{ message: unknown; fromEns?: string }>> {
  try {
    const res = await fetch(`http://localhost:${port}/messages`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const msgs = await res.json() as Array<{ message: unknown; fromEns?: string }>;
    return msgs;
  } catch {
    return [];
  }
}

export async function getPeerTools(peer: PeerInfo): Promise<ToolSummary[]> {
  try {
    const res = await fetch(`${peer.url}/tools`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = await res.json() as { tools?: ToolSummary[] };
    return data.tools ?? [];
  } catch {
    return [];
  }
}

export async function requestToolFromPeer(peer: PeerInfo, toolName: string): Promise<ToolSharePayload | null> {
  const myPort = await getMyPort();
  const myEns = process.env.PAN_AGENT_ENS ?? '';

  await sendMessage(peer.url, createMessage('tool_request', {
    tool: toolName,
    to: peer.ens,
  }));

  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 800));
    const msgs = await drainMessages(myPort);
    const share = msgs.find(m => {
      const msg = m.message as Record<string, unknown> | null;
      return msg && msg.type === 'tool_share' && msg.tool === toolName;
    });
    if (share) {
      const msg = share.message as Record<string, unknown>;
      const inner = (msg.payload ?? msg) as Record<string, unknown>;
      return {
        name: (msg.tool as string) ?? (inner.name as string) ?? toolName,
        description: (inner.description as string) ?? '',
        version: inner.version as string | undefined,
        code: inner.code as string | undefined,
        schema: inner.schema,
        tags: Array.isArray(inner.tags) ? inner.tags as string[] : undefined,
        sourceAgent: msg.from as string | undefined,
      };
    }
  }

  return null;
}

export async function shareToolWithPeer(peer: PeerInfo, payload: ToolSharePayload): Promise<boolean> {
  return sendMessage(peer.url, createMessage('tool_share', {
    tool: payload.name,
    payload,
    to: peer.ens,
  }));
}

export async function getLocalToolNames(agentName: string): Promise<string[]> {
  const fromStore = await loadLocalToolsFromStore(agentName);
  const fromRegistry = await loadToolFromRegistry(agentName, null);
  return [...new Set([...Object.keys(fromStore), ...fromRegistry.map(t => t.name)])];
}

export async function loadLocalToolFromStore(agentName: string, toolName: string): Promise<ToolSharePayload | null> {
  const fromStore = await loadLocalToolsFromStore(agentName);
  const tool = fromStore[toolName];
  if (tool) {
    return {
      name: tool.name,
      description: tool.description ?? '',
      version: tool.version,
      code: tool.code,
      schema: tool.schema,
      tags: tool.tags,
      sourceAgent: process.env.PAN_AGENT_ENS,
    };
  }

  const fromRegistry = await loadToolFromRegistry(agentName, toolName);
  if (fromRegistry.length > 0) {
    const t = fromRegistry[0];
    return {
      name: typeof t.name === 'string' ? t.name : toolName,
      description: typeof t.description === 'string' ? t.description : '',
      version: typeof t.version === 'string' ? t.version : undefined,
      code: typeof t.code === 'string' ? t.code : undefined,
      schema: t.schema,
      tags: Array.isArray(t.tags) ? t.tags : undefined,
      sourceAgent: process.env.PAN_AGENT_ENS,
    };
  }

  if (toolName) {
    try {
      const { getAgentExperiencePath } = await import('../config/paths.js');
      const expRaw = await readFile(getAgentExperiencePath(agentName), 'utf8').catch(() => null);
      if (expRaw) {
        const exp = JSON.parse(expRaw) as { experiences?: Array<{ toolUsed?: string; task?: string; success?: boolean }> };
        const found = (exp.experiences ?? []).find(e => e.success && e.toolUsed?.toLowerCase() === toolName.toLowerCase());
        if (found) {
          return {
            name: found.toolUsed!,
            description: found.task ?? '',
            sourceAgent: process.env.PAN_AGENT_ENS,
          };
        }
      }
    } catch { /* no experiences */ }
  }

  return null;
}

type RegistryTool = { name: string; description?: string; version?: string; code?: string; schema?: unknown; tags?: unknown };

async function loadToolFromRegistry(agentName: string, toolName: string | null): Promise<RegistryTool[]> {
  try {
    const { config: loadEnv } = await import('dotenv');
    loadEnv();
    const { ToolRegistry } = await import('@zero-agents/core');
    const { requireEnv } = await import('../identity/ens.js');
    const { createLocalToolRegistryOptions } = await import('./tool-storage.js');
    const { withQuietConsole } = await import('./quiet-console.js');

    const zeroGKey = requireEnv('ZERO_G_PRIVATE_KEY');
    const registry = new ToolRegistry({
      ...createLocalToolRegistryOptions(agentName),
      zeroGPrivateKey: zeroGKey,
    });

    if (toolName) {
      const tool = await withQuietConsole(() => registry.getToolByName(toolName));
      return tool ? [tool as unknown as RegistryTool] : [];
    }

    const all = await withQuietConsole(() => registry.searchTools(''));
    return (all ?? []) as unknown as RegistryTool[];
  } catch {
    return [];
  }
}

type StoredToolEntry = {
  name: string;
  description?: string;
  version?: string;
  code?: string;
  schema?: unknown;
  tags?: string[];
};

async function loadLocalToolsFromStore(agentName: string): Promise<Record<string, StoredToolEntry>> {
  const storePath = getAgentLocalToolStorePath(agentName);
  const registryPath = getAgentLocalRegistryPath(agentName);
  const tools: Record<string, StoredToolEntry> = {};

  try {
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
          if (name.startsWith('_') || typeof hash !== 'string') continue;
          const blob = store.blobs[hash];
          if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
            tools[name] = {
              name,
              description: typeof (blob as any).description === 'string' ? (blob as any).description : undefined,
              version: typeof (blob as any).version === 'string' ? (blob as any).version : undefined,
              code: typeof (blob as any).code === 'string' ? (blob as any).code : undefined,
              schema: (blob as any).schema,
              tags: Array.isArray((blob as any).tags) ? (blob as any).tags : undefined,
            };
          }
        }
      }
    }
  } catch { /* empty */ }

  return tools;
}
