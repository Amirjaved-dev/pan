import { z } from 'zod';

export const agentConfigSchema = z.object({
  name: z.string().min(1),
  ensName: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(z.string().min(1)).default([]),
  toolRegistryHash: z.string().min(1).nullable().default(null),
  axlPeerId: z.string().min(1).nullable().default(null),
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

export function createAgentConfig(input: {
  name: string;
  ensName: string;
  description?: string;
  capabilities?: string[];
}): AgentConfig {
  const now = Date.now();

  return agentConfigSchema.parse({
    name: input.name,
    ensName: input.ensName,
    description: input.description ?? `${input.name} Pan Agent`,
    capabilities: input.capabilities ?? [],
    toolRegistryHash: null,
    axlPeerId: null,
    createdAt: now,
    updatedAt: now,
  });
}
