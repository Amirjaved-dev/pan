import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../config/load-config.js';
import { DECISION_SYSTEM_PROMPT } from './system-prompt.js';
import { type AgentDecision, normalizeDecision } from './action-schema.js';
import { guardDecision } from './decision-guard.js';
import { createZeroGChatCompletion } from './zero-g-compute.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

  if (/\b(what|tell|show)\b/i.test(lower) && /\b(know|remember|information|info)\b/i.test(lower) && /\b(me|my)\b/i.test(lower) || /\b(do you know me|do u know me|do you remember me|do u remember me)\b/i.test(lower)) {
    return {
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 0.7,
      reasoning: 'LLM unavailable; personal-knowledge question should not create a tool.',
      userResponse: 'I only know what is available in this local Pan Agents workspace and the current conversation. I do not know private personal details unless you tell me.',
    };
  }

  if (/\b(tool|tools|tooling)\b/i.test(lower) || /\b(delete|remove|rm)\s+(all|every|everything)\b/i.test(lower)) {
    if (/\b(delete|remove|rm|clear|wipe|purge)\b/i.test(lower)) {
      const deleteAll = /\b(all|every|everything)\b/i.test(lower);
      return {
        intent: 'tool_management',
        action: 'delete_tool',
        confidence: 0.75,
        reasoning: 'LLM unavailable; message asks to delete a tool.',
        toolQuery: deleteAll ? 'all' : text.replace(/\b(delete|remove|rm|tool|tools|tooling|called|named)\b/gi, '').trim() || null,
      };
    }

    return {
      intent: 'tool_management',
      action: /\b(search|find)\b/i.test(lower) ? 'find_tool' : 'list_tools',
      confidence: 0.65,
      reasoning: 'LLM unavailable; message refers to tools.',
      toolQuery: text.replace(/\b(search|find|show|list|what|available|availble|tool|tools|for)\b/gi, '').trim() || null,
    };
  }

  if (/\b(status|health|config|configuration|doctor)\b/i.test(lower)) {
    return {
      intent: 'status',
      action: 'get_status',
      confidence: 0.65,
      reasoning: 'LLM unavailable; message asks for status/configuration.',
    };
  }

  if (/\b(agent|agents)\b/i.test(lower)) {
    const switchMatch = lower.match(/\b(?:switch|use|select)\s+(?:to\s+)?([a-z0-9-_]+)/i);
    return {
      intent: 'agent_management',
      action: switchMatch?.[1] ? 'switch_agent' : 'list_agents',
      confidence: 0.65,
      reasoning: 'LLM unavailable; message asks about agents.',
      agentName: switchMatch?.[1] ?? null,
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

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://github.com/pan-agents/pan-agents',
      'X-Title': 'Pan Agents',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: DECISION_SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage(input, context) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
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
    const content = config.decision.provider === 'zero-g'
      ? await createZeroGDecision(input, context)
      : await createOpenRouterDecision(input, context, config.decision.openRouterModel);

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
