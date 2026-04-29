import chalk from 'chalk';
import { writeDefaultConfig } from '../config/load-config.js';

export async function initCommand(): Promise<void> {
  const configPath = await writeDefaultConfig();
  console.log(chalk.green('[init] created Pan Agents config'));
  console.log(chalk.gray(configPath));
}
