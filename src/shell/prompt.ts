import chalk from 'chalk';

export function buildPrompt(agentName: string): string {
  return `${chalk.cyan('pan')} ${chalk.gray('·')} ${chalk.green(agentName)} ${chalk.dim('> ')}`;
}

export function printWelcome(agentName: string, version: string): void {
  console.log();
  console.log(chalk.bold.cyan(`  Pan Agents v${version}`));
  console.log(chalk.gray('  Autonomous agent CLI powered by 0G · ENS · Gensyn AXL'));
  console.log();
  console.log(chalk.gray(`  Agent: ${chalk.green(agentName)}`));
  console.log(chalk.gray('  Type a task or /help for commands'));
  console.log();
}
