import chalk from 'chalk';
import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../config/load-config.js';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

async function checkAxl(port: number): Promise<Check> {
  const urls = [`http://localhost:${port}/info`, `http://localhost:${port}/topology`];

  try {
    for (const url of urls) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return {
          name: 'Gensyn AXL',
          ok: true,
          detail: `reachable on port ${port}`,
        };
      }
    }

    return {
      name: 'Gensyn AXL',
      ok: false,
      detail: `no supported AXL endpoint on port ${port}`,
    };
  } catch (error) {
    return {
      name: 'Gensyn AXL',
      ok: false,
      detail: `not reachable on port ${port}`,
    };
  }
}

function envCheck(name: string, value: string | undefined): Check {
  return {
    name,
    ok: Boolean(value),
    detail: value ? 'configured' : 'missing',
  };
}

function printCheck(check: Check): void {
  const icon = check.ok ? chalk.green('PASS') : chalk.red('FAIL');
  console.log(`${icon} ${check.name}: ${check.detail}`);
}

export async function doctorCommand(): Promise<void> {
  loadEnv();

  let axlPort = 9002;
  try {
    const config = await loadConfig();
    axlPort = config.axl.port;
    printCheck({ name: 'Pan config', ok: true, detail: '.pan-agents/config.json loaded' });
  } catch (error) {
    printCheck({ name: 'Pan config', ok: false, detail: 'run pan init' });
  }

  const checks: Check[] = [
    envCheck('0G private key', process.env.ZERO_G_PRIVATE_KEY),
    envCheck('ENS private key', process.env.ENS_PRIVATE_KEY),
    envCheck('ENS name', process.env.ENS_NAME),
    envCheck('Sepolia RPC URL', process.env.SEPOLIA_RPC_URL),
    await checkAxl(axlPort),
  ];

  for (const check of checks) {
    printCheck(check);
  }
}
