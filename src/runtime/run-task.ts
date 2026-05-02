import type { TaskRequest, TaskResult } from '@zero-agents/core';
import chalk from 'chalk';
import { cmdToolsDelete } from '../commands/tools.js';
import { createPanAgent } from './create-agent.js';
import { withQuietConsole, writeLine } from './quiet-console.js';
import { PAN_SYSTEM_PROMPT } from './system-prompt.js';
import { summarizeTraceOutput, writeTrace } from './trace.js';
import { verifyTaskResult } from './output-validator.js';
import { analyzeFailure } from './root-cause-analysis.js';
import { setFailureContextForGeneration } from './tool-generator.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: value >= 100 ? 2 : 6 })}`;
}

function formatPriceRows(output: unknown): string | null {
  if (!isRecord(output)) return null;

  const rows: Array<{ label: string; price: number }> = [];
  const prices = output.prices;

  if (Array.isArray(prices)) {
    for (const item of prices) {
      if (!isRecord(item)) continue;
      const label = typeof item.ticker === 'string' ? item.ticker : typeof item.symbol === 'string' ? item.symbol : null;
      const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null;
      if (label && price !== null) rows.push({ label, price });
    }
  }

  if (isRecord(prices)) {
    for (const [label, price] of Object.entries(prices)) {
      if (typeof price === 'number' && Number.isFinite(price)) rows.push({ label, price });
    }
  }

  if (typeof output.symbol === 'string' && typeof output.price === 'number' && Number.isFinite(output.price)) {
    rows.push({ label: output.symbol, price: output.price });
  }

  if (rows.length === 0) return null;

  const width = Math.max(...rows.map((row) => row.label.length), 6);
  const lines = rows.map((row) => `  ${chalk.cyan(row.label.padEnd(width, ' '))}  ${chalk.white(formatUsd(row.price))}`);
  if (typeof output.note === 'string' && output.note.trim()) {
    lines.push(chalk.gray(`  note   ${output.note.trim()}`));
  }

  return lines.join('\n');
}

function formatOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  const priceRows = formatPriceRows(output);
  if (priceRows) return priceRows;

  return JSON.stringify(output, null, 2);
}

function createTaskRequest(task: string): TaskRequest {
  const normalizedTask = task.toLowerCase().replace(/\s+/g, ' ').trim();
  const terms = task.match(/\b[A-Za-z][A-Za-z0-9-]{1,12}\b/g) ?? [];
  const stopWords = new Set(['a', 'an', 'and', 'ask', 'find', 'for', 'get', 'give', 'i', 'is', 'know', 'me', 'of', 'price', 'prices', 'prcie|quote', 'market', 'show', 'the', 'to', 'want', 'what']);
  const stockSymbols: Record<string, string> = {
    nvidia: 'NVDA',
    nvda: 'NVDA',
    apple: 'AAPL',
    aapl: 'AAPL',
    tesla: 'TSLA',
    tsla: 'TSLA',
    microsoft: 'MSFT',
    msft: 'MSFT',
    google: 'GOOGL',
    googl: 'GOOGL',
    alphabet: 'GOOGL',
    meta: 'META',
    amazon: 'AMZN',
    amzn: 'AMZN',
  };
  const symbols = terms
    .map((term) => term.toLowerCase())
    .filter((term) => term.length <= 6 && /[A-Za-z]/.test(term) && !stopWords.has(term))
    .filter((term, index, all) => all.indexOf(term) === index);
  const assetIds: Record<string, string> = {
    btc: 'bitcoin',
    eth: 'ethereum',
    sol: 'solana',
    ltc: 'litecoin',
    doge: 'dogecoin',
    xrp: 'ripple',
  };
  const mappedAssetIds = Object.fromEntries(symbols.filter((symbol) => assetIds[symbol]).map((symbol) => [symbol, assetIds[symbol]]));
  const stockSymbol = symbols.map((symbol) => stockSymbols[symbol]).find(Boolean);
  const primarySymbol = stockSymbol ?? symbols.find((symbol) => assetIds[symbol]) ?? symbols[symbols.length - 1];
  const primaryAssetId = primarySymbol ? assetIds[primarySymbol] : undefined;
  const requestedOutput = /\bjson\b/i.test(task) ? 'json' : /\b(markdown|table|csv|text)\b/i.exec(task)?.[1]?.toLowerCase();
  const market = stockSymbol ? 'stock' : Object.keys(mappedAssetIds).length > 0 ? 'crypto' : undefined;
  const timeframe = /\byesterday\b/i.test(task) ? 'yesterday' : /\b(historical|history|past|previous)\b/i.test(task) ? 'historical' : undefined;

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
      normalizedTask,
      terms,
      ...(requestedOutput ? { requestedOutput } : {}),
      ...(market ? { market } : {}),
      ...(timeframe ? { timeframe } : {}),
      ...(symbols.length > 0 ? {
        symbol: primarySymbol,
        symbols: stockSymbol ? [stockSymbol] : symbols,
        ...(Object.keys(mappedAssetIds).length > 0 ? { assetIds: mappedAssetIds } : {}),
        ...(primaryAssetId ? { assetId: primaryAssetId, coinGeckoId: primaryAssetId } : {}),
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
    writeLine(`${chalk.cyan('agent')} ${chalk.gray('│')} ${task}`);
    const result = await withQuietConsole(() => agent.run(createTaskRequest(task)));
    const verification = verifyTaskResult(task, result);

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
      metadata: { verification },
    }).catch(() => undefined);

    writeLine(`${chalk.green('result')} ${chalk.gray('│')}`);
    writeLine(formatOutput(result.output));

    if (!verification.ok) {
      const failureAnalysis = analyzeFailure(
        task,
        result.output,
        verification.reason
      );

      writeLine(`${chalk.red('diagnose')} ${chalk.gray('│')} [${failureAnalysis.category}] ${failureAnalysis.detail}`);
      writeLine(`${chalk.yellow('guidance')} ${chalk.gray('│')} ${failureAnalysis.suggestedFix}`);

      setFailureContextForGeneration(failureAnalysis.suggestedFix);

      if (result.wasGenerated && result.toolUsed) {
        writeLine(`${chalk.yellow('clean')} ${chalk.gray('│')} Removing failed generated tool ${result.toolUsed}.`);
        await cmdToolsDelete(result.toolUsed, { agent: agentName }).catch(() => undefined);
      }
      throw new Error(`Result verification failed: ${verification.reason ?? 'result failed verification'} [${failureAnalysis.category}]`);
    }

    writeLine(`${chalk.green('done')} ${chalk.gray('│')} Task verified.`);

    const strategy = formatStrategy(result);
    if (strategy) {
      writeLine(`${chalk.gray('plan')} ${chalk.gray('│')} ${chalk.gray(strategy)}`);
    }

    if (result.toolUsed) {
      writeLine(`${chalk.gray('tool')} ${chalk.gray('│')} ${chalk.gray(result.toolUsed)}`);
    }

    if (result.experienceId) {
      writeLine(`${chalk.gray('memory')} ${chalk.gray('│')} ${chalk.gray(result.experienceId)}`);
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
