import { ToolGenerator, type Tool } from '@zero-agents/core';

type ToolPayload = Pick<Tool, 'name' | 'description' | 'code' | 'schema' | 'tags'>;

type PatchableToolGenerator = {
  parseGeneratedTool(responseText: string): ToolPayload;
};

let isPatched = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return text;
}

function unwrapPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0];
  }

  if (!isRecord(value)) {
    return value;
  }

  return value.tool ?? value.generatedTool ?? value.result ?? value.data ?? value;
}

function normalizeSchema(schema: unknown): ToolPayload['schema'] {
  if (isRecord(schema)) {
    return {
      input: isRecord(schema.input) ? schema.input : isRecord(schema.inputSchema) ? schema.inputSchema : {},
      output: isRecord(schema.output) ? schema.output : isRecord(schema.outputSchema) ? schema.outputSchema : { result: 'object' },
    };
  }

  return {
    input: {},
    output: { result: 'object' },
  };
}

function normalizePayload(value: unknown): ToolPayload | null {
  const payload = unwrapPayload(value);
  if (!isRecord(payload)) {
    return null;
  }

  const code = payload.code ?? payload.function ?? payload.functionCode ?? payload.execute;
  if (typeof code !== 'string') {
    return null;
  }

  return {
    name: typeof payload.name === 'string' ? payload.name : 'generated_tool',
    description: typeof payload.description === 'string' ? payload.description : 'Generated Pan Agents tool',
    code,
    schema: normalizeSchema(payload.schema),
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  };
}

export function patchZeroAgentToolGeneration(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolGenerator.prototype as unknown as PatchableToolGenerator;
  const originalParse = prototype.parseGeneratedTool;

  prototype.parseGeneratedTool = function parseGeneratedTool(responseText: string): ToolPayload {
    try {
      return originalParse.call(this, responseText);
    } catch (originalError) {
      const parsed = JSON.parse(extractJson(responseText)) as unknown;
      const normalized = normalizePayload(parsed);
      if (!normalized) {
        throw originalError;
      }

      return normalized;
    }
  };

  isPatched = true;
}
