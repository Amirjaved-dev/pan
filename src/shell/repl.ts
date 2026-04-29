import { readFileSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { runTask } from '../runtime/run-task.js';
import { loadConfig } from '../config/load-config.js';
import type { ShellContext } from './commands.js';
import { getShellCommand, isExitCommand } from './commands.js';
import { buildPrompt, printWelcome } from './prompt.js';

const CONTINUATION_PROMPT = chalk.dim('... ');

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

  async function handleInput(input: string): Promise<boolean> {
    const trimmed = input.trim();
    if (!trimmed) return true;

    if (isExitCommand(trimmed)) {
      console.log(chalk.gray('  Goodbye.'));
      return false;
    }

    const shellCmd = getShellCommand(trimmed);
    if (shellCmd) {
      await shellCmd.command(shellCmd.args, ctx);
      return true;
    }

    console.log();
    await runTask(trimmed, currentAgent);
    console.log();
    return true;
  }

  if (!process.stdin.isTTY) {
    const input = readFileSync(0, 'utf8');
    for (const line of input.split(/\r?\n/)) {
      const shouldContinue = await handleInput(line);
      if (!shouldContinue) break;
    }
    return;
  }

  printWelcome(currentAgent, '0.1.0');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt(currentAgent),
  });

  rl.on('SIGINT', () => {
    rl.write('', { ctrl: true });
    console.log(chalk.yellow('\n  ^C'));
    rl.prompt();
  });

  while (true) {
    try {
      rl.setPrompt(buildPrompt(currentAgent));
      let input = await rl.question('');

      if (input.endsWith('\\')) {
        let continued = input.slice(0, -1);
        rl.setPrompt(CONTINUATION_PROMPT);
        while (true) {
          const next = await rl.question('');
          continued += '\n' + next;
          if (!next.endsWith('\\')) break;
          continued = continued.slice(0, -1);
          rl.setPrompt(CONTINUATION_PROMPT);
        }
        input = continued;
      }

      const shouldContinue = await handleInput(input);
      if (!shouldContinue) {
        rl.close();
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/readline was closed|input stream closed/i.test(message)) {
        rl.close();
        return;
      }
      if (message.includes('abort') || message.includes('SIGINT')) {
        console.log(chalk.yellow('\n  Task cancelled.'));
        continue;
      }
      console.error(chalk.red(`[error] ${message}`));
      console.log();
    }
  }
}
