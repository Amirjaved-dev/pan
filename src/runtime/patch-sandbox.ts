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

export function patchToolSandboxDefaults(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolSandbox.prototype as unknown as PatchableToolSandbox;
  const originalRun = prototype.run;

  prototype.run = async function run(toolCode: string, params: object, timeoutMs?: number): Promise<SandboxResult> {
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
