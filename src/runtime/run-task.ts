import type { TaskResult } from '@zero-agents/core';
import chalk from 'chalk';
import { createPanAgent } from './create-agent.js';

function formatOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  return JSON.stringify(output, null, 2);
}

export async function runTask(task: string, agentName?: string): Promise<TaskResult> {
  const agent = await createPanAgent(agentName);

  try {
    const result = await agent.run(task);

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
