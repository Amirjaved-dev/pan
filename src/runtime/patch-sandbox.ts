import { ToolSandbox, type SandboxResult } from '@zero-agents/core';

const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

type PatchableToolSandbox = {
  run(toolCode: string, params: object, timeoutMs?: number): Promise<SandboxResult>;
};

let isPatched = false;

function isErrorOutput(output: unknown): output is { error: string } {
  return (
    output !== null &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    'error' in output &&
    typeof output.error === 'string' &&
    output.error.length > 0
  );
}

function validateToolCode(toolCode: string): string | null {
  if (/YOUR[_-]?API[_-]?KEY|INSERT[_-]?API[_-]?KEY|apiKey=demo|apikey=demo/i.test(toolCode)) {
    return 'Generated tool used a placeholder API key. Use only public endpoints that work without secrets, or return a clear unsupported-data-source error.';
  }

  if (/coingecko\.com/i.test(toolCode) && /\b(nvidia|nvda|apple|aapl|tesla|tsla|stock|stocks|equity|ticker)\b/i.test(toolCode)) {
    return 'Generated stock-price tool used CoinGecko, which is a crypto API. Use a no-key equities source such as Stooq CSV for stocks.';
  }

  if (/console\.(log|error|warn|info)\s*\(/.test(toolCode)) {
    return 'Generated tool writes to console. Return structured data instead of logging.';
  }

  return null;
}

export function patchToolSandboxDefaults(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolSandbox.prototype as unknown as PatchableToolSandbox;
  const originalRun = prototype.run;

  prototype.run = async function run(toolCode: string, params: object, timeoutMs?: number): Promise<SandboxResult> {
    const validationError = validateToolCode(toolCode);
    if (validationError) {
      return { success: false, error: validationError, output: null, executionTimeMs: 0 };
    }

    const result = await originalRun.call(this, toolCode, params, timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS);

    if (result.success && isErrorOutput(result.output)) {
      return {
        ...result,
        success: false,
        error: result.output.error,
      };
    }

    return result;
  };

  isPatched = true;
}
