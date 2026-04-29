import { Command } from 'commander';
import { runTask } from '../runtime/run-task.js';

export function createAskCommand(): Command {
  return new Command('ask')
    .description('Run a single agent task')
    .argument('<task...>', 'task to run')
    .option('--agent <name>', 'agent to run the task with')
    .action(async (taskParts: string[], options: { agent?: string }) => {
      await runTask(taskParts.join(' '), options.agent);
    });
}
