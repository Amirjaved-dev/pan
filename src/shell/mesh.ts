import chalk from 'chalk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import * as readlineCore from 'node:readline';
import { loadConfig } from '../config/load-config.js';
import { getAgentExperiencePath, getAgentLocalToolStorePath, getAgentLocalRegistryPath } from '../config/paths.js';
import { ensureAxlRunning } from '../runtime/axl-autostart.js';
import { discoverPeers, sendMeshMessage, createMeshMessage, sendHandshake, sendHeartbeat, sendLeave, type PeerInfo, type ToolSharePayload, createToolSharePayload } from '../runtime/mesh-protocol.js';

type LocalTool = {
  name: string;
  description: string;
  uses: number;
  lastTask?: string;
};

type ActivityEntry = {
  time: string;
  text: string;
  type: 'send' | 'receive' | 'error' | 'info' | 'system';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function loadLocalTools(agentName: string): Promise<LocalTool[]> {
  const expPath = getAgentExperiencePath(agentName);
  try {
    const raw = await readFile(expPath, 'utf8');
    const parsed = JSON.parse(raw) as { experiences?: Array<{ toolUsed?: string; task?: string; success?: boolean; createdAt?: number }> };
    const tools = new Map<string, LocalTool>();
    const lastTs = new Map<string, number>();

    for (const exp of parsed.experiences ?? []) {
      if (!exp.success || !exp.toolUsed) continue;
      const current = tools.get(exp.toolUsed) ?? { name: exp.toolUsed, description: '', uses: 0 };
      current.uses += 1;
      const prevTs = lastTs.get(exp.toolUsed) ?? 0;
      if (!current.lastTask || (exp.createdAt ?? 0) > prevTs) {
        current.lastTask = exp.task;
        lastTs.set(exp.toolUsed, exp.createdAt ?? 0);
      }
      tools.set(exp.toolUsed, current);
    }

    return Array.from(tools.values()).sort((a, b) => b.uses - a.uses);
  } catch {
    return [];
  }
}

async function loadToolDetails(agentName: string): Promise<Map<string, { description: string; code?: string; schema?: unknown }>> {
  const storePath = getAgentLocalToolStorePath(agentName);
  const registryPath = getAgentLocalRegistryPath(agentName);
  const details = new Map<string, { description: string; code?: string; schema?: unknown }>();

  try {
    const [storeRaw, regRaw] = await Promise.all([
      readFile(storePath, 'utf8').catch(() => null),
      readFile(registryPath, 'utf8').catch(() => null),
    ]);

    if (storeRaw && regRaw) {
      const store = JSON.parse(storeRaw) as { blobs?: Record<string, Record<string, unknown>> };
      const reg = JSON.parse(regRaw) as { rootHash?: string };

      if (isRecord(store.blobs) && reg.rootHash && isRecord(store.blobs[reg.rootHash])) {
        const index = store.blobs[reg.rootHash];
        for (const [name, hash] of Object.entries(index)) {
          if (name.startsWith('_')) continue;
          if (typeof hash === 'string' && isRecord(store.blobs[hash])) {
            const blob = store.blobs[hash];
            details.set(name, {
              description: typeof blob.description === 'string' ? blob.description : '',
              code: typeof blob.code === 'string' ? blob.code : undefined,
              schema: blob.schema,
            });
          }
        }
      }
    }
  } catch { /* no details available */ }

  return details;
}

async function importReceivedTool(agentName: string, payload: ToolSharePayload): Promise<boolean> {
  try {
    const storePath = getAgentLocalToolStorePath(agentName);
    const registryPath = getAgentLocalRegistryPath(agentName);
    const expPath = getAgentExperiencePath(agentName);

    const storeRaw = await readFile(storePath, 'utf8').catch(() => null);
    const store: { blobs?: Record<string, Record<string, unknown>> } = storeRaw ? JSON.parse(storeRaw) : { blobs: {} };
    if (!store.blobs) store.blobs = {};

    const toolBlob: Record<string, unknown> = {
      name: payload.name,
      description: payload.description,
      version: payload.version ?? '1.0.0',
      code: payload.code,
      schema: payload.schema,
      tags: payload.tags ?? [],
      runtime: payload.runtime ?? 'node',
      sourceAgent: payload.sourceAgent,
      importedAt: Date.now(),
    };

    const blobHash = 'imported-' + createHash('sha256').update(JSON.stringify(toolBlob)).digest('hex').slice(0, 16);
    store.blobs[blobHash] = toolBlob;

    let indexHash: string | null = null;
    const regRaw = await readFile(registryPath, 'utf8').catch(() => null);
    if (regRaw) {
      const reg = JSON.parse(regRaw) as { rootHash?: string };
      indexHash = reg.rootHash ?? null;
    }

    const idxHash = indexHash ?? ('idx-' + createHash('sha256').update(agentName + Date.now()).digest('hex').slice(0, 16));
    if (!store.blobs[idxHash]) {
      store.blobs[idxHash] = { _meta: { updatedAt: Date.now(), count: 0 } };
    }

    const index = store.blobs[idxHash] as Record<string, unknown>;
    index[payload.name] = blobHash;

    const metaCount = Object.keys(index).filter(k => !k.startsWith('_')).length;
    (index as any)._meta = { updatedAt: Date.now(), count: metaCount };

    await mkdir(dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
    await mkdir(dirname(registryPath), { recursive: true });
    await writeFile(registryPath, JSON.stringify({ rootHash: idxHash }, null, 2) + '\n', 'utf8');

    const expRaw = await readFile(expPath, 'utf8').catch(() => null);
    const experiences = expRaw ? JSON.parse(expRaw) : { experiences: [] };
    if (!Array.isArray(experiences.experiences)) experiences.experiences = [];
    experiences.experiences.push({
      toolUsed: payload.name,
      task: `Imported from ${payload.sourceAgent ?? 'mesh peer'}`,
      success: true,
      qualityScore: payload.qualityScore ?? 0.8,
      createdAt: Date.now(),
    });
    await mkdir(dirname(expPath), { recursive: true });
    await writeFile(expPath, JSON.stringify(experiences, null, 2) + '\n', 'utf8');

    return true;
  } catch {
    return false;
  }
}

// ── ANSI TUI helpers ──────────────────────────────────────────────────

const ESC = '\x1B';
const CLEAR = ESC + '[2J' + ESC + '[H';
const HIDE_CURSOR = ESC + '[?25l';
const SHOW_CURSOR = ESC + '[?25h';
const RESET = ESC + '[0m';

function fg(color: number): string { return ESC + `[38;5;${color}m`; }
function bg(color: number): string { return ESC + `[48;5;${color}m`; }
const BOLD = ESC + '[1m';
const DIM = ESC + '[2m';

const C = {
  orange: 208,
  cyan: 81,
  green: 82,
  yellow: 220,
  red: 203,
  gray: 245,
  darkGray: 240,
  white: 255,
  blue: 111,
};

function drawBox(lines: string[], width: number, title?: string, borderColor?: number): string[] {
  const bc = borderColor !== undefined ? fg(borderColor) : '';
  const w = Math.max(width, 10);
  const top = title
    ? bc + '┌' + BOLD + fg(C.orange) + ' ' + title.padEnd(w - 2) + RESET + bc + '┐'
    : bc + '┌' + '─'.repeat(w - 2) + '┐';
  const bot = bc + '└' + '─'.repeat(w - 2) + '┘';
  const padded = lines.map(l => bc + '│ ' + RESET + l + RESET + ' '.repeat(Math.max(0, w - l.length - 4)) + bc + ' │');
  return [top, ...padded, bot];
}

export async function startMesh(): Promise<void> {
  const config = await loadConfig();
  const agentName = process.env.PAN_DEFAULT_AGENT ?? config.defaultAgent;
  const myEns = process.env.PAN_AGENT_ENS ?? '';
  const myPort = Number.parseInt(process.env.AXL_PORT ?? String(config.axl.port), 10);

  if (config.axl.enabled) {
    await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  }

  if (!process.stdin.isTTY) {
    throw new Error('Mesh requires an interactive terminal.');
  }

  const tools = await loadLocalTools(agentName);
  const toolDetails = await loadToolDetails(agentName);

  for (const tool of tools) {
    const detail = toolDetails.get(tool.name);
    if (detail?.description) tool.description = detail.description;
  }

  let peers = await discoverPeers();
  const activities: ActivityEntry[] = [];
  let selectedPanel: 'local' | 'peer' = 'local';
  let selectedIndex = 0;
  let running = true;

  function addActivity(text: string, type: ActivityEntry['type'] = 'info'): void {
    const now = new Date();
    activities.unshift({ time: now.toLocaleTimeString('en-US', { hour12: false }).slice(0, 5), text, type });
    if (activities.length > 50) activities.length = 50;
  }

  function render(): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    const halfW = Math.floor(cols / 2);
    const panelH = rows - 11;

    // Header
    const headerLines = [
      '',
      `  ${fg(C.orange)}▄▀▄${RESET}  ${BOLD}${fg(C.orange)}Pan Mesh${RESET}${DIM}${fg(C.gray)}  v0.1.0 · zero-g · AXL tool exchange${RESET}`,
      `  ${fg(C.gray)}${myEns || agentName}${RESET} ${fg(C.gray)}· port ${myPort}${RESET}   ${peers.length > 0 && peers[0].connected ? fg(C.green) + '● Connected' + (peers[0].latencyMs > 0 ? ' ' + peers[0].latencyMs + 'ms' : '') : peers.length > 0 ? fg(C.yellow) + '○ offline' : fg(C.gray) + '○ No peer'}${RESET}`,
    ];

    // Local panel
    const localLines: string[] = [''];
    if (tools.length === 0) {
      localLines.push(`  ${fg(C.gray)}No tools yet.${RESET}`);
      localLines.push(`  ${fg(C.gray)}Run tasks to generate tools.${RESET}`);
    } else {
      for (let i = 0; i < Math.min(tools.length, panelH - 3); i++) {
        const t = tools[i];
        const marker = selectedPanel === 'local' && i === selectedIndex ? `${fg(C.orange)}▸${RESET}` : ' ';
        const nm = selectedPanel === 'local' && i === selectedIndex ? `${BOLD}${fg(C.white)}${t.name}${RESET}` : `${fg(C.green)}${t.name}${RESET}`;
        localLines.push(`${marker} ${nm}`);
        localLines.push(`    ${fg(C.darkGray)}${t.description || '(no description)'}${RESET}`);
        localLines.push(`    ${fg(C.darkGray)}Uses: ${t.uses}${RESET}`);
        localLines.push('');
      }
    }

    // Peer panel
    const peerTools = (peers.length > 0 ? peers[0].tools : []).map(t => ({ name: t.name, description: t.description, uses: t.uses ?? 0 }));
    const peerLines: string[] = [''];
    if (peerTools.length === 0) {
      peerLines.push(`  ${fg(C.gray)}No peer tools yet.${RESET}`);
      peerLines.push(`  ${fg(C.gray)}Peer will share when connected.${RESET}`);
    } else {
      for (let i = 0; i < Math.min(peerTools.length, panelH - 3); i++) {
        const t = peerTools[i];
        const marker = selectedPanel === 'peer' && i === selectedIndex ? `${fg(C.cyan)}▸${RESET}` : ' ';
        const nm = selectedPanel === 'peer' && i === selectedIndex ? `${BOLD}${fg(C.white)}${t.name}${RESET}` : `${fg(C.green)}${t.name}${RESET}`;
        peerLines.push(`${marker} ${nm}`);
        peerLines.push(`    ${fg(C.darkGray)}${t.description || '(no description)'}${RESET}`);
        peerLines.push(`    ${fg(C.darkGray)}Uses: ${t.uses}${RESET}`);
        peerLines.push('');
      }
    }

    // Activity log
    const actLines: string[] = [''];
    if (activities.length === 0) {
      actLines.push(`  ${fg(C.gray)}No activity yet.${RESET}`);
    } else {
      for (const a of activities.slice(0, 4)) {
        const icon = a.type === 'send' ? '○' : a.type === 'receive' ? '←' : a.type === 'error' ? '✗' : a.type === 'system' ? '◆' : '·';
        const c = a.type === 'send' ? C.yellow : a.type === 'receive' ? C.green : a.type === 'error' ? C.red : C.gray;
        actLines.push(`  ${fg(c)}${icon} ${a.time}${RESET}  ${fg(c)}${a.text}${RESET}`);
      }
    }

    // Build full screen output
    const out: string[] = [];
    out.push(CLEAR + HIDE_CURSOR);
    out.push(...headerLines);
    out.push('');

    const leftPanel = drawBox(localLines, halfW - 1, ` YOU (${myEns || agentName}) `, C.orange);
    const rightPanel = drawBox(peerLines, halfW - 1, peers.length > 0 ? ` PEER: ${peers[0].ens} ` : ' PEER: (searching...) ', C.cyan);

    for (let i = 0; i < Math.max(leftPanel.length, rightPanel.length); i++) {
      const l = leftPanel[i] ?? (' ' + ' '.repeat(halfW - 4) + ' ');
      const r = rightPanel[i] ?? (' ' + ' '.repeat(halfW - 4) + ' ');
      out.push(l + ' ' + r);
    }

    out.push('');
    const actBox = drawBox(actLines, cols - 4, ' Activity Log ', C.gray);
    out.push(...actBox);

    out.push('');
    const helpBar = drawBox([
      `  ${fg(C.cyan)}[↑↓]${RESET} Navigate   ${fg(C.cyan)}[Tab]${RESET} Panel   ${fg(C.cyan)}[Enter]${RESET} Share/Import   ${fg(C.cyan)}[←→]${RESET} Jump   ${fg(C.cyan)}[r]${RESET} Refresh   ${fg(C.cyan)}[q]${RESET} Exit`,
    ], cols - 4, '', C.darkGray);
    out.push(...helpBar);

    process.stdout.write(out.join('\n') + SHOW_CURSOR + '\n');
  }

  async function refreshPeers(): Promise<void> {
    peers = await discoverPeers();

    for (const peer of peers) {
      if (!peer.connected) continue;
      try {
        const res = await fetch(`${peer.url}/tools`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json() as { tools?: Array<{ name: string; description: string }> };
          peer.tools = data.tools ?? [];
        }
      } catch { /* skip */ }
    }

    render();
  }

  async function shareSelectedTool(): Promise<void> {
    if (selectedPanel !== 'local' || tools.length === 0) return;
    const tool = tools[selectedIndex];

    if (peers.length === 0 || !peers[0].connected) {
      addActivity('No connected peer to share with', 'error');
      return;
    }

    const detail = toolDetails.get(tool.name);
    const payload: ToolSharePayload = createToolSharePayload({
      name: tool.name,
      description: tool.description || detail?.description || '',
      code: detail?.code,
      schema: detail?.schema as { input?: Record<string, unknown>; output?: Record<string, unknown> } | undefined,
      uses: tool.uses,
    });

    const msg = createMeshMessage('tool_share', {
      toEns: peers[0].ens,
      tool: tool.name,
      payload,
    });

    const ok = await sendMeshMessage(peers[0].url, msg);
    if (ok) {
      addActivity(`Shared "${tool.name}" → ${peers[0].ens}`, 'send');
    } else {
      addActivity(`Failed to share "${tool.name}" — peer unreachable`, 'error');
    }
  }

  async function requestFromPeer(): Promise<void> {
    if (selectedPanel !== 'peer' || peers.length === 0 || peers[0].tools.length === 0) return;
    const peerTool = peers[0].tools[selectedIndex];
    if (!peerTool) return;

    addActivity(`Requesting "${peerTool.name}" from ${peers[0].ens}...`, 'info');

    try {
      const res = await fetch(`${peers[0].url}/recv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-from-ens': myEns, 'x-to-ens': peers[0].ens },
        body: JSON.stringify(createMeshMessage('tool_request', { tool: peerTool.name, toEns: peers[0].ens })),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        await new Promise(r => setTimeout(r, 1000));

        const msgRes = await fetch(`http://localhost:${myPort}/messages`, { signal: AbortSignal.timeout(3000) });
        if (msgRes.ok) {
          const msgs = await msgRes.json() as Array<{ message?: any }>;
          const shareMsg = msgs.find(m => m.message?.type === 'tool_share' && m.message?.tool === peerTool.name);
          if (shareMsg?.message?.payload) {
            const imported = await importReceivedTool(agentName, shareMsg.message.payload as ToolSharePayload);
            if (imported) {
              addActivity(`Imported "${peerTool.name}" from ${peers[0].ens}`, 'receive');
              tools.push({ name: peerTool.name, description: peerTool.description, uses: 1 });
              render();
              return;
            }
          }
        }
      }

      addActivity(`No response for "${peerTool.name}"`, 'error');
    } catch {
      addActivity(`Failed to request "${peerTool.name}"`, 'error');
    }
  }

  // ── Keyboard input loop ─────────────────────────────────────────────

  render();

  if (peers.length > 0 && peers[0].connected) {
    const hs = await sendHandshake(peers[0].url, myEns);
    if (hs.ok) {
      addActivity(`Handshake with ${peers[0].ens}`, 'system');
      if (hs.tools && hs.tools.length > 0) peers[0].tools = hs.tools;
    }
  }

  render();

  const wasRaw = process.stdin.isRaw;
  readlineCore.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectInterval: ReturnType<typeof setInterval> | null = null;

  heartbeatInterval = setInterval(async () => {
    if (!running || peers.length === 0) return;
    const peer = peers[0];
    if (!peer.connected) return;

    const ok = await sendHeartbeat(peer.url, myEns);
    if (!ok) {
      peer.connected = false;
      addActivity(`${peer.ens} went offline`, 'error');
      render();
    } else {
      peer.lastSeen = Date.now();

      try {
        const msgRes = await fetch(`http://localhost:${myPort}/messages`, { signal: AbortSignal.timeout(2000) });
        if (msgRes.ok) {
          const msgs = await msgRes.json() as Array<{ message?: any; fromEns?: string }>;
          for (const m of msgs) {
            if (m.message?.type === 'tool_share' && m.message?.payload) {
              const payload = m.message.payload as ToolSharePayload;
              const alreadyHave = tools.some(t => t.name === payload.name);
              if (!alreadyHave) {
                addActivity(`Received "${payload.name}" from ${m.fromEns || 'peer'}`, 'receive');
                tools.push({ name: payload.name, description: payload.description, uses: payload.uses ?? 1 });
                render();
              }
            }
          }
        }
      } catch { /* skip */ }
    }
  }, 3000);

  reconnectInterval = setInterval(async () => {
    if (!running || peers.length === 0 || peers[0].connected) return;

    const fresh = await discoverPeers();
    if (fresh.length > 0 && fresh[0].connected) {
      peers[0] = fresh[0];
      const hs = await sendHandshake(peers[0].url, myEns);
      if (hs.ok) {
        if (hs.tools) peers[0].tools = hs.tools;
        addActivity(`${peers[0].ens} reconnected!`, 'receive');
      }
      render();
    }
  }, 5000);

  function cleanup(): void {
    running = false;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (reconnectInterval) clearInterval(reconnectInterval);
    process.stdin.removeListener('keypress', onKeypress);
    if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false);
    process.stdout.write(SHOW_CURSOR + CLEAR + '\n');
    if (peers.length > 0 && peers[0].connected) {
      sendLeave(peers[0].url, myEns).catch(() => {});
    }
  }

  function onKeypress(_char: string | undefined, key: readlineCore.Key): void {
    if (key.ctrl && key.name === 'c') { cleanup(); return; }

    if (key.name === 'q' || (key.name === 'escape' && !key.shift)) {
      cleanup();
      return;
    }

    const items = selectedPanel === 'local' ? tools : peers.length > 0 ? peers[0].tools : [];

    if ((key.name === 'up' || key.name === 'k') && items.length > 0) {
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      render();
      return;
    }

    if ((key.name === 'down' || key.name === 'j') && items.length > 0) {
      selectedIndex = (selectedIndex + 1) % items.length;
      render();
      return;
    }

    if (key.name === 'tab') {
      selectedPanel = selectedPanel === 'local' ? 'peer' : 'local';
      selectedIndex = 0;
      render();
      return;
    }

    if (key.name === 'return' || key.name === 'enter') {
      if (selectedPanel === 'local') { shareSelectedTool().then(() => render()); }
      else { requestFromPeer().then(() => render()); }
      return;
    }

    if (key.name === 'r') {
      addActivity('Refreshing...', 'info');
      refreshPeers();
      return;
    }

    if (key.name === 'left') {
      selectedPanel = 'local'; selectedIndex = 0; render(); return;
    }
    if (key.name === 'right') {
      selectedPanel = 'peer'; selectedIndex = 0; render(); return;
    }
  }

  process.stdin.on('keypress', onKeypress);
  process.stdin.resume();

  return new Promise<void>((resolve) => {
    // Keep alive until user exits
  });
}
