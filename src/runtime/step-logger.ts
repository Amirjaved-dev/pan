import type { AgentStepEvent } from '@zero-agents/core';
import chalk from 'chalk';
import { writeLine } from './quiet-console.js';

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

const stepLabels: Record<AgentStepEvent['type'], string> = {
  search: 'search',
  miss: 'build',
  strategy: 'plan',
  generating: 'build',
  sandboxing: 'check',
  evaluating: 'check',
  saving: 'save',
  executing: 'run',
  reflecting: 'learn',
  done: 'done',
  error: 'error',
};

function shouldShowStep(event: AgentStepEvent): boolean {
  if (process.env.PAN_VERBOSE === '1') {
    return true;
  }

  if (event.type === 'error' && event.message.startsWith('AXL initialization failed')) {
    return false;
  }

  return event.type !== 'reflecting' && !(event.type === 'strategy' && event.message.startsWith('Reason:'));
}

export function logAgentStep(event: AgentStepEvent): void {
  if (!shouldShowStep(event)) {
    return;
  }

  const color = stepColors[event.type];
  writeLine(`${color(`[${stepLabels[event.type]}]`)} ${event.message}`);

  if (process.env.PAN_DEBUG_TOOLS === '1' && event.type === 'sandboxing') {
    const tool = event.data && typeof event.data === 'object' && 'tool' in event.data ? event.data.tool : null;
    if (tool && typeof tool === 'object' && 'code' in tool && typeof tool.code === 'string') {
      writeLine(chalk.gray('[debug:tool-code]'));
      writeLine(tool.code);
    }
  }
}
