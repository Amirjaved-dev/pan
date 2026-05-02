import { checkExecutionGate } from '../runtime/execution-gate.js';

type BuiltinEvalCase = {
  name: string;
  input: string;
  executionAllowed?: boolean;
};

export type BuiltinEvalResult = {
  name: string;
  input: string;
  passed: boolean;
  expected: string;
  actual: string;
};

const CASES: BuiltinEvalCase[] = [
  {
    name: 'top crypto prices can execute through agent tools',
    input: 'tell me top 10 crypto and their live prices',
    executionAllowed: true,
  },
  {
    name: 'mixed crypto and stock prices can execute through agent tools',
    input: 'find the price of btc, apple stock and nvidea',
    executionAllowed: true,
  },
  {
    name: 'capability request cannot execute tools',
    input: 'what abilities u have',
    executionAllowed: false,
  },
  {
    name: 'greeting cannot execute tools',
    input: 'hy',
    executionAllowed: false,
  },
];

export function runBuiltinEvals(): BuiltinEvalResult[] {
  return CASES.map((testCase) => {
    const failures: string[] = [];
    const gate = checkExecutionGate(testCase.input);

    if (testCase.executionAllowed !== undefined && gate.allowed !== testCase.executionAllowed) failures.push(`executionAllowed=${gate.allowed}`);

    return {
      name: testCase.name,
      input: testCase.input,
      passed: failures.length === 0,
      expected: `executionAllowed=${testCase.executionAllowed ?? '*'}`,
      actual: failures.length === 0 ? `executionAllowed=${gate.allowed}` : failures.join(', '),
    };
  });
}
