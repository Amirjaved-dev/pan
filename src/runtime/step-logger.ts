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

let pendingGeneratedToolLabel: string | null = null;
let pendingStrategy: string | null = null;

function getTaskDescription(event: AgentStepEvent): string {
  const task = event.data && typeof event.data === 'object' && 'task' in event.data ? event.data.task : null;
  if (typeof task === 'string') return task;
  if (task && typeof task === 'object' && 'description' in task && typeof task.description === 'string') return task.description;
  return '';
}

function describeReusableTool(task: string): string | null {
  if (/\b(price|prices|quote|quotes|market)\b/i.test(task) && /\b(btc|bitcoin|eth|ethereum|sol|solana|crypto|token)\b/i.test(task)) {
    return 'crypto price tool';
  }

  return null;
}

function formatStepMessage(event: AgentStepEvent): string {
  if (event.type === 'strategy' && event.message.startsWith('Strategy selected:')) {
    pendingStrategy = event.message.replace('Strategy selected:', '').trim();
    if (pendingStrategy === 'reuse_existing_tool') return 'Checking memory and reusable tools...';
    if (pendingStrategy === 'generate_new_tool') return 'No strong match in memory; preparing a new tool...';
    if (pendingStrategy === 'improve_existing_tool') return 'Existing tool needs improvement...';
    return event.message;
  }

  if (event.type === 'strategy' && event.message.startsWith('Reason:')) {
    const reason = event.message.replace('Reason:', '').trim();
    const label = pendingStrategy ? pendingStrategy.replace(/_/g, ' ') : 'strategy';
    pendingStrategy = null;
    return `${label}: ${reason}`;
  }

  if (event.type === 'miss') {
    pendingGeneratedToolLabel = describeReusableTool(getTaskDescription(event));
    if (pendingGeneratedToolLabel) {
      return `No reusable ${pendingGeneratedToolLabel} found. Generating ${pendingGeneratedToolLabel}...`;
    }
  }

  if (event.type === 'generating' && pendingGeneratedToolLabel) {
    const attempt = event.data && typeof event.data === 'object' && 'attempt' in event.data ? event.data.attempt : null;
    return `Generating ${pendingGeneratedToolLabel}${typeof attempt === 'number' ? ` attempt ${attempt}` : ''}...`;
  }

  if (event.type === 'saving' || event.type === 'executing' || event.type === 'done' || event.type === 'error') {
    pendingGeneratedToolLabel = null;
    pendingStrategy = null;
  }

  return event.message;
}

function shouldShowStep(event: AgentStepEvent): boolean {
  if (process.env.PAN_VERBOSE === '1') {
    return true;
  }

  if (event.type === 'error' && event.message.startsWith('AXL initialization failed')) {
    return false;
  }

  return event.type !== 'reflecting' && event.type !== 'done';
}

export function logAgentStep(event: AgentStepEvent): void {
  if (!shouldShowStep(event)) {
    return;
  }

  const color = stepColors[event.type];
  const label = stepLabels[event.type].padEnd(5, ' ');
  writeLine(`${color(`${label}`)} ${chalk.gray('│')} ${formatStepMessage(event)}`);

  if (process.env.PAN_DEBUG_TOOLS === '1' && event.type === 'sandboxing') {
    const tool = event.data && typeof event.data === 'object' && 'tool' in event.data ? event.data.tool : null;
    if (tool && typeof tool === 'object' && 'code' in tool && typeof tool.code === 'string') {
      writeLine(chalk.gray('[debug:tool-code]'));
      writeLine(tool.code);
    }
  }
}
