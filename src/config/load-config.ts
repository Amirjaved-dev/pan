import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getConfigPath } from './paths.js';
import { defaultPanConfig, panConfigSchema, type PanConfig } from './schema.js';

export async function loadConfig(cwd = process.cwd()): Promise<PanConfig> {
  const configPath = getConfigPath(cwd);
  const raw = await readFile(configPath, 'utf8');
  return panConfigSchema.parse(JSON.parse(raw));
}

export async function writeDefaultConfig(cwd = process.cwd()): Promise<string> {
  const configPath = getConfigPath(cwd);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(defaultPanConfig, null, 2)}\n`, 'utf8');
  return configPath;
}
