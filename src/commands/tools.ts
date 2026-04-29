import { Command } from 'commander';
import chalk from 'chalk';
import { ToolRegistry } from '@zero-agents/core';
import { config as loadEnv } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { requireEnv } from '../identity/ens.js';
import { loadAgent } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';
import { getAgentExperiencePath, getAgentRegistryPath } from '../config/paths.js';
import { withQuietConsole } from '../runtime/quiet-console.js';

function createRegistry(agentName: string): ToolRegistry {
  loadEnv();
  const zeroGKey = requireEnv('ZERO_G_PRIVATE_KEY');
  return new ToolRegistry({
    indexPointerPath: getAgentRegistryPath(agentName),
    zeroGPrivateKey: zeroGKey,
  });
}

type LocalExperience = {
  toolUsed?: string;
  task?: string;
  success?: boolean;
  qualityScore?: number;
  createdAt?: number;
};

async function getLocalTools(agentName: string): Promise<Array<{ name: string; uses: number; lastTask?: string; lastUsedAt?: number }>> {
  const raw = await readFile(getAgentExperiencePath(agentName), 'utf8').catch(() => null);
  if (!raw) return [];

  const parsed = JSON.parse(raw) as { experiences?: LocalExperience[] };
  const tools = new Map<string, { name: string; uses: number; lastTask?: string; lastUsedAt?: number }>();

  for (const experience of parsed.experiences ?? []) {
    if (!experience.success || !experience.toolUsed) continue;
    const current = tools.get(experience.toolUsed) ?? { name: experience.toolUsed, uses: 0 };
    current.uses += 1;
    if (!current.lastUsedAt || (experience.createdAt ?? 0) > current.lastUsedAt) {
      current.lastTask = experience.task;
      current.lastUsedAt = experience.createdAt;
    }
    tools.set(experience.toolUsed, current);
  }

  return Array.from(tools.values()).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
}

export async function cmdToolsList(options: { agent?: string }): Promise<void> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);

  console.log(chalk.bold(`\n  Tools for ${chalk.cyan(agent)}:\n`));

  try {
    const tools = await getLocalTools(agent);
    if (tools.length === 0) {
      console.log(chalk.gray('  No tools found. Run a task to generate tools.'));
      return;
    }

    for (const tool of tools.slice(0, 20)) {
      console.log(`  ${chalk.green(tool.name)}`);
      if (tool.lastTask) console.log(chalk.gray(`    Last task: ${tool.lastTask}`));
      console.log(chalk.gray(`    Uses: ${tool.uses}`));
      console.log();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.yellow(`  Could not load local tool memory: ${message}`));
  }
}

async function cmdToolsShow(name: string, options: { agent?: string }): Promise<void> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);
  const registry = createRegistry(agent);

  console.log(chalk.bold(`\n  Tool: ${chalk.cyan(name)}\n`));

  const tool = await withQuietConsole(() => registry.getToolByName(name));
  if (!tool) {
    console.log(chalk.red(`  Tool "${name}" not found in registry.`));
    return;
  }

  const t = tool as unknown as Record<string, unknown>;
  if (t.name) console.log(`  Name:        ${t.name}`);
  if (t.description) console.log(`  Description: ${t.description}`);
  if (typeof t.code === 'string') {
    console.log(chalk.gray('\n  --- Code ---'));
    console.log(t.code.split('\n').map((l: string) => `  ${l}`).join('\n'));
  }
  if (t.rootHash) console.log(`\n  0G Hash:     ${t.rootHash}`);

  const idxHash = await withQuietConsole(() => registry.getIndexRootHash());
  if (idxHash) console.log(`  Index Hash:  ${idxHash}`);
}

export async function cmdToolsSearch(query: string, options: { agent?: string }): Promise<void> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);
  const registry = createRegistry(agent);

  console.log(chalk.bold(`\n  Searching tools for: "${chalk.cyan(query)}"\n`));

  try {
    const results = await withQuietConsole(() => registry.searchTools(query));
    if (results.length === 0) {
      console.log(chalk.gray('  No matching tools found.'));
      return;
    }

    for (const entry of results) {
      const e = entry as unknown as Record<string, unknown>;
      const name = e.name ?? 'unnamed';
      console.log(`  ${chalk.green(String(name))}`);
      if (e.description) console.log(chalk.gray(`    ${e.description}`));
      console.log();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.yellow(`  Search error: ${message}`));
  }
}

export function createToolsCommand(): Command {
  return new Command('tools')
    .description('Manage persisted 0G tools')
    .addCommand(
      new Command('list')
        .description('List all tools for an agent')
        .option('--agent <name>', 'agent name')
        .action(async (opts: { agent?: string }) => cmdToolsList(opts)),
    )
    .addCommand(
      new Command('show')
        .description('Show tool details and code')
        .argument('<name>', 'tool name')
        .option('--agent <name>', 'agent name')
        .action(async (name: string, opts: { agent?: string }) => cmdToolsShow(name, opts)),
    )
    .addCommand(
      new Command('search')
        .description('Search tools by query')
        .argument('<query>', 'search query')
        .option('--agent <name>', 'agent name')
        .action(async (query: string, opts: { agent?: string }) => cmdToolsSearch(query, opts)),
    );
}
