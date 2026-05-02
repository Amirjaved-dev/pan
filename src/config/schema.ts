import { z } from 'zod';

export const panConfigSchema = z.object({
  defaultAgent: z.string().min(1).default('auto-agent'),
  storageMode: z.literal('zero-g').default('zero-g'),
  axl: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().positive().default(9002),
    autoStart: z.boolean().default(true),
  }),
  ens: z.object({
    enabled: z.boolean().default(true),
    rpcUrl: z.string().url().default('https://sepolia.drpc.org'),
  }),
  sandbox: z.object({
    allowUnsafeNodeVmFallback: z.boolean().default(false),
  }),
  decision: z.object({
    provider: z.enum(['openrouter', 'zero-g']).default('openrouter'),
    openRouterModel: z.string().min(1).default('tencent/hy3-preview:free'),
  }).default({
    provider: 'openrouter',
    openRouterModel: 'tencent/hy3-preview:free',
  }),
});

export type PanConfig = z.infer<typeof panConfigSchema>;

export const defaultPanConfig: PanConfig = panConfigSchema.parse({
  defaultAgent: 'auto-agent',
  storageMode: 'zero-g',
  axl: {
    enabled: true,
    port: 9002,
    autoStart: true,
  },
  ens: {
    enabled: true,
    rpcUrl: 'https://sepolia.drpc.org',
  },
  sandbox: {
    allowUnsafeNodeVmFallback: false,
  },
  decision: {
    provider: 'openrouter',
    openRouterModel: 'tencent/hy3-preview:free',
  },
});
