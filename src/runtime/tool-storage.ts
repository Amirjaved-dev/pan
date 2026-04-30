import type { SelfEvolvingAgent } from '@zero-agents/core';
import { getAgentLocalRegistryPath, getAgentLocalToolStorePath } from '../config/paths.js';

type PatchableRegistry = {
  indexPointerPath: string;
  localStorePath: string;
  storageMode: 'local' | 'zero-g' | 'auto';
};

export function useLocalToolStorage(agent: SelfEvolvingAgent, agentName: string): void {
  const registry = agent.getRegistry() as unknown as PatchableRegistry;
  registry.storageMode = 'local';
  registry.indexPointerPath = getAgentLocalRegistryPath(agentName);
  registry.localStorePath = getAgentLocalToolStorePath(agentName);
}

export function createLocalToolRegistryOptions(agentName: string): {
  indexPointerPath: string;
  localStorePath: string;
  storageMode: 'local';
} {
  return {
    indexPointerPath: getAgentLocalRegistryPath(agentName),
    localStorePath: getAgentLocalToolStorePath(agentName),
    storageMode: 'local',
  };
}
