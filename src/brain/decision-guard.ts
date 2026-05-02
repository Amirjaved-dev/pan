import type { AgentDecision } from './action-schema.js';

const CAPABILITY_RESPONSE = [
  'I can help in three concrete ways:',
  '1. Answer direct questions without creating useless tools.',
  '2. Run repeatable tasks with generated/reused tools, like fetching prices, calling public APIs, formatting data, or doing calculations.',
  '3. Manage this CLI workspace: agents, tools, status, ENS identity, and AXL/network checks.',
  '',
  'Good commands to try: /tools, /agent, /status, or ask me a specific task like "find the current SOL price".',
].join('\n');

const PERSONAL_KNOWLEDGE_RESPONSE = 'I only know what is available in this local Pan Agents workspace and the current conversation. I can see your active agent and stored tool history, but I do not know private personal details unless you tell me.';

const TOOL_QUALITY_RESPONSE = [
  'You are right. Bad generated tools should not be trusted or reused.',
  'I will treat tool quality feedback as feedback, not as a request to list tools. For live data, I should verify the result shape and reject obviously wrong values instead of saving them as successful memories.',
].join('\n');

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(input: string): number {
  return normalize(input).split(' ').filter(Boolean).length;
}

function isIdentityOrCapabilityMessage(input: string): boolean {
  const text = normalize(input);
  return /\b(who are you|who are u|what are you|what are u|what is pan agents|your name|ur name)\b/.test(text) ||
    /\b(what can you do|what can u do|what u can do|what abilities|what ability|abilities you have|abilities u have|your abilities|ur abilities|capabilities|features|how can you help|how can u help)\b/.test(text);
}

function isPersonalKnowledgeQuestion(input: string): boolean {
  const text = normalize(input);
  return /\b(what|tell|show)\b/.test(text) && /\b(know|remember|information|info)\b/.test(text) && /\b(me|about me|my)\b/.test(text) ||
    /\b(do you know me|do u know me|do you remember me|do u remember me|tell me about me|what do you know about me|what u know about me)\b/.test(text);
}

function isSimpleChat(input: string): boolean {
  const text = normalize(input);
  return /\b(hi|hii|hy|hello|helo|hey|yo|sup|thanks|thank you|thx)\b/.test(text) && wordCount(input) <= 4;
}

function isVagueQuestion(input: string): boolean {
  const text = normalize(input);
  return /\b(who|what|why|how|where)\b/.test(text) && wordCount(input) <= 3;
}

function isToolQualityFeedback(input: string): boolean {
  const text = normalize(input);
  return /\b(tool|tools|tooling|data|result|results)\b/.test(text) &&
    /\b(bad|wrong|incorrect|low quality|low quility|quality|quility|untrusted|unreliable|garbage|nonsense)\b/.test(text);
}

export function guardDecision(input: string, decision: AgentDecision): AgentDecision {
  if (isToolQualityFeedback(input)) {
    return {
      ...decision,
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 1,
      reasoning: 'Guardrail: tool-quality feedback should be acknowledged directly, not treated as a tool inventory request.',
      userResponse: TOOL_QUALITY_RESPONSE,
      task: null,
    };
  }

  if (isIdentityOrCapabilityMessage(input)) {
    return {
      ...decision,
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 1,
      reasoning: 'Guardrail: identity/capability message must not enter the tool runtime.',
      userResponse: CAPABILITY_RESPONSE,
      task: null,
    };
  }

  if (isPersonalKnowledgeQuestion(input)) {
    return {
      ...decision,
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 1,
      reasoning: 'Guardrail: personal-knowledge question should be answered directly, not converted into a generated tool.',
      userResponse: PERSONAL_KNOWLEDGE_RESPONSE,
      task: null,
    };
  }

  if (isSimpleChat(input)) {
    return {
      ...decision,
      intent: 'chat',
      action: 'respond_to_user',
      confidence: 1,
      reasoning: 'Guardrail: simple chat must not enter the tool runtime.',
      userResponse: 'I am here. Give me a task, ask a question, or ask what I can do.',
      task: null,
    };
  }

  if (decision.action === 'use_or_create_tool' && isVagueQuestion(input)) {
    return {
      ...decision,
      intent: 'clarification_needed',
      action: 'ask_clarifying_question',
      confidence: 1,
      reasoning: 'Guardrail: vague short question is not an executable task.',
      clarificationQuestion: 'What do you want to know or do?',
      task: null,
    };
  }

  return decision;
}
