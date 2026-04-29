import { Command } from 'commander';
import chalk from 'chalk';
import { ToolRegistry } from '@zero-agents/core';
import { config as loadEnv } from 'dotenv';
import { requireEnv } from '../identity/ens.js';
import { loadAgent } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';
import { getAgentRegistryPath } from '../config/paths.js';

function createRegistry(agentName: string): ToolRegistry {
  loadEnv();
  const zeroGKey = requireEnv('ZERO_G_PRIVATE_KEY');
  return new ToolRegistry({
    indexPointerPath: getAgentRegistryPath(agentName),
    zeroGPrivateKey: zeroGKey,
  });
}

export async function cmdToolsList(options: { agent?: string }): Promise<void> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);
  const registry = createRegistry(agent);

  console.log(chalk.bold(`\n  Tools for ${chalk.cyan(agent)}:\n`));

  try {
    const tools = await registry.exportTools();
    if (tools.length === 0) {
      console.log(chalk.gray('  No tools found. Run a task to generate tools.'));
      return;
    }

    for (const tool of tools.slice(0, 20)) {
      const t = tool as unknown as Record<string, unknown>;
      const name = t.name ?? 'unnamed';
      console.log(`  ${chalk.green(String(name))}`);
      if (t.rootHash) console.log(chalk.gray(`    Hash: ${String(t.rootHash).slice(0, 20)}...`));
      console.log();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.yellow(`  Could not load tool index: ${message}`));
    console.log(chalk.gray('  Tools may exist on 0G storage but index is not yet synced locally.'));
  }
}

async function cmdToolsShow(name: string, options: { agent?: string }): Promise<void> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);
  const registry = createRegistry(agent);

  console.log(chalk.bold(`\n  Tool: ${chalk.cyan(name)}\n`));

  const tool = await registry.getToolByName(name);
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

  const idxHash = await registry.getIndexRootHash();
  if (idxHash) console.log(`  Index Hash:  ${idxHash}`);
}

export async function cmdToolsSearch(query: string, options: { agent?: string }): Promise<void> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);
  const registry = createRegistry(agent);

  console.log(chalk.bold(`\n  Searching tools for: "${chalk.cyan(query)}"\n`));

  try {
    const results = await registry.searchTools(query);
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
