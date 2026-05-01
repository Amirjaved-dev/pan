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

export function createNetworkCommand(): Command {
  return new Command('network')
    .description('AXL multi-agent network commands')
    .addCommand(
      new Command('status')
        .description('Show AXL network status and peers')
        .action(cmdNetworkStatus),
    );
}
