export const DECISION_ACTIONS = [
  'respond_to_user',
  'ask_clarifying_question',
  'list_tools',
  'find_tool',
  'delete_tool',
  'get_status',
  'list_agents',
  'switch_agent',
  'use_or_create_tool',
  'plan_task',
] as const;

export const DECISION_INTENTS = [
  'chat',
  'question',
  'task',
  'tool_management',
  'agent_management',
  'status',
  'clarification_needed',
  'unsafe_or_invalid',
] as const;

export type DecisionAction = typeof DECISION_ACTIONS[number];
export type DecisionIntent = typeof DECISION_INTENTS[number];

export type AgentDecision = {
  intent: DecisionIntent;
  action: DecisionAction;
  confidence: number;
  reasoning: string;
  userResponse?: string | null;
  clarificationQuestion?: string | null;
  task?: string | null;
  toolQuery?: string | null;
  agentName?: string | null;
  params?: Record<string, unknown> | null;
};

const ACTIONS = new Set<string>(DECISION_ACTIONS);
const INTENTS = new Set<string>(DECISION_INTENTS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function normalizeDecision(value: unknown): AgentDecision | null {
  if (!isRecord(value)) return null;

  const intent = typeof value.intent === 'string' && INTENTS.has(value.intent) ? value.intent as DecisionIntent : null;
  const action = typeof value.action === 'string' && ACTIONS.has(value.action) ? value.action as DecisionAction : null;
  if (!intent || !action) return null;

  return {
    intent,
    action,
    confidence: asConfidence(value.confidence),
    reasoning: asOptionalString(value.reasoning) ?? 'No reasoning provided.',
    userResponse: asOptionalString(value.userResponse),
    clarificationQuestion: asOptionalString(value.clarificationQuestion),
    task: asOptionalString(value.task),
    toolQuery: asOptionalString(value.toolQuery),
    agentName: asOptionalString(value.agentName),
    params: isRecord(value.params) ? value.params : null,
  };
}
