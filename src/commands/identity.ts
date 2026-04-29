import { ENSIdentityManager, type AgentProfile } from '@zero-agents/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { loadAgent } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';

function toAgentProfile(agent: Awaited<ReturnType<typeof loadAgent>>): AgentProfile {
  return {
    description: agent.description,
    capabilities: agent.capabilities,
    toolRegistryHash: agent.toolRegistryHash ?? '',
    axlPeerId: agent.axlPeerId ?? undefined,
    url: process.env.NEXT_PUBLIC_APP_URL,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function createIdentityCommand(): Command {
  const command = new Command('identity').description('Manage ENS-backed agent identity');

  command
    .command('show')
    .description('Show the ENS profile Pan Agents will publish')
    .argument('<agent>', 'agent name')
    .action(async (agentName: string) => {
      loadEnv();
      const agent = await loadAgent(agentName);
      const profile = toAgentProfile(agent);

      console.log(chalk.cyan(`[identity] ${agent.name} -> ${agent.ensName}`));
      console.log(JSON.stringify(profile, null, 2));
    });

  command
    .command('publish')
    .description('Publish agent identity metadata to ENS')
    .argument('<agent>', 'agent name')
    .action(async (agentName: string) => {
      loadEnv();
      const config = await loadConfig();
      const agent = await loadAgent(agentName);
      const identity = new ENSIdentityManager({
        ensName: agent.ensName,
        privateKey: requireEnv('ENS_PRIVATE_KEY'),
        rpcUrl: process.env.SEPOLIA_RPC_URL ?? config.ens.rpcUrl,
      });

      await identity.setAgentProfile(toAgentProfile(agent));
      console.log(chalk.green(`[identity] published ${agent.name}`));
      console.log(chalk.gray(agent.ensName));
    });

  return command;
}
