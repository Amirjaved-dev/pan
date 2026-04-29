import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { getAgentPath, getAgentsDir } from '../config/paths.js';
import { agentConfigSchema, type AgentConfig } from './schema.js';

export async function saveAgent(agent: AgentConfig, cwd = process.cwd()): Promise<string> {
  const agentsDir = getAgentsDir(cwd);
  const agentPath = getAgentPath(agent.name, cwd);
  await mkdir(agentsDir, { recursive: true });
  await writeFile(agentPath, `${JSON.stringify(agent, null, 2)}\n`, 'utf8');
  return agentPath;
}

export async function loadAgent(agentName: string, cwd = process.cwd()): Promise<AgentConfig> {
  const raw = await readFile(getAgentPath(agentName, cwd), 'utf8');
  return agentConfigSchema.parse(JSON.parse(raw));
}

export async function listAgents(cwd = process.cwd()): Promise<AgentConfig[]> {
  try {
    const entries = await readdir(getAgentsDir(cwd), { withFileTypes: true });
    const agentNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => basename(entry.name, '.json'))
      .sort();

    return Promise.all(agentNames.map((agentName) => loadAgent(agentName, cwd)));
  } catch (error) {
    return [];
  }
}
