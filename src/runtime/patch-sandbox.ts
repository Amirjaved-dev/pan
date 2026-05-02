import { ToolSandbox, EvolutionEngine, type SandboxResult } from '@zero-agents/core';

const DEFAULT_TOOL_TIMEOUT_MS = 15_000;

type PatchableToolSandbox = {
  run(toolCode: string, params: object, timeoutMs?: number): Promise<SandboxResult>;
};

type PatchableEvolutionEngine = {
  runGenerationLoop(taskDescription: string, sampleParams: object): Promise<unknown>;
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

function extractUrlsFromCode(toolCode: string): string[] {
  const urlPattern = /https?:\/\/[^\s"'`)]+/g;
  const matches = toolCode.match(urlPattern);
  if (!matches) return [];
  return [...new Set(matches.map(u => u.replace(/['"`]/g, '')))];
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

function enrichHttpError(errorMsg: string, toolCode: string): string {
  if (!/HTTP error|404|fetch|network|failed to fetch|ECONNREFUSED|ENOTFOUND/i.test(errorMsg)) {
    return errorMsg;
  }

  const urls = extractUrlsFromCode(toolCode);
  const urlHints = urls.length > 0
    ? `\n\nURL(s) in the generated code:\n${urls.map(u => `  - ${u}`).join('\n')}`
    : '';

  const hints: string[] = [];
  if (/404/.test(errorMsg)) {
    hints.push('The URL returned 404 Not Found. Check the endpoint path, parameters, and that the API is publicly accessible without authentication.');
  }
  if (urls.some(u => /coingecko/.test(u))) {
    hints.push('CoinGecko requires specific coin IDs (e.g. "bitcoin" not "BTC"). Try api.coinbase.com/v2/prices/{SYMBOL}-USD/spot instead for simple spot prices.');
  }
  if (urls.some(u => /yahoo/.test(u))) {
    hints.push('Yahoo Finance APIs may block non-browser requests or require specific query parameters. Verify the endpoint works from a browser first.');
  }
  if (urls.some(u => /stooq/.test(u))) {
    hints.push('Stooq CSV endpoint: https://stooq.com/q/l/?s=SYMBOL&f=sd2t2ohlcv&h&e=csv (use lowercase symbol like "aapl.us").');
  }

  const hintBlock = hints.length > 0
    ? `\n\nTroubleshooting:\n${hints.map(h => `  - ${h}`).join('\n')}`
    : '';

  return `${errorMsg}${urlHints}${hintBlock}`;
}

export function patchToolSandboxDefaults(): void {
  if (isPatched) {
    return;
  }

  const sandboxPrototype = ToolSandbox.prototype as unknown as PatchableToolSandbox;
  const originalSandboxRun = sandboxPrototype.run;

  sandboxPrototype.run = async function run(toolCode: string, params: object, timeoutMs?: number): Promise<SandboxResult> {
    const validationError = validateToolCode(toolCode);
    if (validationError) {
      return { success: false, error: validationError, output: null, executionTimeMs: 0 };
    }

    const result = await originalSandboxRun.call(this, toolCode, params, timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS);

    if (result.success && isErrorOutput(result.output)) {
      return {
        ...result,
        success: false,
        error: enrichHttpError(result.output.error, toolCode),
      };
    }

    if (!result.success && result.error) {
      return {
        ...result,
        error: enrichHttpError(result.error, toolCode),
      };
    }

    return result;
  };

  const enginePrototype = EvolutionEngine.prototype as unknown as PatchableEvolutionEngine;
  const originalRunGenerationLoop = enginePrototype.runGenerationLoop;

  enginePrototype.runGenerationLoop = async function runGenerationLoop(taskDescription: string, sampleParams: object): Promise<unknown> {
    let feedback: string | undefined;
    const maxAttempts = (this as any).maxGenerationAttempts ?? 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      (this as any).emitStep({
        type: 'generating',
        message: `Generating tool attempt ${attempt}...`,
        data: { attempt },
      });

      const tool = await (this as any).generator.generateTool(
        feedback
          ? `${taskDescription}\n\nPrevious generated tool failed. Fix these issues in the next version:\n${feedback}`
          : taskDescription,
      );

      (this as any).emitStep({
        type: 'sandboxing',
        message: `Sandboxing generated tool ${tool.name}...`,
        data: { tool },
      });

      const sandboxResult = await (this as any).sandbox.run(tool.code, sampleParams);
      if (!sandboxResult.success) {
        feedback = `Sandbox failed before evaluation: ${sandboxResult.error ?? 'Unknown error'}`;
        continue;
      }

      (this as any).emitStep({
        type: 'evaluating',
        message: `Evaluating generated tool ${tool.name}...`,
        data: { tool },
      });

      const evalResult = await (this as any).evaluator.evaluate(tool);
      tool.successRate = evalResult.score;
      if (evalResult.passed) {
        (this as any).emitStep({
          type: 'saving',
          message: `Saving generated tool ${tool.name}...`,
          data: { tool },
        });
        await (this as any).registry.saveTool(tool);
        return tool;
      }
      feedback = `Evaluation score ${evalResult.score}. ${evalResult.feedback}`;
    }

    const { ToolGenerationError } = await import('@zero-agents/core');
    throw new ToolGenerationError(
      `Tool generation failed after ${maxAttempts} attempts. Last feedback: ${feedback ?? 'none'}`,
      maxAttempts,
    );
  };

  isPatched = true;
}
