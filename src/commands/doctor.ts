import chalk from 'chalk';
import { ToolSandbox } from '@zero-agents/core';
import { config as loadEnv } from 'dotenv';
import { loadConfig } from '../config/load-config.js';
import { detectEnsName } from '../identity/ens.js';
import { ensureAxlRunning } from '../runtime/axl-autostart.js';

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

async function checkAxl(port: number, autoStart: boolean): Promise<Check> {
  const startup = await ensureAxlRunning({ port, autoStart });
  if (startup.running) {
    return {
      name: 'Gensyn AXL',
      ok: true,
      detail: startup.detail,
    };
  }

  const urls = [`http://localhost:${port}/info`, `http://localhost:${port}/topology`];
  let lastDetail = startup.detail;

  for (const url of urls) {
    try {
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

      lastDetail = `no supported AXL endpoint on port ${port}`;
    } catch (error) {
      lastDetail = `not reachable on port ${port}`;
    }
  }

  return {
    name: 'Gensyn AXL',
    ok: false,
    detail: lastDetail,
  };
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

  const sandbox = new ToolSandbox({ allowUnsafeNodeVmFallback: false });
  const result = await sandbox.run('async function execute() { return { ok: true }; }', {}, 1000);

  if (result.success) {
    return {
      name: 'Tool sandbox',
      ok: true,
      detail: 'isolated-vm available',
    };
  }

  return {
    name: 'Tool sandbox',
    ok: false,
    detail: `${result.error ?? 'isolated-vm unavailable'}; use Node 22/24 with pnpm install, or install Visual Studio Build Tools and rebuild`,
  };
}

function checkNodeRuntime(): Check {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  const ok = major >= 22 && major < 25;

  return {
    name: 'Node.js runtime',
    ok,
    detail: ok ? process.version : `${process.version}; use Node 22 or 24 for isolated-vm prebuild support`,
  };
}

function printCheck(check: Check): void {
  const icon = check.ok ? chalk.green('PASS') : chalk.red('FAIL');
  console.log(`${icon} ${check.name}: ${check.detail}`);
}

export async function doctorCommand(): Promise<void> {
  loadEnv();

  let axlPort = 9002;
  let axlAutoStart = true;
  let rpcUrl = process.env.SEPOLIA_RPC_URL ?? 'https://sepolia.drpc.org';
  let allowUnsafeNodeVmFallback = false;
  let decisionProvider: 'openrouter' | 'zero-g' = 'openrouter';
  try {
    const config = await loadConfig();
    axlPort = config.axl.port;
    axlAutoStart = config.axl.autoStart;
    rpcUrl = process.env.SEPOLIA_RPC_URL ?? config.ens.rpcUrl;
    allowUnsafeNodeVmFallback = config.sandbox.allowUnsafeNodeVmFallback;
    decisionProvider = config.decision.provider;
    printCheck({ name: 'Pan config', ok: true, detail: '.pan-agents/config.json loaded' });
  } catch (error) {
    printCheck({ name: 'Pan config', ok: false, detail: 'run pan init' });
  }

  const checks: Check[] = [
    checkNodeRuntime(),
    envCheck('0G private key', process.env.ZERO_G_PRIVATE_KEY),
    decisionProvider === 'openrouter'
      ? envCheck('OpenRouter API key', process.env.OPENROUTER_API_KEY)
      : envCheck('Decision provider 0G key', process.env.ZERO_G_PRIVATE_KEY),
    envCheck('ENS private key', process.env.ENS_PRIVATE_KEY),
    envCheck('Sepolia RPC URL', process.env.SEPOLIA_RPC_URL),
    await checkEnsAutoDetect(rpcUrl),
    await checkSandbox(allowUnsafeNodeVmFallback),
    await checkAxl(axlPort, axlAutoStart),
  ];

  for (const check of checks) {
    printCheck(check);
  }
}
