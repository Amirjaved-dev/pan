import { ToolGenerator, type Tool } from '@zero-agents/core';
import { PAN_SYSTEM_PROMPT } from './system-prompt.js';
import { getFailurePatterns, extractTaskSignature } from './adaptive-memory.js';
import type { FailureCategory } from './root-cause-analysis.js';

type ToolPayload = Pick<Tool, 'name' | 'description' | 'code' | 'schema' | 'tags'>;

type PatchableToolGenerator = {
  createMessages(taskDescription: string): Array<{ role: string; content: string }>;
  parseGeneratedTool(responseText: string): ToolPayload;
};

let isPatched = false;

let pendingFailureContext: string | null = null;

export function setFailureContextForGeneration(context: string | null): void {
  pendingFailureContext = context;
}

function buildFailureHint(taskDescription: string): string {
  if (!pendingFailureContext) return '';

  const patterns = getFailurePatterns();
  const taskSig = extractTaskSignature(taskDescription);
  const relevantFailures = patterns
    .filter((p) => signatureOverlap(taskSig, p.taskSignature) > 0.3)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);

  if (relevantFailures.length === 0) return '';

  const lines = relevantFailures.map((f) =>
    `  - [${f.failureCategory}] ${f.failureDetail} (${f.attemptCount} attempt(s))`
  ).join('\n');

  const hint = `
Previous failures on similar tasks (DO NOT repeat these mistakes):
${lines}
${pendingFailureContext ? `\nSpecific guidance from last failure:\n  ${pendingFailureContext}` : ''}
`;

  pendingFailureContext = null;
  return hint;
}

function signatureOverlap(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const term of setA) {
    if (setB.has(term)) intersection += 1;
  }
  return intersection / Math.min(setA.size, setB.size);
}

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

export function initToolGenerator(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolGenerator.prototype as unknown as PatchableToolGenerator;
  const originalCreateMessages = prototype.createMessages;
  const originalParse = prototype.parseGeneratedTool;

  prototype.createMessages = function createMessages(taskDescription: string): Array<{ role: string; content: string }> {
    const messages = originalCreateMessages.call(this, taskDescription);
    const failureHint = buildFailureHint(taskDescription);

    return messages.map((message) => {
      if (message.role !== 'system') {
        return message;
      }

      return {
        ...message,
        content: `${message.content}

Pan system prompt:
${PAN_SYSTEM_PROMPT}

Discovery & generation rules:
- You are building tools that LEARN and IMPROVE over time. Each tool should handle its domain broadly, not just one example.
- Identify the ASSET CLASS first: crypto (BTC/ETH/SOL), equity (stocks like NVDA/AAPL), commodity (gold/oil/silver), forex, or other.
- For each asset class, DISCOVER the right public data source. Do not assume one API works for everything.
- Crypto: Coinbase spot (api.coinbase.com/v2/prices/{SYMBOL}-USD/spot) accepts tickers directly and is the most reliable no-key option. CoinGecko needs coin IDs not tickers and may rate-limit.
- Equities: Yahoo Finance chart API (query1.finance.yahoo.com) for major US stocks. Map company names to tickers.
- Commodities: Gold=XAU, Oil=CRUDE, Silver=XAG. These are NOT stock tickers. Yahoo uses GC=F for gold, SI=F for silver, CL=F for crude oil. Metal/commodity price APIs differ from stock APIs.
- IMPORTANT: Always test the exact URL you construct. A 404 means the URL path is wrong. Double-check parameter interpolation.
- If an API returns 404, try a different API entirely rather than tweaking the same broken URL.
- For unknown asset classes, use try/catch with multiple fallback APIs.
- Forex: Currency pairs like EUR-USD, GBP-USD use different endpoints than stocks or crypto.
- If you do not know the correct data source for an asset class, write the tool to try multiple public sources with fallback logic.
- Name tools by reusable capability: get_market_price, get_crypto_price, get_commodity_price — not get_btc_price or get_gold_price.
- Accept symbol/symbols/query params and resolve them to the correct identifier format for each data source.
- Generated tools run in a secure isolated-vm sandbox with fetch() available.
- Network access through standard fetch(url, options). No API keys unless user provided one.
- Treat every params field as optional. Supported runtime params may include query, task, normalizedTask, terms, symbol, symbols, assetIds, requestedOutput.
- Validate all API responses defensively: check response.ok, validate nested fields exist before reading, return structured error objects on failure.
- Return numbers for prices, not strings. Use Number.isFinite() to validate before returning.
- Do not use Node-only APIs: require, process, fs, child_process, http, https, net.
- Do not use placeholder or demo API keys.${failureHint ? `\n${failureHint}` : ''}`,
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
