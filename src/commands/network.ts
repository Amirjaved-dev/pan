import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config/load-config.js';
import { ensureAxlRunning } from '../runtime/axl-autostart.js';
import { discoverPeers, getPeerTools, requestToolFromPeer, shareToolWithPeer, loadLocalToolFromStore, getLocalToolNames, getMyPort, type PeerInfo, type ToolSharePayload } from '../runtime/axl.js';

export async function cmdNetworkStatus(): Promise<void> {
  const config = await loadConfig();

  console.log(chalk.bold('\n  AXL Network Status:\n'));
  console.log(`  Port:     ${chalk.cyan(String(config.axl.port))}`);
  console.log(`  Enabled:  ${config.axl.enabled ? chalk.green('yes') : chalk.red('no')}`);

  if (!config.axl.enabled) {
    console.log(chalk.gray('\n  AXL is disabled. Set axl.enabled to true in config.'));
    return;
  }

  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (startup.started || !startup.running) {
    console.log(`  Startup:  ${startup.running ? chalk.green(startup.detail) : chalk.yellow(startup.detail)}`);
  }

  try {
    const res = await fetch(`http://localhost:${config.axl.port}/info`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const info = await res.json() as { ens?: string };
      console.log(`  Identity: ${chalk.green(info.ens ?? 'unknown')}`);
    }
  } catch {
    console.log(`  Identity: ${chalk.red('unreachable')}`);
  }

  const peers = await discoverPeers();
  console.log(`  Peers:    ${chalk.green(String(peers.length))}`);
  for (const p of peers) {
    const tools = await getPeerTools(p);
    const toolCount = tools.length;
    console.log(chalk.gray(`    ${p.ens} (port ${p.port}, ${toolCount} tools, ${p.latencyMs}ms)`));
  }
  console.log();
}

export async function cmdNetworkSend(peerEns: string, message: string): Promise<void> {
  const config = await loadConfig();
  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (!startup.running) {
    console.log(chalk.red('  AXL node is not running.'));
    return;
  }

  const res = await fetch(`http://localhost:${config.axl.port}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-destination-ens': peerEns },
    body: JSON.stringify({ type: 'message', content: message }),
  });

  if (res.ok) {
    console.log(chalk.green(`  Sent to ${peerEns}.`));
  } else {
    console.log(chalk.red('  Send failed.'));
  }
}

export async function cmdNetworkMessages(): Promise<void> {
  const config = await loadConfig();
  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (!startup.running) {
    console.log(chalk.red('  AXL node is not running.'));
    return;
  }

  const res = await fetch(`http://localhost:${config.axl.port}/messages`);
  if (!res.ok) { console.log(chalk.red('Failed to fetch messages.')); return; }

  const messages = await res.json() as Array<{ fromPeerId: string; message: any; receivedAt: number }>;
  const incoming = messages.filter(m => m.fromPeerId && m.message);

  if (incoming.length === 0) { console.log(chalk.gray('No new messages.')); return; }

  console.log(chalk.bold('\n  Messages:\n'));
  for (const msg of incoming) {
    const time = new Date(msg.receivedAt).toLocaleTimeString();
    console.log(`  [${chalk.gray(time)}] ${chalk.cyan(msg.fromPeerId)}:`);
    const m = msg.message;
    if (m.type === 'tool_share') console.log(`    ${chalk.green('tool shared:')} ${m.tool}`);
    else if (m.type === 'tool_request') console.log(`    ${chalk.yellow('tool requested:')} ${m.tool}`);
    else if (m.type === 'message') console.log(`    ${m.content}`);
    else console.log(`    ${JSON.stringify(m)}`);
    console.log();
  }
}

export async function cmdShareTool(toolName: string, agentName?: string): Promise<void> {
  const config = await loadConfig();
  await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });

  const agent = agentName ?? process.env.PAN_DEFAULT_AGENT ?? config.defaultAgent;
  const tool = await loadLocalToolFromStore(agent, toolName);

  if (!tool) {
    console.log(chalk.yellow(`  Tool "${toolName}" not found in ${agent}'s local tools.`));
    const names = await getLocalToolNames(agent);
    if (names.length > 0) {
      console.log(chalk.gray(`  Available: ${names.join(', ')}`));
    }
    return;
  }

  const peers = await discoverPeers();
  const connected = peers.filter(p => p.connected);

  if (connected.length === 0) {
    console.log(chalk.yellow('  No connected peers. Make sure the other agent is running.'));
    return;
  }

  console.log(chalk.cyan(`  Sharing "${toolName}" with ${connected.length} peer(s)...`));

  for (const peer of connected) {
    const ok = await shareToolWithPeer(peer, tool);
    if (ok) {
      console.log(chalk.green(`  -> ${peer.ens} (port ${peer.port})`));
    } else {
      console.log(chalk.red(`  x  ${peer.ens} (port ${peer.port})`));
    }
  }
}

export async function cmdImportTool(toolName: string, agentName?: string): Promise<void> {
  const config = await loadConfig();
  await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });

  const agent = agentName ?? process.env.PAN_DEFAULT_AGENT ?? config.defaultAgent;
  const peers = await discoverPeers();
  const connected = peers.filter(p => p.connected);

  if (connected.length === 0) {
    console.log(chalk.yellow('  No connected peers. Make sure the other agent is running.'));
    return;
  }

  console.log(chalk.cyan(`  Searching for "${toolName}" across ${connected.length} peer(s)...`));

  for (const peer of connected) {
    const peerTools = await getPeerTools(peer);
    const hasIt = peerTools.some(t => t.name.toLowerCase() === toolName.toLowerCase());
    if (!hasIt) continue;

    console.log(chalk.gray(`  Found on ${peer.ens}. Requesting...`));
    const payload = await requestToolFromPeer(peer, toolName);
    if (payload) {
      const imported = await importToolToLocalStore(agent, payload);
      if (imported) {
        console.log(chalk.green(`  Imported "${payload.name}" from ${peer.ens}`));
      } else {
        console.log(chalk.red(`  Failed to save "${payload.name}" locally.`));
      }
      return;
    }
  }

  console.log(chalk.yellow(`  Tool "${toolName}" not found on any connected peer.`));
  for (const peer of connected) {
    const peerTools = await getPeerTools(peer);
    if (peerTools.length > 0) {
      console.log(chalk.gray(`  ${peer.ens} has: ${peerTools.map(t => t.name).join(', ')}`));
    }
  }
}

export async function cmdListPeerTools(): Promise<void> {
  const config = await loadConfig();
  await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });

  const peers = await discoverPeers();
  const connected = peers.filter(p => p.connected);

  if (connected.length === 0) {
    console.log(chalk.yellow('  No connected peers.'));
    return;
  }

  for (const peer of connected) {
    const tools = await getPeerTools(peer);
    console.log(chalk.bold(`\n  ${peer.ens} (${peer.port}):`));
    if (tools.length === 0) {
      console.log(chalk.gray('    No tools.'));
    } else {
      for (const t of tools) {
        const displayName = typeof t.name === 'string' && t.name.trim() ? t.name.trim() : undefined;
        if (!displayName) continue;
        console.log(`    ${chalk.green(displayName)}  ${chalk.gray(t.description ?? '')}`);
      }
    }
  }
  console.log();
}

export async function cmdNetworkRequestTool(targetEns: string, toolName: string): Promise<void> {
  await cmdImportTool(toolName);
}

export async function cmdNetworkShareTool(_peerId: string, toolName: string): Promise<void> {
  await cmdShareTool(toolName);
}

async function importToolToLocalStore(agentName: string, payload: ToolSharePayload, fallbackName?: string): Promise<boolean> {
  const toolName_incoming = fallbackName;
  const { writeFile, readFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { getAgentLocalToolStorePath, getAgentLocalRegistryPath, getAgentExperiencePath } = await import('../config/paths.js');

  try {
    const storePath = getAgentLocalToolStorePath(agentName);
    const registryPath = getAgentLocalRegistryPath(agentName);
    const expPath = getAgentExperiencePath(agentName);

    const storeRaw = await readFile(storePath, 'utf8').catch(() => null);
    const store: { blobs?: Record<string, Record<string, unknown>> } = storeRaw ? JSON.parse(storeRaw) : { blobs: {} };
    if (!store.blobs) store.blobs = {};

    const toolName = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : toolName_incoming;
    if (!toolName) return false;

    const toolBlob: Record<string, unknown> = {
      name: toolName,
      description: typeof payload.description === 'string' ? payload.description : '',
      version: typeof payload.version === 'string' ? payload.version : '1.0.0',
      code: typeof payload.code === 'string' ? payload.code : undefined,
      schema: payload.schema,
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      runtime: 'node',
      sourceAgent: payload.sourceAgent,
      importedAt: Date.now(),
    };

    const blobHash = 'imported-' + createHash('sha256').update(JSON.stringify(toolBlob)).digest('hex').slice(0, 16);
    store.blobs[blobHash] = toolBlob;

    const regRaw = await readFile(registryPath, 'utf8').catch(() => null);
    let indexHash: string | null = null;
    if (regRaw) {
      const reg = JSON.parse(regRaw) as { rootHash?: string };
      indexHash = reg.rootHash ?? null;
    }

    const idxHash = indexHash ?? ('idx-' + createHash('sha256').update(agentName + Date.now()).digest('hex').slice(0, 16));
    if (!store.blobs[idxHash]) {
      store.blobs[idxHash] = { _meta: { updatedAt: Date.now(), count: 0 } };
    }

    const index = store.blobs[idxHash] as Record<string, unknown>;
    index[toolName] = blobHash;

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
      task: `Imported from ${payload.sourceAgent ?? 'peer'}`,
      success: true,
      qualityScore: 0.8,
      createdAt: Date.now(),
    });
    await mkdir(dirname(expPath), { recursive: true });
    await writeFile(expPath, JSON.stringify(experiences, null, 2) + '\n', 'utf8');

    return true;
  } catch {
    return false;
  }
}

export function createNetworkCommand(): Command {
  return new Command('network')
    .description('AXL multi-agent network commands')
    .addCommand(new Command('status').description('Show network status and peers').action(cmdNetworkStatus))
    .addCommand(new Command('send').description('Send message to peer').argument('<peerEns>', 'Peer ENS').argument('<message>', 'Message').action(cmdNetworkSend))
    .addCommand(new Command('messages').description('Check received messages').action(cmdNetworkMessages))
    .addCommand(new Command('share-tool').description('Share a tool with peers').argument('<toolName>', 'Tool name').action(async (toolName) => { await cmdShareTool(toolName); }))
    .addCommand(new Command('import-tool').description('Import a tool from peers').argument('<toolName>', 'Tool name').action(async (toolName) => { await cmdImportTool(toolName); }));
}
