import { readFileSync } from 'node:fs';
import * as readlineCore from 'node:readline';
import chalk from 'chalk';
import { decideAction } from '../brain/decide-action.js';
import { loadConfig } from '../config/load-config.js';
import { ensureAxlRunning } from '../runtime/axl-autostart.js';
import type { ShellContext } from './commands.js';
import { getShellCommand, getSlashCommandItems, getSlashCommandRows, isExitCommand } from './commands.js';
import { executeDecision } from './execute-decision.js';
import { buildPrompt, printWelcome } from './prompt.js';

const CONTINUATION_PROMPT = chalk.dim('... ');

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function visibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, '').length;
}

function wrappedRowCount(length: number, columns: number): number {
  return Math.floor(Math.max(0, length) / columns) + 1;
}

function isSlashMenuInput(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('/') && !/\s/.test(trimmed);
}

async function readInteractiveLine(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let line = '';
    let selectedIndex = 0;
    let dropdownQuery = '/';
    let lastCursorRow = 0;
    let renderQueued = false;
    const wasRaw = process.stdin.isRaw;

    function getMenuItems() {
      return isSlashMenuInput(line) ? getSlashCommandItems(dropdownQuery) : [];
    }

    function render(): void {
      if (lastCursorRow > 0) readlineCore.moveCursor(process.stdout, 0, -lastCursorRow);
      readlineCore.cursorTo(process.stdout, 0);
      readlineCore.clearScreenDown(process.stdout);
      process.stdout.write(`${prompt}${line}`);

      const columns = Math.max(1, process.stdout.columns || 96);
      const inputLength = visibleLength(prompt) + line.length;
      const inputRows = wrappedRowCount(inputLength, columns);
      const cursorRow = Math.floor(inputLength / columns);
      const cursorColumn = inputLength % columns;
      const items = getMenuItems();
      if (items.length === 0) {
        lastCursorRow = cursorRow;
        readlineCore.cursorTo(process.stdout, cursorColumn);
        return;
      }

      selectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
      const width = Math.max(40, Math.min(columns - 1, 119));
      const rows = getSlashCommandRows(dropdownQuery, selectedIndex, width);
      const divider = chalk.gray('─'.repeat(width));

      process.stdout.write('\n');
      process.stdout.write(divider);
      process.stdout.write('\n');
      process.stdout.write(rows.join('\n'));
      process.stdout.write('\n');
      process.stdout.write(chalk.gray('  ↑/↓ select · Tab complete · Enter run'));
      readlineCore.moveCursor(process.stdout, 0, -(inputRows + rows.length + 1 - cursorRow));
      readlineCore.cursorTo(process.stdout, cursorColumn);
      lastCursorRow = cursorRow;
    }

    function requestRender(): void {
      if (renderQueued) return;
      renderQueued = true;
      queueMicrotask(() => {
        renderQueued = false;
        render();
      });
    }

    function cleanup(): void {
      process.stdin.off('keypress', onKeypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false);
    }

    function onKeypress(char: string | undefined, key: readlineCore.Key): void {
      const items = getMenuItems();

      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('SIGINT'));
        return;
      }

      if (key.ctrl && key.name === 'd' && line.length === 0) {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('EOF'));
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        if (lastCursorRow > 0) readlineCore.moveCursor(process.stdout, 0, -lastCursorRow);
        readlineCore.cursorTo(process.stdout, 0);
        readlineCore.clearScreenDown(process.stdout);
        process.stdout.write(`${prompt}${line}\n`);
        resolve(line);
        return;
      }

      if (items.length > 0 && key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % items.length;
        line = items[selectedIndex]?.command ?? line;
        requestRender();
        return;
      }

      if (items.length > 0 && key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        line = items[selectedIndex]?.command ?? line;
        requestRender();
        return;
      }

      if (items.length > 0 && key.name === 'tab') {
        line = items[selectedIndex]?.command ?? line;
        requestRender();
        return;
      }

      if (key.name === 'backspace') {
        line = line.slice(0, -1);
        dropdownQuery = isSlashMenuInput(line) ? line.trimStart() : '/';
        selectedIndex = 0;
        requestRender();
        return;
      }

      if (key.name === 'escape') {
        dropdownQuery = '/';
        selectedIndex = 0;
        requestRender();
        return;
      }

      if (char && !key.ctrl && !key.meta) {
        line += char;
        dropdownQuery = isSlashMenuInput(line) ? line.trimStart() : '/';
        selectedIndex = 0;
        requestRender();
      }
    }

    readlineCore.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', onKeypress);
    process.stdin.resume();
    render();
  });
}

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

  while (true) {
    try {
      let input = await readInteractiveLine(buildPrompt(currentAgent));

      if (input.endsWith('\\')) {
        let continued = input.slice(0, -1);
        while (true) {
          const next = await readInteractiveLine(CONTINUATION_PROMPT);
          continued += '\n' + next;
          if (!next.endsWith('\\')) break;
          continued = continued.slice(0, -1);
        }
        input = continued;
      }

      const shouldContinue = await handleInput(input);
      if (!shouldContinue) {
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('abort') || message.includes('SIGINT')) {
        console.log(chalk.yellow('\n  Task cancelled.'));
        continue;
      }
      if (message.includes('EOF')) {
        console.log(chalk.gray('  Goodbye.'));
        return;
      }
      console.error(chalk.red(`[error] ${message}`));
      console.log();
    }
  }
}
