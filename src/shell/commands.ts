import chalk from 'chalk';
import { doctorCommand } from '../commands/doctor.js';
import { initCommand } from '../commands/init.js';
import { cmdToolsList, cmdToolsSearch } from '../commands/tools.js';
import { executeSlashAgents, executeSlashNetwork, executeSlashStatus, executeSlashSwitchAgent } from './execute-decision.js';

export interface ShellContext {
  agentName: string;
  setAgent(name: string): void;
  exit(): never;
}

type ShellCommand = (args: string, ctx: ShellContext) => void | Promise<void> | never;

const commands: Record<string, { fn: ShellCommand; description: string }> = {
  help: {
    fn: () => printHelp(),
    description: 'Show available commands',
  },
  agent: {
    fn: async (args: string, ctx) => args.trim() ? await executeSlashSwitchAgent(args.trim(), ctx) : await executeSlashAgents(ctx),
    description: 'Switch or list agents',
  },
  status: {
    fn: async (_args: string, ctx) => await executeSlashStatus(ctx),
    description: 'Show current agent and config',
  },
  doctor: {
    fn: () => doctorCommand(),
    description: 'Run infrastructure checks',
  },
  init: {
    fn: () => initCommand(),
    description: 'Create local Pan config',
  },
  clear: {
    fn: () => { void process.stdout.write('\x1Bc'); },
    description: 'Clear terminal',
  },
  tools: {
    fn: async (args: string, ctx) => await cmdTools({ args, ctx }),
    description: 'List or search tools',
  },
  network: {
    fn: () => executeSlashNetwork(),
    description: 'Show AXL network status',
  },
  model: {
    fn: async () => {
      const { loadConfig } = await import('../config/load-config.js');
      const config = await loadConfig();
      console.log();
      console.log(chalk.bold('  Decision Model:'));
      console.log(`  Provider: ${chalk.green(config.decision.provider)}`);
      if (config.decision.provider === 'openrouter') console.log(`  Model:    ${chalk.cyan(config.decision.openRouterModel)}`);
      console.log();
    },
    description: 'Show decision model provider',
  },
  exit: {
    fn: () => { process.exit(0); },
    description: 'Exit Pan shell',
  },
};

function printHelp(): void {
  console.log();
  console.log(chalk.bold('  Commands'));
  console.log();
  for (const [name, { description }] of Object.entries(commands)) {
    console.log(`  ${chalk.hex('#de7a55')(`/${name.padEnd(10)}`)} ${chalk.gray(description)}`);
  }
  console.log();
  console.log(chalk.gray('  Ask a question directly, or describe a concrete task for the active agent.'));
  console.log();
}

async function cmdTools({ args, ctx }: { args: string; ctx: ShellContext }): Promise<void> {
  if (!args.trim()) {
    await cmdToolsList({ agent: ctx.agentName });
    return;
  }
  await cmdToolsSearch(args, { agent: ctx.agentName });
}

export function getShellCommand(input: string): { command: ShellCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

  const entry = commands[name];
  if (!entry) return null;

  return { command: entry.fn, args };
}

export function isExitCommand(input: string): boolean {
  return input.trim() === '/exit' || input.trim() === '/quit';
}
