import type { TaskRequest, TaskResult } from '@zero-agents/core';
import chalk from 'chalk';
import { createPanAgent } from './create-agent.js';
import { withQuietConsole, writeLine } from './quiet-console.js';

function formatOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  return JSON.stringify(output, null, 2);
}

function createTaskRequest(task: string): TaskRequest {
  const terms = task.match(/\b[A-Za-z][A-Za-z0-9-]{1,12}\b/g) ?? [];
  const symbols = terms
    .filter((term) => term.length <= 6 && /[A-Za-z]/.test(term))
    .map((term) => term.toLowerCase());

  return {
    description: task,
    params: {
      query: task,
      task,
      terms,
      ...(symbols.length > 0 ? { symbol: symbols[symbols.length - 1], symbols } : {}),
    },
  };
}

function formatStrategy(result: TaskResult): string | null {
  if (!result.strategy) return null;

  const reason = result.strategyReason ?? '';
  const mentionedTool = reason.match(/tool "([^"]+)"/)?.[1];
  if (mentionedTool && result.toolUsed && mentionedTool !== result.toolUsed) {
    return result.strategy;
  }

  return reason ? `${result.strategy} - ${reason}` : result.strategy;
}

export async function runTask(task: string, agentName?: string): Promise<TaskResult> {
  const agent = await createPanAgent(agentName);

  try {
    const result = await withQuietConsole(() => agent.run(createTaskRequest(task)));

    writeLine(chalk.green('[result]'));
    writeLine(formatOutput(result.output));

    const strategy = formatStrategy(result);
    if (strategy) {
      writeLine(chalk.gray(`[strategy] ${strategy}`));
    }

    if (result.toolUsed) {
      writeLine(chalk.gray(`[tool] ${result.toolUsed}`));
    }

    if (result.experienceId) {
      writeLine(chalk.gray(`[memory] ${result.experienceId}`));
    }

    return result;
  } finally {
    agent.dispose();
  }
}
