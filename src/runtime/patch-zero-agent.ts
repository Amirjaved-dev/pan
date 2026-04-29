import { ToolGenerator, type Tool } from '@zero-agents/core';

type ToolPayload = Pick<Tool, 'name' | 'description' | 'code' | 'schema' | 'tags'>;

type PatchableToolGenerator = {
  createMessages(taskDescription: string): Array<{ role: string; content: string }>;
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
  const originalCreateMessages = prototype.createMessages;
  const originalParse = prototype.parseGeneratedTool;

  prototype.createMessages = function createMessages(taskDescription: string): Array<{ role: string; content: string }> {
    const messages = originalCreateMessages.call(this, taskDescription);
    return messages.map((message) => {
      if (message.role !== 'system') {
        return message;
      }

      return {
        ...message,
        content: `${message.content}

Runtime notes:
- Generated tools run in a secure isolated-vm sandbox.
- Network access is available through standard fetch(url, options).
- The tool is first sandbox-smoke-tested before evaluation, so it must run successfully with params={} and with natural-language params such as { query, task, terms, symbol, symbols }.
- Treat params as optional. Derive safe defaults from the task description embedded in this prompt when params are missing.
- Use public HTTPS JSON APIs that do not require API keys when live external data is needed.
- Always check response.ok, parse JSON defensively, validate nested fields before reading them, and return structured JSON errors instead of throwing on normal API failures.
- If an external-data task has a well-known public source, prefer stable endpoints over search-result pages or HTML scraping.
- For cryptocurrency prices, CoinGecko's simple price endpoint is acceptable, but its ids parameter requires CoinGecko asset ids, not tickers. Use this mapping when relevant: btc -> bitcoin, eth -> ethereum, sol -> solana, ltc -> litecoin, doge -> dogecoin, xrp -> ripple. Never call ids=btc or read data.btc.usd; call ids=bitcoin and read data.bitcoin.usd after verifying data.bitcoin exists.
- If an expected API field is missing, return a structured error object instead of throwing during normal data validation. Throw only for programming errors.
- Do not use Node-only APIs such as require, process, fs, child_process, http, https, or net.`
      };
    });
  };

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
