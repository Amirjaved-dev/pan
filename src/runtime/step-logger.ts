import type { AgentStepEvent } from '@zero-agents/core';
import chalk from 'chalk';

const stepColors: Record<AgentStepEvent['type'], (value: string) => string> = {
  search: chalk.cyan,
  miss: chalk.yellow,
  strategy: chalk.magenta,
  generating: chalk.blue,
  sandboxing: chalk.blue,
  evaluating: chalk.blue,
  saving: chalk.green,
  executing: chalk.cyan,
  reflecting: chalk.gray,
  done: chalk.green,
  error: chalk.red,
};

export function logAgentStep(event: AgentStepEvent): void {
  const color = stepColors[event.type];
  console.log(`${color(`[${event.type}]`)} ${event.message}`);
}
