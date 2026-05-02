import { ToolEvaluator } from '@zero-agents/core';

type PatchableToolEvaluator = {
  createSmokeInput(inputSchema: unknown): Record<string, unknown>;
};

let isPatched = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function patchToolEvaluatorSmokeInputs(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolEvaluator.prototype as unknown as PatchableToolEvaluator;
  const originalCreateSmokeInput = prototype.createSmokeInput;

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
