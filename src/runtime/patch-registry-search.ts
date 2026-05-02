import { ToolRegistry } from '@zero-agents/core';

type ToolIndexEntryLike = {
  name?: unknown;
  description?: unknown;
  tags?: unknown;
};

type PatchableToolRegistry = {
  scoreEntryMatch(entry: ToolIndexEntryLike, normalizedQuery: string): number;
};

let isPatched = false;

const CRYPTO_TICKERS = new Set(['btc', 'bitcoin', 'eth', 'ethereum', 'sol', 'solana', 'ltc', 'doge', 'xrp']);

function searchableText(entry: ToolIndexEntryLike): string {
  const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  return [entry.name, entry.description, ...tags].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
}

export function patchRegistrySearchSemantics(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolRegistry.prototype as unknown as PatchableToolRegistry;
  const originalScoreEntryMatch = prototype.scoreEntryMatch;

  prototype.scoreEntryMatch = function scoreEntryMatch(entry: ToolIndexEntryLike, normalizedQuery: string): number {
    const originalScore = originalScoreEntryMatch.call(this, entry, normalizedQuery);
    if (originalScore > 0) {
      return originalScore;
    }

    const terms = normalizedQuery.match(/[a-z0-9]+/g) ?? [];
    const asksCryptoPrice = terms.some((term) => CRYPTO_TICKERS.has(term)) && terms.some((term) => term === 'price' || term === 'prices' || term === 'quote');
    const text = searchableText(entry);
    if (asksCryptoPrice && /\b(crypto|cryptocurrency|token)\b/.test(text) && /\b(price|prices|quote)\b/.test(text)) {
      return 0.9;
    }

    return 0;
  };

  isPatched = true;
}
