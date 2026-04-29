import { ENSIdentityManager, type AgentProfile } from '@zero-agents/core';
import { getContract } from 'viem';
import { namehash, normalize } from 'viem/ens';

const RESOLVER_ABI = [
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    name: 'text',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    name: 'setText',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

type PatchableEnsIdentityManager = {
  ensName: string;
  publicClient: {
    getEnsResolver(input: { name: string }): Promise<`0x${string}` | null>;
    waitForTransactionReceipt(input: { hash: `0x${string}` }): Promise<unknown>;
  };
  walletClient: unknown;
};

type EnsResolverContract = {
  read: {
    text(input: [`0x${string}`, string]): Promise<string>;
  };
  write: {
    setText(input: [`0x${string}`, string, string]): Promise<`0x${string}`>;
  };
};

let isPatched = false;

function getRecords(profile: AgentProfile): Array<{ key: string; value: string }> {
  const records = [
    { key: 'description', value: profile.description },
    { key: 'capabilities', value: JSON.stringify(profile.capabilities) },
    { key: 'zeroagent.toolRegistry', value: profile.toolRegistryHash },
  ];

  if (profile.axlPeerId) {
    records.push({ key: 'zeroagent.axlPeerId', value: profile.axlPeerId });
  }

  if (profile.url) {
    records.push({ key: 'url', value: profile.url });
  }

  return records;
}

export function patchEnsSequentialWrites(): void {
  if (isPatched) {
    return;
  }

  ENSIdentityManager.prototype.setAgentProfile = async function setAgentProfile(profile: AgentProfile): Promise<void> {
    const manager = this as unknown as PatchableEnsIdentityManager;
    const resolverAddress = await manager.publicClient.getEnsResolver({ name: normalize(manager.ensName) });

    if (!resolverAddress) {
      throw new Error(`ENS name ${manager.ensName} does not have a resolver configured`);
    }

    const resolver = getContract({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      client: {
        public: manager.publicClient,
        wallet: manager.walletClient,
      },
    } as never) as unknown as EnsResolverContract;
    const node = namehash(normalize(manager.ensName));

    for (const record of getRecords(profile)) {
      const current = await resolver.read.text([node, record.key]);
      if (current === record.value) {
        continue;
      }

      const hash = await resolver.write.setText([node, record.key, record.value]);
      await manager.publicClient.waitForTransactionReceipt({ hash });
    }
  };

  isPatched = true;
}
