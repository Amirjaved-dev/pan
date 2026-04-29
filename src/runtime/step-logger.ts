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

  if (process.env.PAN_DEBUG_TOOLS === '1' && event.type === 'sandboxing') {
    const tool = event.data && typeof event.data === 'object' && 'tool' in event.data ? event.data.tool : null;
    if (tool && typeof tool === 'object' && 'code' in tool && typeof tool.code === 'string') {
      console.log(chalk.gray('[debug:tool-code]'));
      console.log(tool.code);
    }
  }
}
