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

function searchableText(entry: ToolIndexEntryLike): string {
  const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  return [entry.name, entry.description, ...tags].filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
}

function extractTerms(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const term of a) {
    if (b.has(term)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

function containsMatch(needle: string, haystack: string): number {
  if (!needle || !haystack) return 0;
  return haystack.includes(needle) ? 1 : 0;
}

function partialTokenMatch(queryTerm: string, toolText: string): number {
  if (!queryTerm || !toolText.length) return 0;
  if (toolText.includes(queryTerm)) return 1.0;
  const tokens = toolText.split(/\s+/);
  for (const token of tokens) {
    if (token.startsWith(queryTerm) && queryTerm.length >= 3) return 0.6;
    if (queryTerm.startsWith(token) && token.length >= 3) return 0.5;
    if (queryTerm.length >= 4 && token.includes(queryTerm)) return 0.4;
  }
  return 0;
}

export function initToolDiscovery(): void {
  if (isPatched) {
    return;
  }

  const prototype = ToolRegistry.prototype as unknown as PatchableToolRegistry;
  const originalScoreEntryMatch = prototype.scoreEntryMatch;

  prototype.scoreEntryMatch = function scoreEntryMatch(entry: ToolIndexEntryLike, normalizedQuery: string): number {
    const queryTerms = extractTerms(normalizedQuery);
    const text = searchableText(entry);
    const toolTerms = extractTerms(text);
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string').map((t) => t.toLowerCase()) : [];

    if (queryTerms.size === 0 || toolTerms.size === 0) {
      return originalScoreEntryMatch.call(this, entry, normalizedQuery);
    }

    let score = 0;
    let termMatches = 0;
    const totalWeight = queryTerms.size;

    for (const queryTerm of queryTerms) {
      const matchScore = partialTokenMatch(queryTerm, text);
      if (matchScore > 0) {
        score += matchScore;
        termMatches += 1;
      }
    }

    if (termMatches === 0) {
      const baseScore = originalScoreEntryMatch.call(this, entry, normalizedQuery);
      if (baseScore > 0) return baseScore * 0.3;
      return 0;
    }

    const coverageRatio = termMatches / totalWeight;
    const avgScore = score / totalWeight;
    const jaccard = jaccardSimilarity(queryTerms, toolTerms);

    let tagBoost = 0;
    for (const queryTerm of queryTerms) {
      if (tags.some((tag) => tag === queryTerm || tag.includes(queryTerm) || queryTerm.includes(tag))) {
        tagBoost += 0.15;
      }
    }

    const nameBoost = entry.name && typeof entry.name === 'string' && normalizedQuery.includes(entry.name.toLowerCase()) ? 0.2 : 0;

    const combined = Math.min(avgScore * 0.5 + jaccard * 0.3 + coverageRatio * 0.15 + tagBoost + nameBoost, 1);

    if (combined < 0.08) return 0;
    return Math.max(combined, originalScoreEntryMatch.call(this, entry, normalizedQuery));
  };

  isPatched = true;
}
