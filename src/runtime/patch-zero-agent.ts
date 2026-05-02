import { ToolGenerator, type Tool } from '@zero-agents/core';
import { PAN_SYSTEM_PROMPT } from './system-prompt.js';

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

function extractJsonStringField(text: string, field: string): string | null {
  const match = text.match(new RegExp(`"${field}"\\s*:\\s*"([^"\\n]*)"`, 'i'));
  return match?.[1] ?? null;
}

function extractExecuteFunction(text: string): string | null {
  const start = text.indexOf('async function execute');
  if (start < 0) return null;

  const open = text.indexOf('{', start);
  if (open < 0) return null;

  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function parseLooseToolPayload(text: string): ToolPayload | null {
  const code = extractExecuteFunction(text);
  if (!code) return null;

  const name = extractJsonStringField(text, 'name') ?? 'generated_tool';
  const description = extractJsonStringField(text, 'description') ?? 'Generated Pan Agents tool';

  return {
    name,
    description,
    code,
    schema: { input: {}, output: { result: 'object' } },
    tags: [],
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

Pan system prompt:
${PAN_SYSTEM_PROMPT}

Runtime notes:
- Return strict JSON only. The code field must be a valid JSON string with escaped newlines and quotes, not raw JavaScript outside JSON.
- Think like an agent building memory for future tasks. Generate reusable domain tools, not one-off tools for the literal example.
- Name tools by reusable capability. For example, a task like "find BTC price" should generate get_crypto_prices or get_crypto_price, accept symbol/symbols params, and support future BTC/ETH/SOL requests. Do not name it get_btc_price unless the task truly cannot generalize.
- Generated tools run in a secure isolated-vm sandbox.
- Network access is available through standard fetch(url, options).
- The tool is first sandbox-smoke-tested before evaluation, so it must run successfully with params={} and with natural-language params such as { query, task, terms, symbol, symbols }.
- Treat every params field as optional. Supported runtime params may include query, task, normalizedTask, terms, symbol, symbols, assetIds, and requestedOutput, but none are guaranteed.
- Evaluation may pass placeholder string values such as "sample" for schema fields. Validate symbols against known assets or task text before fetching; if a provided symbol is invalid or generic, fall back to the asset requested in the task description or a safe default like BTC.
- Never read nested fields like response.asset.price or params.assetIds.symbol without validating every parent first.
- Derive requested entities from params.query, params.task, normalizedTask, terms, or the task description. Handle reasonable user typos using general context, not hardcoded examples.
- Use public HTTPS JSON APIs that do not require API keys when live external data is needed.
- Do not use placeholder API keys, demo keys, or endpoints that require a secret the user did not provide.
- Always check response.ok, parse JSON defensively, validate nested fields before reading them, and return structured JSON errors instead of throwing on normal API failures.
- For price outputs, return numbers, not numeric strings. For Coinbase amount fields, use Number.parseFloat(data.data.amount) and validate Number.isFinite before returning.
- If an external-data task has a well-known public source, prefer stable endpoints over search-result pages or HTML scraping.
- For crypto prices, prefer symbol-pair spot APIs such as Coinbase's public https://api.coinbase.com/v2/prices/{SYMBOL}-USD/spot endpoint for single symbols, because it accepts tickers directly and avoids CoinGecko id mistakes. If using CoinGecko, prefer params.coinGeckoId, params.assetId, or params.assetIds[symbol]. Do not pass ticker symbols directly as CoinGecko ids.
- For mixed market-data requests, identify every requested asset first. Use appropriate public data sources for each asset class and return one result per requested item.
- If an expected API field is missing, return a structured error object instead of throwing during normal data validation. Throw only for programming errors.
- Do not use Node-only APIs such as require, process, fs, child_process, http, https, or net.`
      };
    });
  };

  prototype.parseGeneratedTool = function parseGeneratedTool(responseText: string): ToolPayload {
    try {
      return originalParse.call(this, responseText);
    } catch (originalError) {
      let normalized: ToolPayload | null = null;
      try {
        const parsed = JSON.parse(extractJson(responseText)) as unknown;
        normalized = normalizePayload(parsed);
      } catch {
        normalized = parseLooseToolPayload(responseText);
      }
      if (!normalized) {
        throw originalError;
      }

      return normalized;
    }
  };

  isPatched = true;
}
