#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createAgentCommand } from './commands/agent.js';
import { createAskCommand } from './commands/ask.js';
import { doctorCommand } from './commands/doctor.js';
import { createIdentityCommand } from './commands/identity.js';
import { initCommand } from './commands/init.js';
import { startRepl } from './shell/repl.js';

const program = new Command();

program
  .name('pan')
  .description('Claude Code-style CLI for autonomous agent workflows')
  .version('0.1.0');

program.command('doctor').description('Check required Pan Agents infrastructure').action(doctorCommand);

program.command('init').description('Initialize Pan Agents configuration').action(initCommand);

program.addCommand(createAgentCommand());
program.addCommand(createIdentityCommand());
program.addCommand(createAskCommand());

program.action(async () => {
  await startRepl();
});

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red('[error]'), message);
  process.exitCode = 1;
});
