import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SelfEvolvingAgent } from '@zero-agents/core';
import { getAgentLocalRegistryPath, getAgentLocalToolStorePath } from '../config/paths.js';

type PatchableRegistry = {
  indexPointerPath: string;
  localStorePath: string;
  storageMode: 'local' | 'zero-g' | 'auto';
};

type LocalToolStore = {
  blobs: Record<string, Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createLocalRootHash(data: unknown): string {
  return `local-${createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
}

async function readLocalStore(localStorePath: string): Promise<LocalToolStore> {
  try {
    const raw = await readFile(localStorePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.blobs)) return { blobs: {} };

    const blobs: LocalToolStore['blobs'] = {};
    for (const [key, value] of Object.entries(parsed.blobs)) {
      if (isRecord(value)) blobs[key] = value;
    }
    return { blobs };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { blobs: {} };
    }
    return { blobs: {} };
  }
}

async function writeLocalStore(localStorePath: string, store: LocalToolStore): Promise<void> {
  await mkdir(dirname(localStorePath), { recursive: true });
  await writeFile(localStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

async function hasValidIndexPointer(indexPointerPath: string): Promise<boolean> {
  try {
    const raw = await readFile(indexPointerPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) && typeof parsed.rootHash === 'string';
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
  }
}

export async function repairLocalToolStorage(agentName: string): Promise<void> {
  const indexPointerPath = getAgentLocalRegistryPath(agentName);
  const localStorePath = getAgentLocalToolStorePath(agentName);
  if (await hasValidIndexPointer(indexPointerPath)) return;

  const emptyIndex = { _meta: { updatedAt: Date.now(), count: 0 } };
  const rootHash = createLocalRootHash(emptyIndex);
  const store = await readLocalStore(localStorePath);
  store.blobs[rootHash] = emptyIndex;

  await writeLocalStore(localStorePath, store);
  await mkdir(dirname(indexPointerPath), { recursive: true });
  await writeFile(indexPointerPath, `${JSON.stringify({ rootHash }, null, 2)}\n`, 'utf8');
}

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
