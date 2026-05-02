import { ToolEvaluator, type TestCase, type Tool } from '@zero-agents/core';

type PatchableToolEvaluator = {
  createSmokeInput(inputSchema: unknown): Record<string, unknown>;
  generateTestCases(tool: Tool): Promise<TestCase[]>;
};

let isPatched = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createMarketSmokeInput(tool: Tool): Record<string, unknown> | null {
  const text = [tool.name, tool.description, ...tool.tags].join(' ').toLowerCase();
  const isStock = /\b(stock|stocks|equity|equities|share|shares|ticker|nasdaq|nyse|nvidia|nvda)\b/.test(text);
  const isCrypto = /\b(crypto|cryptocurrency|token|coin|btc|bitcoin|ethereum|solana)\b/.test(text);

  if (!isStock && !isCrypto) return null;

  const symbol = isStock ? 'NVDA' : 'BTC';
  const query = isStock ? 'price of nvidia stock' : 'find btc price';
  return {
    query,
    task: query,
    normalizedTask: query,
    terms: query.match(/\b[A-Za-z][A-Za-z0-9-]{1,12}\b/g) ?? [],
    symbol,
    symbols: [symbol],
    ...(isCrypto ? { assetId: 'bitcoin', coinGeckoId: 'bitcoin', assetIds: { btc: 'bitcoin' } } : {}),
  };
}

export function patchToolEvaluatorSmokeInputs(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolEvaluator.prototype as unknown as PatchableToolEvaluator;
  const originalCreateSmokeInput = prototype.createSmokeInput;
  const originalGenerateTestCases = prototype.generateTestCases;

  prototype.generateTestCases = async function generateTestCases(tool: Tool): Promise<TestCase[]> {
    if (process.env.OPENAI_API_KEY) {
      return originalGenerateTestCases.call(this, tool);
    }

    const input = createMarketSmokeInput(tool) ?? this.createSmokeInput(tool.schema.input);
    return [{ input, description: `Smoke test for ${tool.name}` }];
  };

  prototype.createSmokeInput = function createSmokeInput(inputSchema: unknown): Record<string, unknown> {
    const input = originalCreateSmokeInput.call(this, inputSchema);
    if (!isRecord(inputSchema)) {
      return input;
    }

    for (const key of Object.keys(inputSchema)) {
      const normalized = key.toLowerCase();
      if (normalized === 'symbol') input[key] = 'BTC';
      if (normalized === 'symbols') input[key] = ['BTC'];
      if (normalized === 'assetid' || normalized === 'coingeckoid') input[key] = 'bitcoin';
      if (normalized === 'assetids') input[key] = { btc: 'bitcoin' };
      if (normalized === 'query' || normalized === 'task') input[key] = 'find btc price';
    }

    return input;
  };

  isPatched = true;
}
