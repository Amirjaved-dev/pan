import { randomUUID } from 'node:crypto';

export type MeshMessageType =
  | 'mesh_handshake'
  | 'mesh_heartbeat'
  | 'mesh_leave'
  | 'tool_share'
  | 'tool_request'
  | 'tool_ack'
  | 'tool_list';

export type MeshMessage = {
  type: MeshMessageType;
  fromEns?: string;
  toEns?: string;
  timestamp: number;
  id: string;
} & Record<string, unknown>;

export type ToolSharePayload = {
  name: string;
  version?: string;
  description: string;
  code?: string;
  schema?: { input?: Record<string, unknown>; output?: Record<string, unknown> };
  tags?: string[];
  runtime?: string;
  sourceAgent?: string;
  uses?: number;
  qualityScore?: number;
};

export type PeerInfo = {
  ens: string;
  port: number;
  url: string;
  connected: boolean;
  latencyMs: number;
  lastSeen: number;
  tools: Array<{ name: string; description: string; uses?: number }>;
};

export function createMeshMessage(type: MeshMessageType, extra: Record<string, unknown> = {}): MeshMessage {
  return {
    type,
    fromEns: process.env.PAN_AGENT_ENS ?? undefined,
    timestamp: Date.now(),
    id: randomUUID(),
    ...extra,
  };
}

export function createToolSharePayload(tool: {
  name: string;
  description: string;
  code?: string;
  schema?: { input?: Record<string, unknown>; output?: Record<string, unknown> };
  tags?: string[];
  uses?: number;
  qualityScore?: number;
}): ToolSharePayload {
  return {
    name: tool.name,
    description: tool.description,
    code: tool.code,
    schema: tool.schema,
    tags: tool.tags,
    runtime: 'node',
    sourceAgent: process.env.PAN_AGENT_ENS ?? undefined,
    uses: tool.uses,
    qualityScore: tool.qualityScore,
  };
}

export async function discoverPeers(): Promise<PeerInfo[]> {
  const peers: PeerInfo[] = [];

  const agent1Ens = process.env.AGENT1_ENS_NAME;
  const agent1Port = process.env.AGENT1_AXL_PORT;
  const agent2Ens = process.env.AGENT2_ENS_NAME;
  const agent2Port = process.env.AGENT2_AXL_PORT;

  const myPort = Number.parseInt(process.env.AXL_PORT ?? '9002', 10);
  const myEns = process.env.PAN_AGENT_ENS ?? '';

  const candidates: Array<{ ens: string; portStr: string }> = [];
  if (agent1Ens && agent1Port) candidates.push({ ens: agent1Ens, portStr: agent1Port });
  if (agent2Ens && agent2Port) candidates.push({ ens: agent2Ens, portStr: agent2Port });

  for (const candidate of candidates) {
    const port = Number.parseInt(candidate.portStr, 10);
    if (port === myPort || candidate.ens.toLowerCase() === myEns.toLowerCase()) continue;

    const url = `http://127.0.0.1:${port}`;
    const start = Date.now();
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      const latency = Date.now() - start;
      if (res.ok) {
        const health = await res.json() as { ens?: string; peerId?: string };
        peers.push({
          ens: health.ens ?? candidate.ens,
          port,
          url,
          connected: true,
          latencyMs: latency,
          lastSeen: Date.now(),
          tools: [],
        });
      }
    } catch {
      peers.push({
        ens: candidate.ens,
        port,
        url,
        connected: false,
        latencyMs: -1,
        lastSeen: 0,
        tools: [],
      });
    }
  }

  return peers;
}

export async function sendMeshMessage(peerUrl: string, message: MeshMessage): Promise<boolean> {
  try {
    const res = await fetch(`${peerUrl}/recv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-from-ens': message.fromEns ?? '', 'x-to-ens': message.toEns ?? '' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function requestPeerTools(peerUrl: string, myEns: string): Promise<Array<{ name: string; description: string }>> {
  try {
    const msg = createMeshMessage('tool_list', { toEns: myEns });
    await sendMeshMessage(peerUrl, msg);

    const res = await fetch(`${peerUrl}/tools`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json() as { tools?: Array<{ name: string; description: string }> };
    return data.tools ?? [];
  } catch {
    return [];
  }
}

export async function sendHandshake(peerUrl: string, myEns: string): Promise<{ ok: boolean; peerEns?: string; tools?: Array<{ name: string; description: string }> }> {
  try {
    const msg = createMeshMessage('mesh_handshake', { toEns: myEns });
    const sent = await sendMeshMessage(peerUrl, msg);
    if (!sent) return { ok: false };

    await new Promise(r => setTimeout(r, 300));

    const res = await fetch(`${peerUrl}/tools`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: true, peerEns: undefined };

    const data = await res.json() as { ens?: string; tools?: Array<{ name: string; description: string }> };
    return { ok: true, peerEns: data.ens, tools: data.tools ?? [] };
  } catch {
    return { ok: false };
  }
}

export async function sendHeartbeat(peerUrl: string, myEns: string): Promise<boolean> {
  const msg = createMeshMessage('mesh_heartbeat');
  return sendMeshMessage(peerUrl, msg);
}

export async function sendLeave(peerUrl: string, myEns: string): Promise<boolean> {
  const msg = createMeshMessage('mesh_leave');
  return sendMeshMessage(peerUrl, msg);
}
