import type { TaskResult } from '@zero-agents/core';

export type VerificationResult = {
  ok: boolean;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.error === 'string' && value.error.trim().length > 0;
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

  return { ok: true };
}
