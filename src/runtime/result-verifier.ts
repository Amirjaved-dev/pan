import type { TaskResult } from '@zero-agents/core';

export type VerificationResult = {
  ok: boolean;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasError(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasError(item));
  if (!isRecord(value)) return false;
  if (typeof value.error === 'string' && value.error.trim().length > 0) return true;
  return Object.values(value).some((item) => hasError(item));
}

function isEmptyResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!isRecord(value)) return false;

  const entries = Object.entries(value).filter(([key]) => !key.startsWith('_'));
  if (entries.length === 0) return true;

  return entries.some(([key, item]) => {
    if (/^(prices|results|items|data|quotes)$/i.test(key)) return isEmptyResult(item);
    return false;
  });
}

function hasNullLiveData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNullLiveData(item));
  if (!isRecord(value)) return value === null;

  return Object.entries(value).some(([key, item]) => {
    if (item === null && /price|quote|value|usd|amount|rate|market|btc|stock|asset|symbol|apple|nvidia/i.test(key)) {
      return true;
    }
    return hasNullLiveData(item);
  });
}

function isJsonRequested(task: string): boolean {
  return /\bjson\b/i.test(task);
}

export function verifyTaskResult(task: string, result: TaskResult): VerificationResult {
  if (hasError(result.output)) {
    return { ok: false, reason: `tool returned error: ${String((result.output as { error: string }).error)}` };
  }

  if (isJsonRequested(task)) {
    if (typeof result.output === 'string') {
      try {
        JSON.parse(result.output);
      } catch {
        return { ok: false, reason: 'user requested JSON but tool returned a non-JSON string' };
      }
    }
  }

  if (/(live|current|price|prices|market)\b/i.test(task) && hasError(result.output)) {
    return { ok: false, reason: 'live data task returned an error object' };
  }

  if (/(live|current|price|prices|market)\b/i.test(task) && isEmptyResult(result.output)) {
    return { ok: false, reason: 'live data task returned no usable results' };
  }

  if (/(live|current|price|prices|market)\b/i.test(task) && hasNullLiveData(result.output)) {
    return { ok: false, reason: 'live data task returned null prices or missing quote values' };
  }

  return { ok: true };
}
