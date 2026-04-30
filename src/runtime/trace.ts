import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getTracesDir } from '../config/paths.js';

export type TraceEvent = {
  type: 'decision' | 'task_result' | 'task_error';
  agentName?: string;
  input?: string;
  action?: string;
  intent?: string;
  confidence?: number;
  task?: string | null;
  toolUsed?: string;
  strategy?: string;
  success?: boolean;
  qualityScore?: number;
  durationMs?: number;
  outputSummary?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

function dateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 1000);
  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
  }
}

export async function writeTrace(event: TraceEvent, cwd = process.cwd()): Promise<void> {
  const tracesDir = getTracesDir(cwd);
  const now = new Date();
  const entry = {
    timestamp: now.toISOString(),
    ...event,
    ...(event.outputSummary ? { outputSummary: event.outputSummary.slice(0, 1000) } : {}),
  };

  await mkdir(tracesDir, { recursive: true });
  await appendFile(join(tracesDir, `${dateStamp(now)}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function summarizeTraceOutput(value: unknown): string {
  return summarize(value);
}
