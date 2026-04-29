import { join } from 'node:path';

export const PAN_DIR = '.pan-agents';
export const CONFIG_FILE = 'config.json';

export function getPanDir(cwd = process.cwd()): string {
  return join(cwd, PAN_DIR);
}

export function getConfigPath(cwd = process.cwd()): string {
  return join(getPanDir(cwd), CONFIG_FILE);
}
