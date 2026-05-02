import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../config/load-config.js';
import { DECISION_SYSTEM_PROMPT } from './system-prompt.js';
import { type AgentDecision, normalizeDecision } from './action-schema.js';
import { guardDecision } from './decision-guard.js';
import { createZeroGChatCompletion } from './zero-g-compute.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DECISION_TIMEOUT_MS = 12_000;

export type DecisionContext = {
  agentName: string;
  cwd: string;
  recentMessages?: string[];
};

export type DecideActionOptions = {
  offline?: boolean;
};

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

function fallbackDecision(input: string): AgentDecision {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (!text) {
    return {
      intent: 'clarification_needed',
      action: 'ask_clarifying_question',
      confidence: 1,
      reasoning: 'Empty message.',
      clarificationQuestion: 'What do you want me to do?',
    };
  }

  if (/\b(who are you|who are u|who r u|what are you|what can you do|what can u do|what u can do|what abilities|what ability|abilities you have|abilities u have|your abilities|ur abilities|capabilities|features|how can you help|how can u help|hi|hii|hy|hello|helo|hey|yo|sup|thanks|thank you)\b/i.test(lower)) {
    return {
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 0.7,
      reasoning: 'LLM unavailable; obvious conversational message.',
      userResponse: 'I can answer direct questions, run repeatable tasks with generated/reused tools, and manage this CLI workspace: agents, tools, status, ENS identity, and AXL/network checks.',
    };
  }

  if (/\b(tool|tools|tooling|data|result|results)\b/i.test(lower) && /\b(bad|wrong|incorrect|low quality|low quility|quality|quility|untrusted|unreliable|garbage|nonsense)\b/i.test(lower)) {
    return {
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 0.8,
      reasoning: 'LLM unavailable; message is tool-quality feedback, not a tool inventory request.',
      userResponse: 'You are right. Bad generated tools should not be trusted or reused. I should classify your request first, use tools only as hands for concrete tasks, and reject obviously wrong live-data outputs instead of saving them as successful memories.',
    };
  }

  if (/\b(what|tell|show)\b/i.test(lower) && /\b(know|remember|information|info)\b/i.test(lower) && /\b(me|my)\b/i.test(lower) || /\b(do you know me|do u know me|do you remember me|do u remember me)\b/i.test(lower)) {
    return {
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 0.7,
      reasoning: 'LLM unavailable; personal-knowledge question should not create a tool.',
      userResponse: 'I only know what is available in this local Pan Agents workspace and the current conversation. I do not know private personal details unless you tell me.',
    };
  }

  if (/\b(plan|steps|how would you|how should we)\b/i.test(lower)) {
    return {
      intent: 'question',
      action: 'plan_task',
      confidence: 0.6,
      reasoning: 'LLM unavailable; message asks for a plan.',
      userResponse: `Plan:\n1. Clarify the exact outcome.\n2. Check current agent/tools.\n3. Reuse an existing tool if one fits.\n4. Create or improve a tool only if needed.\n5. Run the task and summarize the result.`,
    };
  }

  return {
    intent: 'task',
    action: 'use_or_create_tool',
    confidence: 0.55,
    reasoning: 'LLM unavailable; defaulting to executable task path.',
    task: text,
  };
}

function buildUserMessage(input: string, context: DecisionContext): string {
  return JSON.stringify({
    userMessage: input,
    context: {
      activeAgent: context.agentName,
      cwd: context.cwd,
      recentMessages: context.recentMessages ?? [],
    },
  });
}

async function createOpenRouterDecision(input: string, context: DecisionContext, model: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: DECISION_SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(input, context) },
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

    if (!response.ok) {
      throw new Error(`OpenRouter request failed with status ${response.status}: ${errorText}`);
    }
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned an empty response');
  return content;
}

async function createZeroGDecision(input: string, context: DecisionContext): Promise<string> {
  const privateKey = process.env.ZERO_G_PRIVATE_KEY;
  if (!privateKey) throw new Error('ZERO_G_PRIVATE_KEY is not configured');

  const config = await loadConfig();
  return createZeroGChatCompletion({
    privateKey,
    rpcUrl: config.ens.rpcUrl,
    messages: [
      { role: 'system', content: DECISION_SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(input, context) },
    ],
    temperature: 0,
  });
}

export async function decideAction(input: string, context: DecisionContext, options: DecideActionOptions = {}): Promise<AgentDecision> {
  loadEnv();

  if (options.offline) {
    return guardDecision(input, fallbackDecision(input));
  }

  try {
    const config = await loadConfig();
    const content = await withTimeout(
      config.decision.provider === 'zero-g'
        ? createZeroGDecision(input, context)
        : createOpenRouterDecision(input, context, config.decision.openRouterModel),
      DECISION_TIMEOUT_MS,
      'Decision LLM',
    );

    const decision = normalizeDecision(JSON.parse(extractJson(content)));
    if (decision) {
      if (decision.action === 'use_or_create_tool') {
        const guarded = guardDecision(input, decision);
        if (guarded.action !== 'use_or_create_tool') return guarded;
      }
      return decision;
    }

    return guardDecision(input, fallbackDecision(input));
  } catch {
    return guardDecision(input, fallbackDecision(input));
  }
}
