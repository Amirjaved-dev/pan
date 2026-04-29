type ConsoleMethod = 'log' | 'info' | 'debug' | 'warn' | 'error';

const methods: ConsoleMethod[] = ['log', 'info', 'debug', 'warn', 'error'];

export async function withQuietConsole<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.PAN_VERBOSE === '1') {
    return fn();
  }

  const original = new Map<ConsoleMethod, typeof console.log>();
  for (const method of methods) {
    original.set(method, console[method]);
    console[method] = (() => undefined) as typeof console.log;
  }

  try {
    return await fn();
  } finally {
    for (const method of methods) {
      const originalMethod = original.get(method);
      if (originalMethod) {
        console[method] = originalMethod;
      }
    }
  }
}

export function writeLine(value = ''): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\r\x1b[2K');
  }
  process.stdout.write(`${value}\n`);
}
