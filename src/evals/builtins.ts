import { isCryptoMarketTask } from '../runtime/crypto-market.js';
import { checkExecutionGate } from '../runtime/execution-gate.js';

type BuiltinEvalCase = {
  name: string;
  input: string;
  crypto?: boolean;
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
    name: 'top crypto prices use built-in crypto path',
    input: 'tell me top 10 crypto and their live prices',
    crypto: true,
    executionAllowed: true,
  },
  {
    name: 'single asset price uses built-in crypto path',
    input: 'btc price',
    crypto: true,
    executionAllowed: true,
  },
  {
    name: 'capability request cannot execute tools',
    input: 'what abilities u have',
    crypto: false,
    executionAllowed: false,
  },
  {
    name: 'greeting cannot execute tools',
    input: 'hy',
    crypto: false,
    executionAllowed: false,
  },
];

export function runBuiltinEvals(): BuiltinEvalResult[] {
  return CASES.map((testCase) => {
    const failures: string[] = [];
    const crypto = isCryptoMarketTask(testCase.input);
    const gate = checkExecutionGate(testCase.input);

    if (testCase.crypto !== undefined && crypto !== testCase.crypto) failures.push(`crypto=${crypto}`);
    if (testCase.executionAllowed !== undefined && gate.allowed !== testCase.executionAllowed) failures.push(`executionAllowed=${gate.allowed}`);

    return {
      name: testCase.name,
      input: testCase.input,
      passed: failures.length === 0,
      expected: `crypto=${testCase.crypto ?? '*'}, executionAllowed=${testCase.executionAllowed ?? '*'}`,
      actual: failures.length === 0 ? `crypto=${crypto}, executionAllowed=${gate.allowed}` : failures.join(', '),
    };
  });
}
