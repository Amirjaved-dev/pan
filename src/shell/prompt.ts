import chalk from 'chalk';

type WelcomeOptions = {
  agentName: string;
  version: string;
  cwd: string;
  decisionProvider: string;
  decisionModel?: string;
};

const brand = chalk.hex('#de7a55');
const muted = chalk.hex('#8a8a8a');
const faint = chalk.hex('#5f5f5f');

export function buildPrompt(agentName: string): string {
  return `${chalk.bold('›')} ${muted('Try')} ${faint('"ask an agent to solve a task"')} ${faint(`· ${agentName}`)} `;
}

export function printWelcome(options: WelcomeOptions): void {
  const modelLabel = options.decisionProvider === 'openrouter' && options.decisionModel
    ? options.decisionModel
    : options.decisionProvider;

  const title = `${chalk.bold.white('Pan Agents')} ${muted(`v${options.version}`)}`;
  const subtitle = `${muted(options.agentName)} ${faint('·')} ${muted(modelLabel)}`;
  const cwd = muted(options.cwd.replace(process.env.USERPROFILE ?? '', '~'));

  console.log();
  console.log(`${brand('  ██     ██')}     ${title}`);
  console.log(`${brand('  ███   ███')}     ${subtitle}`);
  console.log(`${brand('  ████ ████')}     ${cwd}`);
  console.log(`${brand('  ██ ███ ██')}`);
  console.log(`${brand('  ██  █  ██')}`);
  console.log();
  console.log(`  ${brand('/doctor')} ${muted('to verify keys and services')}`);
  console.log(`  ${brand('/model')}  ${muted('to switch decision model')}`);
  console.log();
  console.log(faint('-'.repeat(Math.min(process.stdout.columns || 96, 120))));
}
