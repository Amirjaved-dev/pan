import { Command } from 'commander';
import { decideAction } from '../brain/decide-action.js';
import { loadConfig } from '../config/load-config.js';
import { executeDecision } from '../shell/execute-decision.js';
import type { ShellContext } from '../shell/commands.js';

export function createAskCommand(): Command {
  return new Command('ask')
    .description('Run a single agent task')
    .argument('<task...>', 'task to run')
    .option('--agent <name>', 'agent to run the task with')
    .action(async (taskParts: string[], options: { agent?: string }) => {
      const config = await loadConfig();
      let currentAgent = options.agent ?? config.defaultAgent;
      const ctx: ShellContext = {
        get agentName() {
          return currentAgent;
        },
        setAgent(name: string) {
          currentAgent = name;
        },
        exit: () => process.exit(0),
      };
      const input = taskParts.join(' ');
      const decision = await decideAction(input, {
        agentName: currentAgent,
        cwd: process.cwd(),
      });
      await executeDecision(input, decision, ctx);
    });
}
