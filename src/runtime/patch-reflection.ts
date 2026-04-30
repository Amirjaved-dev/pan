import { ReflectionEngine } from '@zero-agents/core';

type ReflectionInput = Parameters<ReflectionEngine['reflect']>[0];
type PatchableReflectionEngine = {
  reflect(input: ReflectionInput): ReturnType<ReflectionEngine['reflect']>;
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

export function patchReflectionErrorResults(): void {
  if (isPatched) return;

  const prototype = ReflectionEngine.prototype as unknown as PatchableReflectionEngine;
  const originalReflect = prototype.reflect;

  prototype.reflect = function reflect(input: ReflectionInput): ReturnType<ReflectionEngine['reflect']> {
    if (input.error === undefined && isErrorLikeResult(input.result)) {
      return originalReflect.call(this, {
        ...input,
        result: undefined,
        error: input.result.error,
      });
    }

    return originalReflect.call(this, input);
  };

  isPatched = true;
}
