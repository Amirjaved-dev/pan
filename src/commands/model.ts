import { readFile, writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import { getConfigPath } from '../config/paths.js';
import { loadConfig } from '../config/load-config.js';
import { panConfigSchema, type PanConfig } from '../config/schema.js';

type DecisionProvider = PanConfig['decision']['provider'];

async function writeConfig(config: PanConfig): Promise<void> {
  const configPath = getConfigPath();
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function loadEditableConfig(): Promise<PanConfig> {
  const raw = await readFile(getConfigPath(), 'utf8');
  return panConfigSchema.parse(JSON.parse(raw));
}

export function printModel(config: PanConfig): void {
  console.log();
  console.log(chalk.bold('  Decision Model:'));
  console.log(`  Provider: ${chalk.green(config.decision.provider)}`);
  if (config.decision.provider === 'openrouter') {
    console.log(`  Model:    ${chalk.cyan(config.decision.openRouterModel)}`);
  }
  console.log();
}

export async function setDecisionProvider(provider: DecisionProvider): Promise<void> {
  const config = await loadEditableConfig();
  config.decision.provider = provider;
  await writeConfig(config);
  printModel(config);
}

export async function setOpenRouterModel(model: string): Promise<void> {
  const config = await loadEditableConfig();
  config.decision.provider = 'openrouter';
  config.decision.openRouterModel = model;
  await writeConfig(config);
  printModel(config);
}

export function createModelCommand(): Command {
  return new Command('model')
    .description('Show or change the decision model provider')
    .action(async () => printModel(await loadConfig()))
    .addCommand(
      new Command('openrouter')
        .description('Use OpenRouter for intent decisions')
        .argument('[model]', 'OpenRouter model id', 'tencent/hy3-preview:free')
        .action(async (model: string) => setOpenRouterModel(model)),
    )
    .addCommand(
      new Command('zero-g')
        .alias('og')
        .description('Use 0G Compute for intent decisions')
        .action(async () => setDecisionProvider('zero-g')),
    );
}
