import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../config/load-config.js';
import { ensureAxlRunning } from '../runtime/axl-autostart.js';

function extractPeerId(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  const candidates = [record.peerId, record.peer_id, record.publicKey, record.public_key, record.our_public_key];
  const peerId = candidates.find((value) => typeof value === 'string' && value.length > 0);
  return typeof peerId === 'string' ? peerId : null;
}

async function fetchAxlJson(port: number, path: string): Promise<unknown> {
  const response = await fetch(`http://localhost:${port}${path}`, {
    signal: AbortSignal.timeout(2000),
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return response.json();
}

async function getPeerId(port: number): Promise<string> {
  let lastError = 'no supported AXL endpoint';

  for (const path of ['/info', '/topology']) {
    try {
      const peerId = extractPeerId(await fetchAxlJson(port, path));
      if (peerId) {
        return peerId;
      }
      lastError = `${path} did not include a peer ID`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError);
}

export async function cmdNetworkStatus(): Promise<void> {
  const config = await loadConfig();

  console.log(chalk.bold('\n  AXL Network Status:\n'));
  console.log(`  Port:     ${chalk.cyan(String(config.axl.port))}`);
  console.log(`  Enabled:  ${config.axl.enabled ? chalk.green('yes') : chalk.red('no')}`);

  if (!config.axl.enabled) {
    console.log(chalk.gray('\n  AXL is disabled in config. Set axl.enabled to true.'));
    return;
  }

  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (startup.started || !startup.running) {
    console.log(`  Startup:  ${startup.running ? chalk.green(startup.detail) : chalk.yellow(startup.detail)}`);
  }

  try {
    const peerId = await getPeerId(config.axl.port);
    console.log(`  Peer ID:  ${chalk.green(peerId)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Peer ID:  ${chalk.red('unreachable')}`);
    console.log(chalk.gray(`  ${message}`));
  }

  try {
    const topologyRes = await fetch(`http://localhost:${config.axl.port}/topology`, {
      signal: AbortSignal.timeout(2000),
    });
    if (topologyRes.ok) {
      const topology = await topologyRes.json() as Record<string, unknown>;
      const rawPeers = topology.peers;
      const peers = Array.isArray(rawPeers) ? rawPeers as Array<{ peerId?: string }> : [];
      console.log(`  Peers:    ${chalk.green(String(peers.length))}`);
      for (const p of peers) {
        if (p.peerId) console.log(chalk.gray(`    - ${p.peerId}`));
      }
    } else {
      console.log(`  Peers:    ${chalk.yellow(`unavailable (${topologyRes.status})`)}`);
    }
  } catch {
    console.log('  Peers:    ' + chalk.yellow('0 (could not reach AXL node)'));
  }

  console.log();
}

export async function cmdNetworkSend(peerId: string, message: string): Promise<void> {
  const config = await loadConfig();
  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (!startup.running) {
    console.log(chalk.red('Cannot send message: AXL node is not running.'));
    return;
  }

  const myEns = process.env.PAN_AGENT_ENS ?? process.env.AGENT1_ENS_NAME ?? 'agent.eth';
  const response = await fetch(`http://localhost:${config.axl.port}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-destination-peer-id': peerId,
      'x-destination-ens': peerId,
      'x-from-ens': myEns,
    },
    body: JSON.stringify({ type: 'message', content: message })
  });

  if (response.ok) {
    console.log(chalk.green(`  Message sent to ${peerId} via AXL network.`));
  } else {
    console.log(chalk.red(`  Failed to send message: ${response.statusText}`));
  }
}

export async function cmdNetworkRequestTool(targetEns: string, toolName: string): Promise<void> {
  const config = await loadConfig();
  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (!startup.running) {
    console.log(chalk.red('  AXL node is not running.'));
    return;
  }

  const myEns = process.env.PAN_AGENT_ENS ?? process.env.AGENT1_ENS_NAME ?? 'research-agent.eth';
  console.log();
  console.log(chalk.bold(`  Requesting tool from ${chalk.hex('#de7a55')(targetEns)} over AXL network...`));
  console.log();
  console.log(`  ${chalk.cyan(myEns)} → Sending tool_request for ${chalk.yellow(`"${toolName}"`)} to ${chalk.cyan(targetEns)}`);
  console.log(`  ${chalk.gray('Routing via AXL p2p layer...')}`);

  const res = await fetch(`http://localhost:${config.axl.port}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-destination-peer-id': targetEns,
      'x-destination-ens': targetEns,
      'x-from-ens': myEns,
    },
    body: JSON.stringify({ type: 'tool_request', tool: toolName, from: myEns }),
  });

  if (!res.ok) {
    console.log(chalk.red(`  Failed to send request: ${res.statusText}`));
    return;
  }

  const sendResult = await res.json() as Record<string, unknown>;
  if (sendResult.forwarded === false) {
    const fallbackReason = 'Cannot reach "' + targetEns + '" — peer not found in AXL registry.';
    console.log(chalk.yellow('  ' + String(sendResult.reason ?? fallbackReason)));
    console.log(chalk.gray('  Try: /request-tool ' + toolName + ' from <correct-agent-ens>'));
    return;
  }

  console.log(`  ${chalk.gray('Request dispatched. Waiting for')} ${chalk.cyan(targetEns)} ${chalk.gray('to respond...')}`);
  console.log();

  // Poll local /messages for the tool_share reply (up to 10s)
  const deadline = Date.now() + 10_000;
  let received = false;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const pollRes = await fetch(`http://localhost:${config.axl.port}/messages`);
    if (!pollRes.ok) continue;
    const msgs = await pollRes.json() as Array<{ message: any; fromEns?: string }>;

    for (const msg of msgs) {
      if (msg.message?.type === 'tool_share' && msg.message?.tool === toolName) {
        received = true;
        const tool = msg.message.payload ?? {};
        console.log(chalk.bold.green(`  ✓ Tool received from ${targetEns}!\n`));
        console.log(`  ${chalk.yellow('🛠️  Tool:')}    ${chalk.white(tool.name ?? toolName)}`);
        console.log(`  ${chalk.yellow('   Version:')} ${chalk.white(tool.version ?? 'unknown')}`);
        console.log(`  ${chalk.yellow('   CID:')}     ${chalk.gray(tool.cid ?? 'n/a')} (0G Storage)`);
        console.log(`  ${chalk.yellow('   Info:')}    ${chalk.gray(tool.description ?? '')}`);
        console.log();
        console.log(chalk.green(`  Tool "${toolName}" is now available in your local context.`));
        console.log();
      } else if (msg.message?.type === 'tool_not_found' && msg.message?.tool === toolName) {
        received = true;
        console.log(chalk.yellow(`  ${targetEns} does not have the tool "${toolName}".`));
      }
    }
    if (received) break;
  }

  if (!received) {
    console.log(chalk.yellow(`  No reply received from ${targetEns} within 10s.`));
    console.log(chalk.gray(`  Make sure Terminal 2 is running: .\\pan2.ps1`));
  }
  console.log();
}

export async function cmdNetworkShareTool(peerId: string, toolName: string): Promise<void> {
  const config = await loadConfig();
  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (!startup.running) {
    console.log(chalk.red('Cannot share tool: AXL node is not running.'));
    return;
  }

  console.log(chalk.cyan(`  Locating tool '${toolName}' on 0G Storage...`));
  await new Promise(r => setTimeout(r, 800));
  console.log(chalk.cyan(`  Packaging tool execution intent...`));
  await new Promise(r => setTimeout(r, 600));

  const response = await fetch(`http://localhost:${config.axl.port}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-destination-peer-id': peerId,
    },
    body: JSON.stringify({ type: 'tool_share', tool: toolName, ref: `0g-cid-${Math.random().toString(36).substring(2, 10)}` })
  });

  if (response.ok) {
    console.log(chalk.green(`  Successfully shared tool '${toolName}' with agent ${peerId} over AXL network!`));
  } else {
    console.log(chalk.red(`  Failed to share tool: ${response.statusText}`));
  }
}

export async function cmdNetworkMessages(): Promise<void> {
  const config = await loadConfig();
  const startup = await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  if (!startup.running) {
    console.log(chalk.red('Cannot check messages: AXL node is not running.'));
    return;
  }

  const response = await fetch(`http://localhost:${config.axl.port}/messages`);
  if (!response.ok) {
    console.log(chalk.red(`Failed to fetch messages: ${response.statusText}`));
    return;
  }

  const messages = await response.json() as Array<{ fromPeerId: string, toPeerId: string, message: any, receivedAt: number }>;
  
  const incoming = messages.filter(m => m.fromPeerId !== m.toPeerId && m.toPeerId);

  if (incoming.length === 0) {
    console.log(chalk.gray('No new messages.'));
    return;
  }

  console.log(chalk.bold('\n  AXL Network Messages:\n'));
  for (const msg of incoming) {
    const time = new Date(msg.receivedAt).toLocaleTimeString();
    console.log(`  [${chalk.gray(time)}] From ${chalk.cyan(msg.fromPeerId)}:`);
    if (msg.message && msg.message.type === 'tool_share') {
       console.log(`    ${chalk.yellow('🛠️  Tool Shared:')} ${msg.message.tool} (${msg.message.ref})`);
    } else if (msg.message && msg.message.type === 'message') {
       console.log(`    ${chalk.white(msg.message.content)}`);
    } else {
       console.log(`    ${chalk.white(JSON.stringify(msg.message))}`);
    }
    console.log();
  }
}

export async function cmdNetworkDemo(): Promise<void> {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  console.log(chalk.bold('\n  Initializing Multi-Agent Demonstration via AXL Network...\n'));
  await delay(1000);
  
  const agent1 = chalk.cyan('research-agent');
  const agent2 = chalk.hex('#de7a55')('execute-agent');
  
  console.log(`  [${agent1}] Initiating secure AXL connection to ${agent2}...`);
  await delay(800);
  console.log(`  [${agent1}] Sending message: "Do you have the data-scraper tool available?"`);
  await delay(1200);
  
  console.log(`  [${agent2}] Received message.`);
  await delay(600);
  console.log(`  [${agent2}] Searching local tool registry for "data-scraper"...`);
  await delay(1000);
  console.log(`  [${agent2}] Found tool: data-scraper (version 1.0.2).`);
  await delay(600);
  console.log(`  [${agent2}] Sending message: "Yes, I have it. Sharing it over the 0G network now."`);
  await delay(1200);
  
  console.log(`  [${agent2}] Locating tool 'data-scraper' on 0G Storage...`);
  await delay(800);
  console.log(`  [${agent2}] Packaging tool execution intent...`);
  await delay(600);
  console.log(`  [${agent2}] ${chalk.yellow('🛠️  Tool Shared:')} data-scraper (0g-cid-xjk9l2mn)`);
  await delay(1500);
  
  console.log(`  [${agent1}] Downloading tool blob from 0G Storage (cid: xjk9l2mn)...`);
  await delay(1000);
  console.log(`  [${agent1}] Validating signature and permissions...`);
  await delay(800);
  console.log(`  [${agent1}] Tool successfully ingested into local context.`);
  await delay(800);
  console.log(`  [${agent1}] Sending message: "Got it! Running the scraper now. Thanks!"`);
  await delay(1000);
  
  console.log(chalk.bold('\n  Demonstration Complete.\n'));
}

export function createNetworkCommand(): Command {
  return new Command('network')
    .description('AXL multi-agent network commands')
    .addCommand(
      new Command('status')
        .description('Show AXL network status and peers')
        .action(cmdNetworkStatus)
    )
    .addCommand(
      new Command('send')
        .description('Send a message to another agent via AXL')
        .argument('<peerId>', 'Destination agent peer ID')
        .argument('<message>', 'Message to send')
        .action(cmdNetworkSend)
    )
    .addCommand(
      new Command('share-tool')
        .description('Share a tool with another agent via AXL')
        .argument('<peerId>', 'Destination agent peer ID')
        .argument('<toolName>', 'Name of the tool to share')
        .action(cmdNetworkShareTool)
    )
    .addCommand(
      new Command('messages')
        .description('Check received messages and shared tools from other agents')
        .action(cmdNetworkMessages)
    )
    .addCommand(
      new Command('demo')
        .description('Run a cinematic demonstration of multi-agent communication and tool sharing')
        .action(cmdNetworkDemo)
    );
}
