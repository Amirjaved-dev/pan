import { ENSIdentityManager } from '@zero-agents/core';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export async function detectEnsName(privateKey: string, rpcUrl?: string): Promise<string> {
  const identity = await ENSIdentityManager.autoDetect(privateKey, rpcUrl);

  if (!identity?.ensName) {
    throw new Error('No primary ENS name found for ENS_PRIVATE_KEY wallet');
  }

  return identity.ensName;
}

export async function createEnsIdentity(input: {
  ensName?: string;
  privateKey: string;
  rpcUrl?: string;
}): Promise<ENSIdentityManager> {
  if (input.ensName) {
    return new ENSIdentityManager(input);
  }

  const identity = await ENSIdentityManager.autoDetect(input.privateKey, input.rpcUrl);
  if (!identity) {
    throw new Error('No primary ENS name found for ENS_PRIVATE_KEY wallet');
  }

  return identity;
}
