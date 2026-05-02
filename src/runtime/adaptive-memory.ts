import { ExperienceMemory } from '@zero-agents/core';

type PatchableExperienceMemory = {
  scoreTaskSimilarity(normalizedTask: string, candidateTask: string): number;
};

let isPatched = false;

const FAILURE_MEMORY_FILE = 'failure-patterns.json';

type FailurePattern = {
  taskSignature: string;
  toolName?: string;
  failureCategory: string;
  failureDetail: string;
  timestamp: number;
  attemptCount: number;
};

let loadedFailures: FailurePattern[] | null = null;

function getFailurePatternsPath(): string {
  return process.env.FAILURE_PATTERNS_PATH ?? FAILURE_MEMORY_FILE;
}

function terms(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function signatureOverlap(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const term of setA) {
    if (setB.has(term)) intersection += 1;
  }
  return intersection / Math.min(setA.size, setB.size);
}

export function initAdaptiveMemory(): void {
  if (isPatched) {
    return;
  }

  const prototype = ExperienceMemory.prototype as unknown as PatchableExperienceMemory;
  const originalScoreTaskSimilarity = prototype.scoreTaskSimilarity;

  prototype.scoreTaskSimilarity = function scoreTaskSimilarity(normalizedTask: string, candidateTask: string): number {
    const querySig = extractTaskSignature(normalizedTask);
    const candidateSig = extractTaskSignature(candidateTask);

    const sigOverlap = signatureOverlap(querySig, candidateSig);
    if (sigOverlap < 0.1) return 0;

    const baseScore = originalScoreTaskSimilarity.call(this, normalizedTask, candidateTask);
    const blended = baseScore * 0.4 + sigOverlap * 0.6;

    const failures = getFailurePatterns();
    let failurePenalty = 0;
    for (const f of failures) {
      const failOverlap = signatureOverlap(querySig, f.taskSignature);
      if (failOverlap > 0.4) {
        failurePenalty = Math.max(failurePenalty, failOverlap * 0.5 * Math.min(f.attemptCount / 3, 1));
      }
    }

    const finalScore = Math.max(0, blended - failurePenalty);
    return finalScore >= 0.15 ? finalScore : 0;
  };

  isPatched = true;
}

export function extractTaskSignature(task: string): string {
  const t = terms(task);
  const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom']);
  return Array.from(t).filter((term) => !stopWords.has(term) && term.length > 1).sort().join(' ');
}

export function getFailurePatterns(): FailurePattern[] {
  if (loadedFailures !== null) return loadedFailures;
  try {
    const { readFileSync } = require('node:fs');
    const raw = readFileSync(getFailurePatternsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    loadedFailures = Array.isArray(parsed) ? parsed : [];
  } catch {
    loadedFailures = [];
  }
  return loadedFailures;
}

export function recordFailurePattern(pattern: Omit<FailurePattern, 'timestamp' | 'attemptCount'>): void {
  const failures = getFailurePatterns();
  const existing = failures.find((f) => f.taskSignature === pattern.taskSignature && f.failureCategory === pattern.failureCategory);
  if (existing) {
    existing.attemptCount += 1;
    existing.timestamp = Date.now();
    if (pattern.toolName && !existing.toolName) existing.toolName = pattern.toolName;
    if (pattern.failureDetail) existing.failureDetail = pattern.failureDetail;
  } else {
    failures.push({
      ...pattern,
      timestamp: Date.now(),
      attemptCount: 1,
    });
  }
  persistFailurePatterns(failures);
}

function persistFailurePatterns(failures: FailurePattern[]): void {
  try {
    const { writeFileSync, mkdirSync } = require('node:fs');
    const { dirname } = require('node:path');
    const path = getFailurePatternsPath();
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch { /* already exists */ }
    writeFileSync(path, JSON.stringify(failures.slice(-200), null, 2), 'utf8');
    loadedFailures = failures;
  } catch { /* best effort */ }
}
