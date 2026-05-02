import chalk from 'chalk';
import { doctorCommand } from '../commands/doctor.js';
import { initCommand } from '../commands/init.js';
import { printModel, setDecisionProvider, setOpenRouterModel } from '../commands/model.js';
import { cmdToolsDelete, cmdToolsDeleteAll, cmdToolsList, cmdToolsSearch, isDeleteAllToolsQuery } from '../commands/tools.js';
import { loadConfig } from '../config/load-config.js';
import { executeSlashAgents, executeSlashNetwork, executeSlashStatus, executeSlashSwitchAgent } from './execute-decision.js';

export interface ShellContext {
  agentName: string;
  setAgent(name: string): void;
  exit(): never;
}

type ShellCommand = (args: string, ctx: ShellContext) => void | Promise<void> | never;

const commands: Record<string, { fn: ShellCommand; description: string }> = {
  help: {
    fn: () => printCommandMenu(),
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
    fn: async (args: string) => cmdModel(args),
    description: 'Show or switch decision model',
  },
  exit: {
    fn: () => { process.exit(0); },
    description: 'Exit Pan shell',
  },
};

export function printCommandMenu(): void {
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

export function getShellCompletions(line: string): [string[], string] {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('/')) return [[], line];

  const commandToken = trimmed.split(/\s+/, 1)[0] ?? '';
  const hasCommandArgs = /\s/.test(trimmed);
  if (hasCommandArgs) return [[], line];

  const hits = Object.keys(commands)
    .map((name) => `/${name}`)
    .filter((name) => name.startsWith(commandToken))
    .map((name) => `${name} `);

  return [hits.length > 0 ? hits : Object.keys(commands).map((name) => `/${name} `), commandToken];
}

export type SlashCommandItem = {
  name: string;
  command: string;
  description: string;
};

export function getSlashCommandItems(filter = ''): SlashCommandItem[] {
  const query = filter.toLowerCase().replace(/^\//, '');
  return Object.entries(commands)
    .filter(([name]) => !query || name.startsWith(query))
    .map(([name, { description }]) => ({ name, command: `/${name}`, description }));
}

export function getSlashCommandRows(filter = '', selectedIndex = 0, width = 96): string[] {
  return getSlashCommandItems(filter).map((item, index) => {
    const selected = index === selectedIndex;
    const marker = selected ? chalk.hex('#de7a55')('›') : ' ';
    const command = selected ? chalk.bold.hex('#c7d2fe')(item.command.padEnd(12)) : chalk.hex('#de7a55')(item.command.padEnd(12));
    const plainPrefixLength = 2 + 12 + 1;
    const maxDescriptionLength = Math.max(12, width - plainPrefixLength);
    const description = item.description.length > maxDescriptionLength
      ? `${item.description.slice(0, Math.max(0, maxDescriptionLength - 1))}…`
      : item.description;
    return `${marker} ${command} ${chalk.gray(description)}`;
  });
}

async function cmdTools({ args, ctx }: { args: string; ctx: ShellContext }): Promise<void> {
  const trimmed = args.trim();
  if (!trimmed) {
    await cmdToolsList({ agent: ctx.agentName });
    return;
  }

  const deleteMatch = trimmed.match(/^(?:delete|rm|remove)\s+(.+)$/i);
  if (deleteMatch?.[1]) {
    const target = deleteMatch[1].trim();
    if (isDeleteAllToolsQuery(target)) {
      await cmdToolsDeleteAll({ agent: ctx.agentName });
    } else {
      await cmdToolsDelete(target, { agent: ctx.agentName });
    }
    return;
  }

  await cmdToolsSearch(trimmed, { agent: ctx.agentName });
}

async function cmdModel(args: string): Promise<void> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const provider = parts[0]?.toLowerCase();

  if (!provider) {
    printModel(await loadConfig());
    return;
  }

  if (provider === 'zero-g' || provider === 'og') {
    await setDecisionProvider('zero-g');
    return;
  }

  if (provider === 'openrouter' || provider === 'or') {
    await setOpenRouterModel(parts.slice(1).join(' ') || 'tencent/hy3-preview:free');
    return;
  }

  console.log();
  console.log(chalk.yellow('  Usage:'));
  console.log(chalk.gray('  /model'));
  console.log(chalk.gray('  /model zero-g'));
  console.log(chalk.gray('  /model openrouter [model-id]'));
  console.log();
}

export function getShellCommand(input: string): { command: ShellCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  if (trimmed === '/') {
    return { command: () => printCommandMenu(), args: '' };
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
