import { join } from 'node:path';

export const PAN_DIR = '.pan-agents';
export const CONFIG_FILE = 'config.json';
export const AGENTS_DIR = 'agents';
export const TRACES_DIR = 'traces';

export function getPanDir(cwd = process.cwd()): string {
  return join(cwd, PAN_DIR);
}

export function getConfigPath(cwd = process.cwd()): string {
  return join(getPanDir(cwd), CONFIG_FILE);
}

export function getAgentsDir(cwd = process.cwd()): string {
  return join(getPanDir(cwd), AGENTS_DIR);
}

export function getAgentPath(agentName: string, cwd = process.cwd()): string {
  return join(getAgentsDir(cwd), `${agentName}.json`);
}

export function getAgentRegistryPath(agentName: string, cwd = process.cwd()): string {
  return join(getAgentsDir(cwd), `${agentName}.registry.json`);
}

export function getAgentExperiencePath(agentName: string, cwd = process.cwd()): string {
  return join(getAgentsDir(cwd), `${agentName}.experiences.json`);
}

export function getTracesDir(cwd = process.cwd()): string {
  return join(getPanDir(cwd), TRACES_DIR);
}
