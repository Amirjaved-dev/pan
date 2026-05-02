import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../config/load-config.js';
import { createZeroGChatCompletion } from './zero-g-compute.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REFINEMENT_TIMEOUT_MS = 8_000;

export type TaskRefinement = {
  task: string;
  summary?: string;
  clarificationQuestion?: string;
};

type RefinementPayload = {
  executableTask?: unknown;
  confidence?: unknown;
  summary?: unknown;
  clarificationQuestion?: unknown;
};

const TASK_REFINER_PROMPT = `You refine user requests before an autonomous agent uses tools.

Do not solve the task. Do not reveal chain-of-thought. Return only JSON.

Goal:
- Convert the user's request into the most precise executable task for a tool-using agent.
- Preserve the user's intent.
- Resolve ambiguity before tool use when possible.

Market-data rules:
- If the user asks for a stock price of a brand, product, website, app, or subsidiary that is not itself publicly traded, identify the publicly traded parent company and ticker if you know it.
- If you are not confident about the public company/ticker, ask one clarification question instead of guessing.
- If the user asks for a crypto, commodity, stock, or historical price, include the asset class and symbol/ticker/id when known.
- Never invent a ticker.

Return JSON exactly:
{
  "executableTask": "cleaned task to execute, or null",
  "confidence": 0.0,
  "summary": "one short visible summary of what was resolved, or null",
  "clarificationQuestion": "one short question if needed, otherwise null"
}`;

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1];

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizePayload(value: unknown): TaskRefinement | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  const payload = value as RefinementPayload;
  const confidence = typeof payload.confidence === 'number' && Number.isFinite(payload.confidence) ? payload.confidence : 0;
  const task = asString(payload.executableTask);
  const clarificationQuestion = asString(payload.clarificationQuestion);
  const summary = asString(payload.summary);

  if (clarificationQuestion && confidence < 0.75) {
    return { task: '', clarificationQuestion, summary };
  }

  if (!task || confidence < 0.6) return null;
  return { task, summary };
}

async function createOpenRouterRefinement(userTask: string, decisionTask: string, model: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: TASK_REFINER_PROMPT },
      { role: 'user', content: JSON.stringify({ userTask, decisionTask }) },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  };

  let response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/pan-agents/pan-agents',
      'X-Title': 'Pan Agents',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    if (response.status === 400 && /json mode|response_format/i.test(errorText)) {
      const { response_format: _responseFormat, ...retryBody } = requestBody;
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/pan-agents/pan-agents',
          'X-Title': 'Pan Agents',
        },
        body: JSON.stringify(retryBody),
      });
    }

    if (!response.ok) throw new Error(`OpenRouter request failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned an empty response');
  return content;
}

async function createZeroGRefinement(userTask: string, decisionTask: string): Promise<string> {
  const privateKey = process.env.ZERO_G_PRIVATE_KEY;
  if (!privateKey) throw new Error('ZERO_G_PRIVATE_KEY is not configured');

  const config = await loadConfig();
  return createZeroGChatCompletion({
    privateKey,
    rpcUrl: config.ens.rpcUrl,
    messages: [
      { role: 'system', content: TASK_REFINER_PROMPT },
      { role: 'user', content: JSON.stringify({ userTask, decisionTask }) },
    ],
    temperature: 0,
  });
}

export async function refineExecutableTask(userTask: string, decisionTask: string): Promise<TaskRefinement> {
  loadEnv();

  try {
    const config = await loadConfig();
    const content = await withTimeout(
      config.decision.provider === 'zero-g'
        ? createZeroGRefinement(userTask, decisionTask)
        : createOpenRouterRefinement(userTask, decisionTask, config.decision.openRouterModel),
      REFINEMENT_TIMEOUT_MS,
      'Task refinement LLM',
    );
    const parsed = JSON.parse(extractJson(content)) as unknown;
    return normalizePayload(parsed) ?? { task: decisionTask };
  } catch {
    return { task: decisionTask };
  }
}
