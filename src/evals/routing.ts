import { decideAction } from '../brain/decide-action.js';
import type { DecisionAction, DecisionIntent } from '../brain/action-schema.js';

type RoutingEvalCase = {
  name: string;
  input: string;
  action: DecisionAction;
  intent?: DecisionIntent;
  taskMustBeNull?: boolean;
  responseIncludes?: string;
};

export type RoutingEvalResult = {
  name: string;
  input: string;
  passed: boolean;
  expected: string;
  actual: string;
};

const CASES: RoutingEvalCase[] = [
  {
    name: 'capability question answers directly',
    input: 'what u can do for me',
    action: 'respond_to_user',
    intent: 'chat',
    taskMustBeNull: true,
    responseIncludes: 'I can help in three concrete ways',
  },
  {
    name: 'abilities question answers directly',
    input: 'what abilities u have',
    action: 'respond_to_user',
    intent: 'chat',
    taskMustBeNull: true,
    responseIncludes: 'I can help in three concrete ways',
  },
  {
    name: 'greeting typo answers directly',
    input: 'hy',
    action: 'respond_to_user',
    intent: 'chat',
    taskMustBeNull: true,
  },
  {
    name: 'casual greeting answers directly',
    input: 'hii bro',
    action: 'respond_to_user',
    intent: 'chat',
    taskMustBeNull: true,
  },
  {
    name: 'tool typo lists tools',
    input: 'what tool availble?',
    action: 'list_tools',
    intent: 'tool_management',
    taskMustBeNull: true,
  },
  {
    name: 'tool inventory lists tools',
    input: 'what tools do you have',
    action: 'list_tools',
    intent: 'tool_management',
    taskMustBeNull: true,
  },
  {
    name: 'tool delete routes to approval action',
    input: 'delete tool get_btc_price',
    action: 'delete_tool',
    intent: 'tool_management',
    taskMustBeNull: true,
  },
  {
    name: 'delete all tools routes to bulk approval action',
    input: 'delete all tools',
    action: 'delete_tool',
    intent: 'tool_management',
    taskMustBeNull: true,
  },
  {
    name: 'personal knowledge answers directly',
    input: 'what u know about me',
    action: 'respond_to_user',
    intent: 'chat',
    taskMustBeNull: true,
    responseIncludes: 'I only know what is available',
  },
  {
    name: 'personal memory answers directly',
    input: 'do you remember me?',
    action: 'respond_to_user',
    intent: 'chat',
    taskMustBeNull: true,
    responseIncludes: 'I only know what is available',
  },
  {
    name: 'status routes to built-in status',
    input: 'show config status',
    action: 'get_status',
    intent: 'status',
    taskMustBeNull: true,
  },
  {
    name: 'agent inventory routes to built-in agents',
    input: 'what agents are available',
    action: 'list_agents',
    intent: 'agent_management',
    taskMustBeNull: true,
  },
  {
    name: 'vague short question asks clarification',
    input: 'what now?',
    action: 'ask_clarifying_question',
    intent: 'clarification_needed',
    taskMustBeNull: true,
  },
  {
    name: 'concrete crypto task enters execution',
    input: 'find current btc price',
    action: 'use_or_create_tool',
    intent: 'task',
  },
  {
    name: 'json task enters execution',
    input: 'Return the number 2 as JSON',
    action: 'use_or_create_tool',
    intent: 'task',
  },
];

export async function runRoutingEvals(): Promise<RoutingEvalResult[]> {
  const context = {
    agentName: 'eval-agent',
    cwd: process.cwd(),
  };

  return Promise.all(CASES.map(async (testCase) => {
    const decision = await decideAction(testCase.input, context, { offline: true });
    const failures: string[] = [];

    if (decision.action !== testCase.action) failures.push(`action=${decision.action}`);
    if (testCase.intent && decision.intent !== testCase.intent) failures.push(`intent=${decision.intent}`);
    if (testCase.taskMustBeNull && decision.task) failures.push(`task=${decision.task}`);
    if (testCase.responseIncludes && !decision.userResponse?.includes(testCase.responseIncludes)) {
      failures.push('missing expected response text');
    }

    return {
      name: testCase.name,
      input: testCase.input,
      passed: failures.length === 0,
      expected: `${testCase.intent ?? '*'} / ${testCase.action}`,
      actual: failures.length === 0 ? `${decision.intent} / ${decision.action}` : failures.join(', '),
    };
  }));
}
