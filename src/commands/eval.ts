import { Command } from 'commander';
import chalk from 'chalk';
import { runRoutingEvals } from '../evals/routing.js';

export function createEvalCommand(): Command {
  return new Command('eval')
    .description('Run local Pan agent quality evals')
    .action(async () => {
      const results = await runRoutingEvals();
      const failed = results.filter((result) => !result.passed);

      console.log(chalk.bold('\n  Pan Agent Evals'));
      console.log();

      for (const result of results) {
        const marker = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(`  ${marker} ${result.name}`);
        if (!result.passed) {
          console.log(chalk.gray(`    input:    ${result.input}`));
          console.log(chalk.gray(`    expected: ${result.expected}`));
          console.log(chalk.gray(`    actual:   ${result.actual}`));
        }
      }

      console.log();
      console.log(`  ${results.length - failed.length}/${results.length} passed`);
      console.log();

      if (failed.length > 0) {
        process.exitCode = 1;
      }
    });
}
