#!/usr/bin/env node

import { Command } from 'commander';
import { createAgentCommand } from './commands/agent.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('pan')
  .description('Claude Code-style CLI for autonomous agent workflows')
  .version('0.1.0');

program.command('doctor').description('Check required Pan Agents infrastructure').action(doctorCommand);

program.command('init').description('Initialize Pan Agents configuration').action(initCommand);

program.addCommand(createAgentCommand());

program
  .command('ask')
  .description('Run a single agent task')
  .argument('<task...>', 'task to run')
  .action((taskParts: string[]) => {
    console.log(`pan ask: ${taskParts.join(' ')}`);
  });

program.parse();
