import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { runTask } from '../runtime/run-task.js';
import { loadConfig } from '../config/load-config.js';
import type { ShellContext } from './commands.js';
import { getShellCommand, isExitCommand } from './commands.js';
import { buildPrompt, printWelcome } from './prompt.js';

const MAX_HISTORY = 50;
const CONTINUATION_PROMPT = chalk.dim('... ');

export async function startRepl(): Promise<void> {
  const config = await loadConfig();
  let currentAgent = config.defaultAgent;
  const history: string[] = [];
  let historyIdx = -1;

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

  rl.on('SIGINT', () => {
    rl.write('', { ctrl: true });
    console.log(chalk.yellow('\n  ^C'));
    rl.prompt();
  });

  function pushHistory(line: string): void {
    if (line && line !== history[history.length - 1]) {
      history.push(line);
      if (history.length > MAX_HISTORY) history.shift();
    }
    historyIdx = -1;
  }

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

      const trimmed = input.trim();
      if (!trimmed) continue;

      pushHistory(trimmed);

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
