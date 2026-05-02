import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPanDir } from '../config/paths.js';

type AxlStatus = {
  running: boolean;
  started: boolean;
  detail: string;
};

const STARTUP_TIMEOUT_MS = 5_000;

async function canReachAxl(port: number): Promise<boolean> {
  for (const path of ['/info', '/topology']) {
    try {
      const response = await fetch(`http://localhost:${port}${path}`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return true;
    } catch {
      // Try the next compatible endpoint.
    }
  }

  return false;
}

async function waitForAxl(port: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (await canReachAxl(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function findTsxCli(cwd: string): Promise<string> {
  const cli = join(cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  await access(cli);
  return cli;
}

async function writePidFile(port: number, pid: number): Promise<void> {
  const pidPath = join(getPanDir(), `axl-${port}.pid`);
  await mkdir(dirname(pidPath), { recursive: true });
  await writeFile(pidPath, `${pid}\n`, 'utf8');
}

async function getPreviousPid(port: number): Promise<number | null> {
  const raw = await readFile(join(getPanDir(), `axl-${port}.pid`), 'utf8').catch(() => null);
  if (!raw) return null;
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(pid) ? pid : null;
}

export async function ensureAxlRunning(options: { port: number; autoStart: boolean }): Promise<AxlStatus> {
  if (await canReachAxl(options.port)) {
    return { running: true, started: false, detail: `reachable on port ${options.port}` };
  }

  if (!options.autoStart) {
    return { running: false, started: false, detail: `not reachable on port ${options.port}` };
  }

  const previousPid = await getPreviousPid(options.port);
  const tsxCli = await findTsxCli(process.cwd()).catch(() => null);
  if (!tsxCli) {
    return { running: false, started: false, detail: 'auto-start failed: tsx CLI not found' };
  }

  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const nodePath = fileURLToPath(new URL(`./local-axl-node${extension}`, import.meta.url));
  const child = spawn(process.execPath, [tsxCli, nodePath, String(options.port)], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      AXL_PORT: String(options.port),
    },
  });
  child.unref();
  await writePidFile(options.port, child.pid ?? 0).catch(() => undefined);

  if (await waitForAxl(options.port)) {
    return { running: true, started: true, detail: `auto-started local AXL node on port ${options.port}` };
  }

  const pidDetail = previousPid ? `; previous pid was ${previousPid}` : '';
  return { running: false, started: true, detail: `auto-start attempted but port ${options.port} did not become reachable${pidDetail}` };
}
