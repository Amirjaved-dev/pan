import chalk from 'chalk';
import { createRequire } from 'node:module';
import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../config/load-config.js';
import { detectEnsName } from '../identity/ens.js';

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

async function checkEnsAutoDetect(rpcUrl: string): Promise<Check> {
  if (!process.env.ENS_PRIVATE_KEY) {
    return {
      name: 'ENS auto-detect',
      ok: false,
      detail: 'ENS_PRIVATE_KEY missing',
    };
  }

  try {
    const ensName = await detectEnsName(process.env.ENS_PRIVATE_KEY, rpcUrl);
    return {
      name: 'ENS auto-detect',
      ok: true,
      detail: ensName,
    };
  } catch (error) {
    return {
      name: 'ENS auto-detect',
      ok: false,
      detail: error instanceof Error ? error.message : 'failed',
    };
  }
}

async function checkSandbox(allowUnsafeNodeVmFallback: boolean): Promise<Check> {
  if (allowUnsafeNodeVmFallback) {
    return {
      name: 'Tool sandbox',
      ok: true,
      detail: 'unsafe Node vm fallback enabled for local development',
    };
  }

  try {
    createRequire(import.meta.url)('isolated-vm');
    return {
      name: 'Tool sandbox',
      ok: true,
      detail: 'isolated-vm available',
    };
  } catch (error) {
    return {
      name: 'Tool sandbox',
      ok: false,
      detail: 'isolated-vm unavailable; run pnpm approve-builds and rebuild, or set sandbox.allowUnsafeNodeVmFallback=true for dev',
    };
  }
}

function printCheck(check: Check): void {
  const icon = check.ok ? chalk.green('PASS') : chalk.red('FAIL');
  console.log(`${icon} ${check.name}: ${check.detail}`);
}

export async function doctorCommand(): Promise<void> {
  loadEnv();

  let axlPort = 9002;
  let rpcUrl = process.env.SEPOLIA_RPC_URL ?? 'https://sepolia.drpc.org';
  let allowUnsafeNodeVmFallback = false;
  try {
    const config = await loadConfig();
    axlPort = config.axl.port;
    rpcUrl = process.env.SEPOLIA_RPC_URL ?? config.ens.rpcUrl;
    allowUnsafeNodeVmFallback = config.sandbox.allowUnsafeNodeVmFallback;
    printCheck({ name: 'Pan config', ok: true, detail: '.pan-agents/config.json loaded' });
  } catch (error) {
    printCheck({ name: 'Pan config', ok: false, detail: 'run pan init' });
  }

  const checks: Check[] = [
    envCheck('0G private key', process.env.ZERO_G_PRIVATE_KEY),
    envCheck('ENS private key', process.env.ENS_PRIVATE_KEY),
    envCheck('Sepolia RPC URL', process.env.SEPOLIA_RPC_URL),
    await checkEnsAutoDetect(rpcUrl),
    await checkSandbox(allowUnsafeNodeVmFallback),
    await checkAxl(axlPort),
  ];

  for (const check of checks) {
    printCheck(check);
  }
}
