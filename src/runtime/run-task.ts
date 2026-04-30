import type { TaskRequest, TaskResult } from '@zero-agents/core';
import chalk from 'chalk';
import { createPanAgent } from './create-agent.js';
import { withQuietConsole, writeLine } from './quiet-console.js';
import { PAN_SYSTEM_PROMPT } from './system-prompt.js';
import { summarizeTraceOutput, writeTrace } from './trace.js';

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
  const assetIds: Record<string, string> = {
    btc: 'bitcoin',
    eth: 'ethereum',
    sol: 'solana',
    ltc: 'litecoin',
    doge: 'dogecoin',
    xrp: 'ripple',
  };
  const requestedOutput = /\bjson\b/i.test(task) ? 'json' : /\b(markdown|table|csv|text)\b/i.exec(task)?.[1]?.toLowerCase();

  return {
    description: task,
    context: `${PAN_SYSTEM_PROMPT}

Task execution notes:
- Complete the specific user task; do not create reusable tools for conversation, capabilities, or inventory requests.
- Treat params as optional. Prefer params.task/query as the source of truth, then use safe defaults from the task description.
- If returning an error object, it means the task failed and should be fixed or reported honestly.`,
    params: {
      query: task,
      task,
      normalizedTask: task.toLowerCase().replace(/\s+/g, ' ').trim(),
      terms,
      ...(requestedOutput ? { requestedOutput } : {}),
      ...(symbols.length > 0 ? {
        symbol: symbols[symbols.length - 1],
        symbols,
        assetIds: Object.fromEntries(symbols.filter((symbol) => assetIds[symbol]).map((symbol) => [symbol, assetIds[symbol]])),
      } : {}),
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
  const startedAt = Date.now();

  try {
    const result = await withQuietConsole(() => agent.run(createTaskRequest(task)));
    await writeTrace({
      type: 'task_result',
      agentName,
      input: task,
      task,
      toolUsed: result.toolUsed,
      strategy: result.strategy,
      success: result.reflection?.success,
      qualityScore: result.reflection?.qualityScore,
      durationMs: Date.now() - startedAt,
      outputSummary: summarizeTraceOutput(result.output),
    }).catch(() => undefined);

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
  } catch (error) {
    await writeTrace({
      type: 'task_error',
      agentName,
      input: task,
      task,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  } finally {
    agent.dispose();
  }
}
