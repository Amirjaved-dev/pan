import { Command } from 'commander';
import chalk from 'chalk';
import { ToolRegistry } from '@zero-agents/core';
import { config as loadEnv } from 'dotenv';
import { readFile, writeFile } from 'node:fs/promises';
import { requireEnv } from '../identity/ens.js';
import { loadAgent } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';
import { getAgentExperiencePath, getAgentLocalRegistryPath, getAgentLocalToolStorePath } from '../config/paths.js';
import { withQuietConsole } from '../runtime/quiet-console.js';
import { createLocalToolRegistryOptions } from '../runtime/tool-storage.js';

function createRegistry(agentName: string): ToolRegistry {
  loadEnv();
  const zeroGKey = requireEnv('ZERO_G_PRIVATE_KEY');
  return new ToolRegistry({
    ...createLocalToolRegistryOptions(agentName),
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

type LocalStore = {
  blobs?: Record<string, Record<string, unknown>>;
};

type ToolDeletePreview = {
  agent: string;
  toolNames: string[];
  experienceCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  const raw = await readFile(path, 'utf8').catch(() => null);
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

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

export function isDeleteAllToolsQuery(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return /\b(all|everything|every)\b/.test(normalized) || /\b(clear|wipe|purge)\b/.test(normalized);
}

export async function previewDeleteAllTools(options: { agent?: string }): Promise<ToolDeletePreview> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);

  const tools = await getLocalTools(agent);
  const experiences = await readJsonFile<{ experiences?: LocalExperience[] }>(getAgentExperiencePath(agent), { experiences: [] });

  return {
    agent,
    toolNames: tools.map((tool) => tool.name),
    experienceCount: experiences.experiences?.filter((experience) => Boolean(experience.toolUsed)).length ?? 0,
  };
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

export async function cmdToolsDelete(name: string, options: { agent?: string }): Promise<void> {
  if (isDeleteAllToolsQuery(name)) {
    await cmdToolsDeleteAll(options);
    return;
  }

  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);

  const registry = createRegistry(agent);
  const tool = await withQuietConsole(() => registry.getToolByName(name));
  if (!tool) {
    console.log(chalk.yellow(`\n  Tool "${name}" not found for ${agent}.\n`));
    return;
  }

  const storePath = getAgentLocalToolStorePath(agent);
  const pointerPath = getAgentLocalRegistryPath(agent);
  const experiencePath = getAgentExperiencePath(agent);
  const store = await readJsonFile<LocalStore>(storePath, { blobs: {} });
  const blobs = store.blobs ?? {};
  const pointer = await readJsonFile<{ rootHash?: string }>(pointerPath, {});
  const rootHash = (tool as { rootHash?: string }).rootHash;
  let removedFromIndex = false;

  if (pointer.rootHash && isRecord(blobs[pointer.rootHash])) {
    const indexBlob = blobs[pointer.rootHash];
    if (name in indexBlob) {
      delete indexBlob[name];
      removedFromIndex = true;
    }

    if (isRecord(indexBlob._history)) {
      delete indexBlob._history[name];
      if (Object.keys(indexBlob._history).length === 0) delete indexBlob._history;
    }

    const toolCount = Object.keys(indexBlob).filter((key) => !key.startsWith('_')).length;
    indexBlob._meta = { updatedAt: Date.now(), count: toolCount };
  }

  if (rootHash && rootHash in blobs) {
    delete blobs[rootHash];
  }

  const experiences = await readJsonFile<{ experiences?: LocalExperience[] }>(experiencePath, { experiences: [] });
  const beforeExperienceCount = experiences.experiences?.length ?? 0;
  experiences.experiences = (experiences.experiences ?? []).filter((experience) => experience.toolUsed !== name);

  await writeJsonFile(storePath, { blobs });
  await writeJsonFile(experiencePath, experiences);

  const removedExperiences = beforeExperienceCount - experiences.experiences.length;
  console.log(chalk.green(`\n  Deleted tool "${name}" from ${agent}.`));
  if (removedFromIndex) console.log(chalk.gray('  Removed from local registry index.'));
  if (rootHash) console.log(chalk.gray(`  Removed local tool blob: ${rootHash}`));
  if (removedExperiences > 0) console.log(chalk.gray(`  Removed ${removedExperiences} matching experience record(s).`));
  console.log();
}

export async function cmdToolsDeleteAll(options: { agent?: string }): Promise<void> {
  const config = await loadConfig();
  const agent = options.agent ?? config.defaultAgent;
  await loadAgent(agent);

  const storePath = getAgentLocalToolStorePath(agent);
  const pointerPath = getAgentLocalRegistryPath(agent);
  const experiencePath = getAgentExperiencePath(agent);
  const preview = await previewDeleteAllTools({ agent });

  await writeJsonFile(storePath, { blobs: {} });
  await writeJsonFile(pointerPath, {});
  await writeJsonFile(experiencePath, { experiences: [] });

  console.log(chalk.green(`\n  Deleted all tools from ${agent}.`));
  console.log(chalk.gray(`  Removed ${preview.toolNames.length} tool name(s).`));
  console.log(chalk.gray(`  Removed ${preview.experienceCount} tool experience record(s).`));
  console.log();
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
    )
    .addCommand(
      new Command('delete')
        .alias('rm')
        .description('Delete one tool, or all tools, from an agent')
        .argument('<name>', 'tool name')
        .option('--agent <name>', 'agent name')
        .action(async (name: string, opts: { agent?: string }) => cmdToolsDelete(name, opts)),
    );
}
