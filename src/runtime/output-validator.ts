import type { TaskResult } from '@zero-agents/core';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type VerificationResult = {
  ok: boolean;
  reason?: string;
};

type DomainRange = {
  domain: string;
  minPrice: number;
  maxPrice: number;
  sampleCount: number;
  lastSeen: number;
};

const DOMAIN_RANGE_FILE = 'domain-ranges.json';
let loadedRanges: DomainRange[] | null = null;

function getDomainRangesPath(): string {
  return process.env.DOMAIN_RANGES_PATH ?? DOMAIN_RANGE_FILE;
}

function loadDomainRanges(): DomainRange[] {
  if (loadedRanges !== null) return loadedRanges;
  try {
    const path = getDomainRangesPath();
    if (!existsSync(path)) { loadedRanges = []; return loadedRanges; }
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    loadedRanges = Array.isArray(parsed) ? parsed : [];
  } catch {
    loadedRanges = [];
  }
  return loadedRanges;
}

function saveDomainRanges(ranges: DomainRange[]): void {
  try {
    const path = getDomainRangesPath();
    try { mkdirSync(dirname(path), { recursive: true }); } catch { /* exists */ }
    writeFileSync(path, JSON.stringify(ranges.slice(-50), null, 2), 'utf8');
    loadedRanges = ranges;
  } catch { /* best effort */ }
}

function detectDomain(task: string): string {
  const lower = task.toLowerCase();
  if (/\b(gold|xau|precious\s*metal)\b/i.test(lower)) return 'commodity-gold';
  if (/\b(silver|xag)\b/i.test(lower)) return 'commodity-silver';
  if (/\b(oil|crude|petroleum)\b/i.test(lower)) return 'commodity-oil';
  if (/\b(platinum|palladium|copper|natural\s*gas|corn|wheat|coffee|sugar|cocoa)\b/i.test(lower)) return 'commodity-other';
  if (/\b(btc|bitcoin)\b/i.test(lower)) return 'crypto-btc';
  if (/\b(eth|ethereum)\b/i.test(lower)) return 'crypto-eth';
  if (/\b(sol|solana)\b/i.test(lower)) return 'crypto-sol';
  if (/\b(crypto|cryptocurrency|token|coin|ltc|doge|xrp|ripple|litecoin|dogecoin)\b/i.test(lower)) return 'crypto-general';
  if (/\b(stock|stocks|share|shares|equity|nvidia|nvda|apple|aapl|tesla|tsla|microsoft|msft|google|googl|meta|amazon|amzn)\b/i.test(lower)) return 'stock-equity';
  if (/\b(forex|currency|eur|gbp|jpy|cny|exchange\s*rate)\b/i.test(lower)) return 'forex';
  if (/\b(price|market|quote|value|rate)\b/i.test(lower)) return 'general-market';
  return 'unknown';
}

function learnFromSuccess(domain: string, price: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  const ranges = loadDomainRanges();
  let entry = ranges.find((r) => r.domain === domain);
  if (!entry) {
    entry = { domain, minPrice: price, maxPrice: price, sampleCount: 0, lastSeen: Date.now() };
    ranges.push(entry);
  }
  entry.minPrice = Math.min(entry.minPrice, price);
  entry.maxPrice = Math.max(entry.maxPrice, price);
  entry.sampleCount += 1;
  entry.lastSeen = Date.now();
  saveDomainRanges(ranges);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasError(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasError(item));
  if (!isRecord(value)) return false;
  if (typeof value.error === 'string' && value.error.trim().length > 0) return true;
  return Object.values(value).some((item) => hasError(item));
}

function isEmptyResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!isRecord(value)) return false;

  const entries = Object.entries(value).filter(([key]) => !key.startsWith('_'));
  if (entries.length === 0) return true;

  return entries.some(([key, item]) => {
    if (/^(prices|results|items|data|quotes)$/i.test(key)) return isEmptyResult(item);
    return false;
  });
}

function hasNullLiveData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNullLiveData(item));
  if (!isRecord(value)) return value === null;

  return Object.entries(value).some(([key, item]) => {
    if (item === null && /price|quote|value|usd|amount|rate|market|btc|stock|asset|symbol|apple|nvidia/i.test(key)) {
      return true;
    }
    return hasNullLiveData(item);
  });
}

function isJsonRequested(task: string): boolean {
  return /\bjson\b/i.test(task);
}

function isLiveDataTask(task: string): boolean {
  return /\b(live|current|price|prices|prcie|quote|market|gold|xau|stock|stocks|share|shares|equity|crypto|cryptocurrency|btc|bitcoin|eth|ethereum|sol|solana)\b/i.test(task);
}

function findNumericValue(value: unknown, keyPattern: RegExp): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumericValue(item, keyPattern);
      if (found !== null) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, item] of Object.entries(value)) {
    if (keyPattern.test(key) && typeof item === 'number' && Number.isFinite(item)) return item;
    const nested = findNumericValue(item, keyPattern);
    if (nested !== null) return nested;
  }

  return null;
}

function findPlausibleMarketNumber(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPlausibleMarketNumber(item);
      if (found !== null) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, item] of Object.entries(value)) {
    if (/time|timestamp|date|volume|count/i.test(key)) continue;
    if (typeof item === 'number' && Number.isFinite(item) && item > 0 && item < 100000) return item;
    const nested = findPlausibleMarketNumber(item);
    if (nested !== null) return nested;
  }

  return null;
}

const FALLBACK_RANGES: Record<string, { min: number; max: number }> = {
  'commodity-gold': { min: 100, max: 20000 },
  'commodity-silver': { min: 5, max: 200 },
  'commodity-oil': { min: 10, max: 200 },
  'commodity-other': { min: 0.01, max: 50000 },
  'crypto-btc': { min: 1000, max: 500000 },
  'crypto-eth': { min: 100, max: 20000 },
  'crypto-sol': { min: 10, max: 1000 },
  'crypto-general': { min: 0.001, max: 100000 },
  'stock-equity': { min: 0.01, max: 100000 },
  'forex': { min: 0.1, max: 10000 },
  'general-market': { min: 0.001, max: 100000 },
  'unknown': { min: 0.001, max: 100000 },
};

function verifyMarketPlausibility(task: string, output: unknown): VerificationResult {
  if (!isLiveDataTask(task)) return { ok: true };

  const domain = detectDomain(task);
  const price = findNumericValue(output, /price|usd|gold|value|amount|rate/) ?? findPlausibleMarketNumber(output);

  if (price === null) {
    return { ok: false, reason: `${domain} task returned no numeric price/value` };
  }

  const learned = loadDomainRanges().find((r) => r.domain === domain);
  let range: { min: number; max: number };
  if (learned && learned.sampleCount >= 3) {
    const margin = (learned.maxPrice - learned.minPrice) * 0.5;
    range = { min: Math.max(0, learned.minPrice - margin), max: learned.maxPrice + margin };
  } else {
    range = FALLBACK_RANGES[domain] ?? FALLBACK_RANGES['unknown'];
  }

  if (price < range.min || price > range.max) {
    return { ok: false, reason: `${domain} price looks implausible: ${price} (expected ${range.min}-${range.max})` };
  }

  learnFromSuccess(domain, price);

  return { ok: true };
}

export function verifyTaskResult(task: string, result: TaskResult): VerificationResult {
  if (hasError(result.output)) {
    return { ok: false, reason: `tool returned error: ${String((result.output as { error: string }).error)}` };
  }

  if (isJsonRequested(task)) {
    if (typeof result.output === 'string') {
      try {
        JSON.parse(result.output);
      } catch {
        return { ok: false, reason: 'user requested JSON but tool returned a non-JSON string' };
      }
    }
  }

  if (isLiveDataTask(task) && hasError(result.output)) {
    return { ok: false, reason: 'live data task returned an error object' };
  }

  if (isLiveDataTask(task) && isEmptyResult(result.output)) {
    return { ok: false, reason: 'live data task returned no usable results' };
  }

  if (isLiveDataTask(task) && hasNullLiveData(result.output)) {
    return { ok: false, reason: 'live data task returned null prices or missing quote values' };
  }

  if (isLiveDataTask(task)) {
    const plausibility = verifyMarketPlausibility(task, result.output);
    if (!plausibility.ok) return plausibility;
  }

  return { ok: true };
}
