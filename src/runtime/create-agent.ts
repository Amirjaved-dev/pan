import { SelfEvolvingAgent } from '@zero-agents/core';
import { config as loadEnv } from 'dotenv';
import { loadAgent } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';
import { getAgentExperiencePath, getAgentRegistryPath } from '../config/paths.js';
import { createEnsIdentity, requireEnv } from '../identity/ens.js';
import { patchEnsSequentialWrites } from './patch-ens.js';
import { patchReflectionErrorResults } from './patch-reflection.js';
import { patchToolSandboxDefaults } from './patch-sandbox.js';
import { patchZeroAgentToolGeneration } from './patch-zero-agent.js';
import { logAgentStep } from './step-logger.js';
import { useLocalToolStorage } from './tool-storage.js';

export async function createPanAgent(agentName?: string): Promise<SelfEvolvingAgent> {
  loadEnv();

  const config = await loadConfig();
  const resolvedAgentName = agentName ?? config.defaultAgent;
  const agent = await loadAgent(resolvedAgentName);
  const zeroGPrivateKey = requireEnv('ZERO_G_PRIVATE_KEY');
  const ensPrivateKey = requireEnv('ENS_PRIVATE_KEY');
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? config.ens.rpcUrl;
  patchEnsSequentialWrites();
  patchReflectionErrorResults();
  patchToolSandboxDefaults();
  const identity = await createEnsIdentity({
    ensName: agent.ensName,
    privateKey: ensPrivateKey,
    rpcUrl,
  });

  patchZeroAgentToolGeneration();

  const runtime = new SelfEvolvingAgent({
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
    identity,
    zeroGPrivateKey,
    axlEnabled: config.axl.enabled,
    axlPort: config.axl.port,
    registryPath: getAgentRegistryPath(agent.name),
    experienceMemoryPath: getAgentExperiencePath(agent.name),
    allowUnsafeNodeVmFallback: config.sandbox.allowUnsafeNodeVmFallback,
    evolutionTimeoutMs: 180_000,
    testCaseTimeoutMs: 15_000,
  });

  useLocalToolStorage(runtime, agent.name);

  runtime.on('step', logAgentStep);
  return runtime;
}
