import { ReflectionEngine } from '@zero-agents/core';
import { recordFailurePattern, extractTaskSignature } from './adaptive-memory.js';

type ReflectionInput = Parameters<ReflectionEngine['reflect']>[0];
type PatchableReflectionEngine = {
  reflect(input: ReflectionInput): ReturnType<ReflectionEngine['reflect']>;
};

export type FailureCategory =
  | 'api_unreachable'
  | 'api_auth_required'
  | 'wrong_endpoint'
  | 'bad_ticker_mapping'
  | 'wrong_data_source'
  | 'parse_error'
  | 'timeout'
  | 'empty_response'
  | 'implausible_result'
  | 'domain_mismatch'
  | 'unknown';

export type FailureAnalysis = {
  category: FailureCategory;
  detail: string;
  suggestedFix: string;
  toolName?: string;
};

let isPatched = false;

function isErrorLikeResult(value: unknown): value is { error: string } {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'error' in value &&
    typeof value.error === 'string' &&
    value.error.trim().length > 0;
}

function analyzeFailure(task: string, result: unknown, error?: string): FailureAnalysis {
  const errorStr = error ?? (isErrorLikeResult(result) ? result.error : typeof result === 'string' ? result : JSON.stringify(result));
  const lower = errorStr.toLowerCase();
  const taskLower = task.toLowerCase();

  if (/HTTP 40[0-9]/i.test(errorStr) || /status\s*40[0-9]/i.test(lower)) {
    if (lower.includes('401') || lower.includes('403')) {
      return {
        category: 'api_auth_required',
        detail: `API returned auth error (401/403): ${errorStr.slice(0, 200)}`,
        suggestedFix: 'Use a different public endpoint that does not require authentication or API keys.',
      };
    }
    if (lower.includes('404')) {
      const hasTicker = /\b[A-Z]{1,5}\b/.test(errorStr);
      if (hasTicker || /\b(ticker|symbol|chart|finance|stock)\b/i.test(lower)) {
        return {
          category: 'bad_ticker_mapping',
          detail: `Endpoint returned 404 — likely wrong ticker/symbol mapping for this asset class: ${errorStr.slice(0, 200)}`,
          suggestedFix: `The requested asset ("${taskLower.match(/\b(gold|silver|oil|platinum|copper|palladium|natural\s*gas|corn|wheat|coffee|sugar|cocoa)\b/i)?.[0] ?? 'unknown'}") may not use standard stock tickers. Identify the correct data source and symbol format for this commodity/market.`,
        };
      }
      return {
        category: 'wrong_endpoint',
        detail: `API endpoint returned 404: ${errorStr.slice(0, 200)}`,
        suggestedFix: 'Verify the API URL is correct for this data source. The endpoint structure may have changed.',
      };
    }
    return {
      category: 'api_unreachable',
      detail: `API returned HTTP error: ${errorStr.slice(0, 200)}`,
      suggestedFix: 'Try an alternative public data source or endpoint.',
    };
  }

  if (/\b(timeout|timed out|ETIMEDOUT|aborted|AbortError)\b/i.test(lower)) {
    return {
      category: 'timeout',
      detail: `Request timed out: ${errorStr.slice(0, 200)}`,
      suggestedFix: 'Reduce payload size, add proper timeout handling, or try a faster/lighter endpoint.',
    };
  }

  if (/\b(empty|no data|no results|null|undefined)\b/i.test(lower) && !/\b(price|value|amount)\b/i.test(lower)) {
    return {
      category: 'empty_response',
      detail: `Empty or null response from data source: ${errorStr.slice(0, 200)}`,
      suggestedFix: 'Check that the correct identifier/symbol is being used. Try alternative lookup approaches.',
    };
  }

  if (/\b(parse|json|syntax|unexpected|invalid|token)\b/i.test(lower)) {
    return {
      category: 'parse_error',
      detail: `Failed to parse response: ${errorStr.slice(0, 200)}`,
      suggestedFix: 'Add defensive parsing. Check response.ok before reading body. Validate nested fields exist before accessing.',
    };
  }

  if (/\b(coingecko|crypto)\b/i.test(lower) && /\b(stock|equity|nvidia|apple|tesla|gold|commodity)\b/i.test(taskLower)) {
    return {
      category: 'wrong_data_source',
      detail: `Used crypto/incorrect data source for non-crypto request: ${errorStr.slice(0, 200)}`,
      suggestedFix: 'This task requires a data source matching the actual asset class (commodity, equity, forex, etc.), not a crypto API.',
    };
  }

  if (/\b(yahoo|finance)\b/i.test(lower) && /\b(gold|oil|commodity|forex|crypto)\b/i.test(taskLower)) {
    return {
      category: 'domain_mismatch',
      detail: `Used stock finance API for non-stock asset class: ${errorStr.slice(0, 200)}`,
      suggestedFix: 'Yahoo Finance may not support this asset class. Find a commodity-specific or general market data source.',
    };
  }

  return {
    category: 'unknown',
    detail: errorStr.slice(0, 300),
    suggestedFix: 'Analyze what went wrong and try a fundamentally different approach — different API, different identifier scheme, or different data source.',
  };
}

export function initRootCauseAnalysis(): void {
  if (isPatched) return;

  const prototype = ReflectionEngine.prototype as unknown as PatchableReflectionEngine;
  const originalReflect = prototype.reflect;

  prototype.reflect = function reflect(input: ReflectionInput): ReturnType<ReflectionEngine['reflect']> {
    if (input.error === undefined && isErrorLikeResult(input.result)) {
      const analysis = analyzeFailure(input.task ?? '', input.result);
      recordFailurePattern({
        taskSignature: extractTaskSignature(input.task ?? ''),
        failureCategory: analysis.category,
        failureDetail: analysis.detail,
        toolName: input.toolUsed,
      });

      const enrichedInput = {
        ...input,
        result: undefined,
        error: input.result.error,
      };

      return originalReflect.call(this, enrichedInput);
    }

    if (input.error) {
      const errorStr = typeof input.error === 'string' ? input.error : String(input.error ?? '');
      const analysis = analyzeFailure(input.task ?? '', input.result, errorStr);
      recordFailurePattern({
        taskSignature: extractTaskSignature(input.task ?? ''),
        failureCategory: analysis.category,
        failureDetail: analysis.detail,
        toolName: input.toolUsed,
      });

      return originalReflect.call(this, input);
    }

    return originalReflect.call(this, input);
  };

  isPatched = true;
}

export { analyzeFailure };
