import chalk from 'chalk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type * as BlessedType from 'blessed';

const _require = createRequire(import.meta.url);
const blessed = _require('blessed') as typeof BlessedType;
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
  } catch (err) {
    return false;
  }
}

export async function startMesh(): Promise<void> {
  const config = await loadConfig();
  const agentName = process.env.PAN_DEFAULT_AGENT ?? config.defaultAgent;
  const myEns = process.env.PAN_AGENT_ENS ?? '';
  const myPort = Number.parseInt(process.env.AXL_PORT ?? String(config.axl.port), 10);

  if (config.axl.enabled) {
    await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  }

  const screen = blessed.screen({
    smartCSR: true,
    title: 'Pan Mesh',
    terminal: 'xterm-256color',
  });

  screen.key(['escape', 'q'], () => {
    screen.destroy();
    process.stdout.write('\n');
    process.exit(0);
  });

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
  let statusText = peers.length > 0
    ? (peers[0].connected ? '{green-fg}● Connected{/}' : '{yellow-fg}○ Waiting for peer{/}')
    : '{gray-fg}○ No peer found{/}';

  function addActivity(text: string, type: ActivityEntry['type'] = 'info'): void {
    const now = new Date();
    activities.unshift({ time: now.toLocaleTimeString('en-US', { hour12: false }).slice(0, 5), text, type });
    if (activities.length > 50) activities.length = 50;
    render();
  }

  const headerBox = blessed.box({
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: '#de7a55' }, fg: '#c7d2fe' },
    content: '',
  });

  function updateHeader(): void {
    const lines = [
      '',
      ' {#de7a55-fg}▄▀▄{/}  {bold}{#de7a55-fg}Pan Mesh{/}{/}   {gray-fg}v0.1.0 · zero-g · AXL tool exchange{/}',
      ` {gray-fg}${myEns || agentName}{/} {gray-fg}· port ${myPort}{/}   ${statusText}`,
    ];
    headerBox.setContent(lines.join('\n'));
  }

  const localPanel = blessed.box({
    top: 4,
    left: 0,
    width: '50%',
    bottom: 6,
    tags: true,
    border: { type: 'line' },
    label: ` YOU (${myEns || agentName}) `,
    style: {
      border: { fg: selectedPanel === 'local' ? '#de7a55' : 'gray' },
      label: { bg: selectedPanel === 'local' ? '#de7a55' : 'gray', fg: 'black', bold: true },
    },
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: true,
  });

  const peerPanel = blessed.box({
    top: 4,
    right: 0,
    width: '50%',
    bottom: 6,
    tags: true,
    border: { type: 'line' },
    label: peers.length > 0
      ? ' PEER: ' + peers[0].ens + ' '
      : ' PEER: (searching...) ',
    style: {
      border: { fg: (selectedPanel as string) === 'peer' ? '#7dd3fc' : 'gray' },
      label: { bg: (selectedPanel as string) === 'peer' ? '#7dd3fc' : 'gray', fg: 'black', bold: true },
    },
    scrollable: true,
    alwaysScroll: true,
    keys: false,
    mouse: true,
  });

  const activityBar = blessed.box({
    bottom: 3,
    left: 1,
    right: 1,
    height: 4,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'gray' },
    label: ' Activity Log ',
    content: '',
  });

  const helpBar = blessed.box({
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, fg: 'gray' },
    content: ` {bold}[↑↓]{/} Navigate  {bold}[Tab]{/} Panel  {bold}[Enter]{/} Share/Import  {bold}[←→]{/} Jump  {bold}[r]{/} Refresh  {bold}[q]{/} Exit `,
  });

  screen.append(headerBox);
  screen.append(localPanel);
  screen.append(peerPanel);
  screen.append(activityBar);
  screen.append(helpBar);

  function renderTools(panel: BlessedType.Widgets.BoxElement, items: Array<{ name: string; description: string; uses: number }>, selectedIdx: number, isActive: boolean): void {
    if (items.length === 0) {
      panel.setContent('\n\n  {gray-fg}No tools yet.{/}\n  {gray-fg}Run tasks to generate tools.{/}\n');
      return;
    }

    const lines: string[] = [''];
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      const marker = i === selectedIdx && isActive ? '{#de7a55-fg}▸{/} ' : '  ';
      const nameStyle = i === selectedIdx && isActive ? '{bold}{#c7d2ce-fg}' : '{green-fg}';
      lines.push(`${marker}${nameStyle}${t.name}{/}`);
      lines.push(`    {gray-fg}${t.description || '(no description)'}{/}`);
      lines.push(`    {dark-gray-fg}Uses: ${t.uses}{/}`);
      lines.push('');
    }

    panel.setContent(lines.join('\n'));
  }

  function renderActivities(): void {
    if (activities.length === 0) {
      activityBar.setContent('\n  {gray-fg}No activity yet.{/}\n');
      return;
    }

    const recent = activities.slice(0, 4);
    const lines = [''];
    for (const a of recent) {
      const icon = a.type === 'send' ? '○' : a.type === 'receive' ? '←' : a.type === 'error' ? '✗' : a.type === 'system' ? '◆' : '·';
      const color = a.type === 'send' ? '#fbbf24' : a.type === 'receive' ? '#34d399' : a.type === 'error' ? '#f87171' : 'gray';
      lines.push(`  {${color}-fg}${icon} ${a.time}{/}  {${color}-fg}${a.text}{/}`);
    }
    lines.push('');
    activityBar.setContent(lines.join('\n'));
  }

  function render(): void {
    updateHeader();

    renderTools(localPanel, tools, selectedPanel === 'local' ? selectedIndex : -1, selectedPanel === 'local');

    const peerTools = (peers.length > 0 ? peers[0].tools : []).map(t => ({ name: t.name, description: t.description, uses: t.uses ?? 0 }));
    renderTools(peerPanel, peerTools, selectedPanel === 'peer' ? selectedIndex : -1, selectedPanel === 'peer');

    const peerLabel = peers.length > 0
      ? ' PEER: ' + peers[0].ens + (peers[0].connected
        ? ' {green-fg}●{/} ' + peers[0].latencyMs + 'ms '
        : ' {yellow-fg}○ offline{/} ')
      : ' PEER: (searching...) ';
    peerPanel.setLabel(peerLabel);

    renderActivities();
    screen.render();
  }

  async function refreshPeers(): Promise<void> {
    peers = await discoverPeers();

    if (peers.length > 0 && peers[0].connected) {
      statusText = '{green-fg}● Connected to ' + peers[0].ens + '{/}';
      addActivity(`${peers[0].ens} is online`, 'system');
    } else if (peers.length > 0) {
      statusText = '{yellow-fg}○ ' + peers[0].ens + ' offline — waiting...{/}';
    } else {
      statusText = '{gray-fg}○ No peer found{/}';
    }

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

  screen.key(['up', 'k'], () => {
    const items = selectedPanel === 'local' ? tools : peers.length > 0 ? peers[0].tools : [];
    if (items.length === 0) return;
    selectedIndex = (selectedIndex - 1 + items.length) % items.length;
    render();
  });

  screen.key(['down', 'j'], () => {
    const items = selectedPanel === 'local' ? tools : peers.length > 0 ? peers[0].tools : [];
    if (items.length === 0) return;
    selectedIndex = (selectedIndex + 1) % items.length;
    render();
  });

  screen.key(['tab'], () => {
    selectedPanel = selectedPanel === 'local' ? 'peer' : 'local';
    selectedIndex = 0;
    render();
  });

  screen.key(['enter', 'return'], async () => {
    if (selectedPanel === 'local') {
      await shareSelectedTool();
    } else {
      if (peers.length === 0 || peers[0].tools.length === 0) return;
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
              } else {
                addActivity(`Failed to import "${peerTool.name}"`, 'error');
              }
              return;
            }
          }
        }

        addActivity(`No response for "${peerTool.name}" — peer may not have shared it yet`, 'error');
      } catch {
        addActivity(`Failed to request "${peerTool.name}"`, 'error');
      }
    }
  });

  screen.key(['r'], async () => {
    addActivity('Refreshing...', 'info');
    await refreshPeers();
  });

  screen.key(['left'], () => {
    selectedPanel = 'local';
    selectedIndex = 0;
    render();
  });

  screen.key(['right'], () => {
    selectedPanel = 'peer';
    selectedIndex = 0;
    render();
  });

  addActivity('Mesh mode started', 'system');
  await refreshPeers();

  if (peers.length > 0 && peers[0].connected) {
    const hs = await sendHandshake(peers[0].url, myEns);
    if (hs.ok) {
      addActivity(`Handshake with ${peers[0].ens}`, 'system');
      if (hs.tools && hs.tools.length > 0) {
        peers[0].tools = hs.tools;
      }
    }
  }

  render();

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectInterval: ReturnType<typeof setInterval> | null = null;

  heartbeatInterval = setInterval(async () => {
    if (peers.length === 0) return;
    const peer = peers[0];
    if (!peer.connected) return;

    const ok = await sendHeartbeat(peer.url, myEns);
    if (!ok) {
      peer.connected = false;
      peer.latencyMs = -1;
      statusText = '{yellow-fg}○ ' + peer.ens + ' went offline — reconnecting...{/}';
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
      } catch { /* poll failed, skip */ }
    }
  }, 3000);

  reconnectInterval = setInterval(async () => {
    if (peers.length === 0 || peers[0].connected) return;

    const fresh = await discoverPeers();
    if (fresh.length > 0 && fresh[0].connected) {
      peers[0] = fresh[0];
      statusText = '{green-fg}● Reconnected to ' + peers[0].ens + '{/}';
      const hs = await sendHandshake(peers[0].url, myEns);
      if (hs.ok) {
        if (hs.tools) peers[0].tools = hs.tools;
        addActivity(`${peers[0].ens} reconnected!`, 'receive');
      }
      render();
    }
  }, 5000);

  screen.on('destroy', () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (reconnectInterval) clearInterval(reconnectInterval);
    if (peers.length > 0 && peers[0].connected) {
      sendLeave(peers[0].url, myEns).catch(() => {});
    }
  });
}
