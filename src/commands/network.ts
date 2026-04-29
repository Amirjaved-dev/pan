import { Command } from 'commander';
import chalk from 'chalk';
import { AXLClient } from '@zero-agents/core';
import { loadConfig } from '../config/load-config.js';

function createAxlClient(config: { axl: { port: number } }): AXLClient {
  return new AXLClient({ axlPort: config.axl.port });
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

  const axl = createAxlClient(config);

  try {
    const peerId = await axl.getPeerId();
    console.log(`  Peer ID:  ${chalk.green(peerId)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  Peer ID:  ${chalk.red('unreachable')}`);
    console.log(chalk.gray(`  ${message}`));
  }

  try {
    const topologyRes = await fetch(`http://localhost:${config.axl.port}/topology`);
    if (topologyRes.ok) {
      const topology = await topologyRes.json() as Record<string, unknown>;
      const peers = (topology.peers ?? []) as Array<{ peerId?: string }>;
      console.log(`  Peers:    ${chalk.green(String(peers.length))}`);
      for (const p of peers) {
        if (p.peerId) console.log(chalk.gray(`    - ${p.peerId}`));
      }
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
