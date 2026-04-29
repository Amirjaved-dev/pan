import { z } from 'zod';

export const panConfigSchema = z.object({
  defaultAgent: z.string().min(1).default('main-agent'),
  storageMode: z.literal('zero-g').default('zero-g'),
  axl: z.object({
    enabled: z.literal(true).default(true),
    port: z.number().int().positive().default(9002),
  }),
  ens: z.object({
    enabled: z.literal(true).default(true),
    rpcUrl: z.string().url().default('https://sepolia.drpc.org'),
  }),
  sandbox: z.object({
    allowUnsafeNodeVmFallback: z.literal(false).default(false),
  }),
});

export type PanConfig = z.infer<typeof panConfigSchema>;

export const defaultPanConfig: PanConfig = panConfigSchema.parse({
  defaultAgent: 'main-agent',
  storageMode: 'zero-g',
  axl: {
    enabled: true,
    port: 9002,
  },
  ens: {
    enabled: true,
    rpcUrl: 'https://sepolia.drpc.org',
  },
  sandbox: {
    allowUnsafeNodeVmFallback: false,
  },
});
