import { readFileSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { decideAction } from '../brain/decide-action.js';
import { loadConfig } from '../config/load-config.js';
import { ensureAxlRunning } from '../runtime/axl-autostart.js';
import type { ShellContext } from './commands.js';
import { getShellCommand, isExitCommand } from './commands.js';
import { executeDecision } from './execute-decision.js';
import { buildPrompt, printWelcome } from './prompt.js';

const CONTINUATION_PROMPT = chalk.dim('... ');

export async function startRepl(): Promise<void> {
  const config = await loadConfig();
  if (config.axl.enabled) {
    await ensureAxlRunning({ port: config.axl.port, autoStart: config.axl.autoStart });
  }
  let currentAgent = config.defaultAgent;
  const recentMessages: string[] = [];

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

    const decision = await decideAction(trimmed, {
      agentName: currentAgent,
      cwd: process.cwd(),
      recentMessages: recentMessages.slice(-6),
    });
    await executeDecision(trimmed, decision, ctx);
    recentMessages.push(`user: ${trimmed}`);
    recentMessages.push(`decision: ${decision.intent}/${decision.action}`);
    if (recentMessages.length > 12) recentMessages.splice(0, recentMessages.length - 12);
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

  printWelcome({
    agentName: currentAgent,
    version: '0.1.0',
    cwd: process.cwd(),
    decisionProvider: config.decision.provider,
    decisionModel: config.decision.openRouterModel,
  });

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
      let input = await rl.question(buildPrompt(currentAgent));

      if (input.endsWith('\\')) {
        let continued = input.slice(0, -1);
        while (true) {
          const next = await rl.question(CONTINUATION_PROMPT);
          continued += '\n' + next;
          if (!next.endsWith('\\')) break;
          continued = continued.slice(0, -1);
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
