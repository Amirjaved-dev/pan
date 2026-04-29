import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { runTask } from '../runtime/run-task.js';
import { loadConfig } from '../config/load-config.js';
import type { ShellContext } from './commands.js';
import { getShellCommand, isExitCommand } from './commands.js';
import { buildPrompt, printWelcome } from './prompt.js';

export async function startRepl(): Promise<void> {
  const config = await loadConfig();
  let currentAgent = config.defaultAgent;

  const ctx: ShellContext = {
    get agentName() {
      return currentAgent;
    },
    setAgent(name: string) {
      currentAgent = name;
    },
    exit: () => process.exit(0),
  };

  printWelcome(currentAgent, '0.1.0');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(currentAgent),
  });

  while (true) {
    try {
      rl.setPrompt(buildPrompt(currentAgent));
      const input = await rl.question('');

      const trimmed = input.trim();
      if (!trimmed) continue;

      if (isExitCommand(trimmed)) {
        console.log(chalk.gray('  Goodbye.'));
        rl.close();
        return;
      }

      const shellCmd = getShellCommand(trimmed);
      if (shellCmd) {
        await shellCmd.command(shellCmd.args, ctx);
        continue;
      }

      console.log();
      await runTask(trimmed, currentAgent);
      console.log();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('abort') || message.includes('SIGINT')) {
        console.log(chalk.yellow('\n  Task cancelled.'));
        continue;
      }
      console.error(chalk.red(`[error] ${message}`));
      console.log();
    }
  }
}
