#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('pan')
  .description('Claude Code-style CLI for autonomous agent workflows')
  .version('0.1.0');

program.command('doctor').description('Check required Pan Agents infrastructure').action(() => {
  console.log('pan doctor: infrastructure checks coming next');
});

program.command('init').description('Initialize Pan Agents configuration').action(() => {
  console.log('pan init: configuration setup coming next');
});

program
  .command('ask')
  .description('Run a single agent task')
  .argument('<task...>', 'task to run')
  .action((taskParts: string[]) => {
    console.log(`pan ask: ${taskParts.join(' ')}`);
  });

program.parse();
