import chalk from 'chalk';
import { doctorCommand } from '../commands/doctor.js';
import { initCommand } from '../commands/init.js';
import { printModel, setDecisionProvider, setOpenRouterModel } from '../commands/model.js';
import { cmdToolsDelete, cmdToolsDeleteAll, cmdToolsList, cmdToolsSearch, isDeleteAllToolsQuery } from '../commands/tools.js';
import { loadConfig } from '../config/load-config.js';
import { executeSlashAgents, executeSlashNetwork, executeSlashStatus, executeSlashSwitchAgent } from './execute-decision.js';
import { cmdNetworkSend, cmdNetworkShareTool, cmdNetworkMessages, cmdNetworkDemo, cmdNetworkRequestTool } from '../commands/network.js';
import { startMesh } from './mesh.js';

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
  demo: {
    fn: async () => {
      await cmdNetworkDemo();
    },
    description: 'Show live AXL multi-agent demo',
  },
  mesh: {
    fn: async () => {
      await startMesh();
    },
    description: 'Enter live tool exchange TUI with peer agent',
  },
  'request-tool': {
    fn: async (args: string) => {
      const trimmed = args.trim();
      if (!trimmed) {
        console.log(chalk.yellow('  Usage: /request-tool <tool-name> from <agent-ens>'));
        console.log(chalk.gray('  Example: /request-tool data-scraper from execute-agent.eth'));
        return;
      }

      const myEns = process.env.PAN_AGENT_ENS ?? '';
      const allPeers = [process.env.AGENT1_ENS_NAME, process.env.AGENT2_ENS_NAME, 'execute-agent.eth', 'research-agent.eth'].filter((v): v is string => !!v);
      const otherPeers = allPeers.filter(p => p.toLowerCase() !== myEns.toLowerCase());

      let targetEns: string;
      let rawToolName: string;

      const fromMatch = trimmed.match(/^(.+?)\s+from\s+(.+)$/i);
      if (fromMatch) {
        rawToolName = fromMatch[1].trim();
        targetEns   = fromMatch[2].trim();
        if (/^(any|all|available|some|a\s+tool|tools?)$/i.test(targetEns)) {
          targetEns = otherPeers[0] ?? allPeers[0] ?? targetEns;
        }
      } else {
        const parts = trimmed.split(/\s+/).filter(Boolean);
        const foundPeerIdx = parts.findIndex(p => allPeers.some(kp => kp.toLowerCase() === p.toLowerCase()));
        if (foundPeerIdx >= 0) {
          targetEns   = parts[foundPeerIdx];
          rawToolName = parts.filter((_, i) => i !== foundPeerIdx).join(' ') || 'any';
        } else if (parts.length >= 2 && parts[1].toLowerCase() === 'from' && parts.length >= 3) {
          rawToolName = parts[0];
          targetEns   = parts.slice(2).join(' ');
        } else {
          rawToolName = parts.join(' ');
          targetEns   = otherPeers[0] ?? allPeers[0] ?? 'execute-agent.eth';
        }
      }

      const toolName = rawToolName.replace(/^(get|fetch|request|find|give|show|list|search|grab)\s+/i, '').trim() || rawToolName;

      if (targetEns.toLowerCase() === myEns.toLowerCase()) {
        console.log(chalk.yellow(`  Cannot request tool from yourself (${myEns}). Requesting from ${otherPeers[0] ?? 'the other agent'} instead.`));
        targetEns = otherPeers[0] ?? allPeers.find(p => p.toLowerCase() !== myEns.toLowerCase()) ?? targetEns;
      }

      console.log(chalk.gray(`  Resolved: requesting "${toolName}" from ${targetEns}`));
      await cmdNetworkRequestTool(targetEns, toolName);
    },
    description: 'Request a tool from another agent via AXL',
  },
  network: {
    fn: async (args: string) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0 || parts[0] === 'status') {
        await executeSlashNetwork();
      } else if (parts[0] === 'messages') {
        await cmdNetworkMessages();
      } else if (parts[0] === 'demo') {
        await cmdNetworkDemo();
      } else if (parts[0] === 'send' && parts.length >= 3) {
        await cmdNetworkSend(parts[1], parts.slice(2).join(' '));
      } else if (parts[0] === 'share-tool' && parts.length >= 3) {
        await cmdNetworkShareTool(parts[1], parts[2]);
      } else {
        console.log(chalk.yellow('  Usage: /network [status|messages|demo|send <peer> <msg>|share-tool <peer> <tool>]'));
      }
    },
    description: 'Network status and messaging',
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
