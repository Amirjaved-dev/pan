import chalk from 'chalk';
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { createAgentConfig } from '../agents/schema.js';
import { listAgents, loadAgent, saveAgent } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';
import { detectEnsName, requireEnv } from '../identity/ens.js';

function parseCapabilities(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\s]+/)
    .map((capability) => capability.trim())
    .filter(Boolean);
}

export function createAgentCommand(): Command {
  const command = new Command('agent').description('Manage Pan agent identities');

  command
    .command('create')
    .description('Create local metadata for an ENS-backed agent')
    .argument('<name>', 'agent name')
    .option('--ens <ensName>', 'ENS name for this agent; auto-detected from ENS_PRIVATE_KEY if omitted')
    .option('--description <description>', 'agent description')
    .option('--capabilities <items>', 'comma-separated capability list')
    .action(async (name: string, options: { ens?: string; description?: string; capabilities?: string }) => {
      loadEnv();
      const config = await loadConfig();
      const ensName = options.ens ?? (await detectEnsName(requireEnv('ENS_PRIVATE_KEY'), process.env.SEPOLIA_RPC_URL ?? config.ens.rpcUrl));
      const agent = createAgentConfig({
        name,
        ensName,
        description: options.description,
        capabilities: parseCapabilities(options.capabilities),
      });
      const agentPath = await saveAgent(agent);

      console.log(chalk.green(`[agent] created ${agent.name}`));
      console.log(chalk.gray(agentPath));
    });

  command
    .command('list')
    .description('List configured Pan agents')
    .action(async () => {
      const agents = await listAgents();

      if (agents.length === 0) {
        console.log(chalk.yellow('[agent] no agents configured'));
        return;
      }

      for (const agent of agents) {
        console.log(`${chalk.cyan(agent.name)} ${chalk.gray(agent.ensName)} ${agent.capabilities.join(', ')}`);
      }
    });

  command
    .command('show')
    .description('Show one configured Pan agent')
    .argument('<name>', 'agent name')
    .action(async (name: string) => {
      const agent = await loadAgent(name);
      console.log(JSON.stringify(agent, null, 2));
    });

  return command;
}
