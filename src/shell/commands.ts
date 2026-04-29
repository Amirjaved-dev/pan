import chalk from 'chalk';
import { listAgents } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';
import { doctorCommand } from '../commands/doctor.js';
import { cmdToolsList, cmdToolsSearch } from '../commands/tools.js';
import { cmdNetworkStatus } from '../commands/network.js';

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
    fn: async (args: string, ctx) => await cmdAgent(args, ctx),
    description: 'Switch or list agents',
  },
  status: {
    fn: async (_args: string, ctx) => await cmdStatus(ctx),
    description: 'Show current agent and config',
  },
  doctor: {
    fn: () => doctorCommand(),
    description: 'Run infrastructure checks',
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
    fn: () => cmdNetworkStatus(),
    description: 'Show AXL network status',
  },
  exit: {
    fn: () => { process.exit(0); },
    description: 'Exit Pan shell',
  },
};

function printHelp(): void {
  console.log();
  console.log(chalk.bold('  Slash Commands:'));
  console.log();
  for (const [name, { description }] of Object.entries(commands)) {
    console.log('  ' + chalk.cyan(`/${name.padEnd(12)}`) + ' ' + description);
  }
  console.log();
  console.log(chalk.gray('  Anything else is sent to your agent as a task.'));
  console.log();
}

async function cmdAgent(args: string, ctx: ShellContext): Promise<void> {
  if (!args.trim()) {
    const agents = await listAgents();
    if (agents.length === 0) {
      console.log(chalk.yellow('  No agents found. Run pan agent create <name>.'));
      return;
    }
    console.log();
    console.log(chalk.bold('  Agents:'));
    for (const a of agents) {
      const current = a.name === ctx.agentName ? chalk.green(' (active)') : '';
      console.log(`  ${chalk.cyan(a.name)}${current}`);
      if (a.description) console.log(chalk.gray(`    ${a.description}`));
    }
    console.log();
    return;
  }

  const target = args.trim();
  const agents = await listAgents();
  const exists = agents.some((a) => a.name === target);

  if (!exists) {
    console.log(chalk.red(`  Agent "${target}" not found.`));
    return;
  }

  ctx.setAgent(target);
  console.log(chalk.green(`  Switched to agent: ${target}`));
}

async function cmdStatus(ctx: ShellContext): Promise<void> {
  const config = await loadConfig();
  const agents = await listAgents();

  console.log();
  console.log(chalk.bold('  Pan Status:'));
  console.log(`  Agent:       ${chalk.green(ctx.agentName)}`);
  console.log(`  Storage:     ${chalk.cyan(config.storageMode)}`);
  console.log(`  AXL:        ${config.axl.enabled ? chalk.green(`enabled (port ${config.axl.port})`) : chalk.red('disabled')}`);
  console.log(`  ENS:        ${config.ens.enabled ? chalk.green('enabled') : chalk.red('disabled')}`);
  console.log(`  Agents:      ${chalk.gray(String(agents.length))}`);
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
  if (!trimmed.startsWith('/')) return null;

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
