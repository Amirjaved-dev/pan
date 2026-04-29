import type { TaskRequest, TaskResult } from '@zero-agents/core';
import chalk from 'chalk';
import { createPanAgent } from './create-agent.js';

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

export async function runTask(task: string, agentName?: string): Promise<TaskResult> {
  const agent = await createPanAgent(agentName);

  try {
    const result = await agent.run(createTaskRequest(task));

    console.log(chalk.green('[result]'));
    console.log(formatOutput(result.output));

    if (result.strategy) {
      console.log(chalk.gray(`[strategy] ${result.strategy}`));
    }

    if (result.toolUsed) {
      console.log(chalk.gray(`[tool] ${result.toolUsed}`));
    }

    if (result.experienceId) {
      console.log(chalk.gray(`[memory] ${result.experienceId}`));
    }

    return result;
  } finally {
    agent.dispose();
  }
}
