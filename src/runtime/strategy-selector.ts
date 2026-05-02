import { StrategyAdapter, type ExperienceRecord, type StrategyAdapterInput, type StrategyDecision } from '@zero-agents/core';
import { getFailurePatterns, extractTaskSignature } from './adaptive-memory.js';

type PatchableStrategyAdapter = {
  selectStrategy(input: StrategyAdapterInput): StrategyDecision;
};

let isPatched = false;

function isHistoricalTask(task: string): boolean {
  return /\b(yesterday|historical|history|past|previous|ago)\b/i.test(task);
}

function supportsHistoricalPrices(experience: ExperienceRecord): boolean {
  const tool = experience.toolUsed ?? '';
  return /\b(yesterday|historical|history|daily|ohlc|candle|previous)\b/i.test(tool);
}

function computeFailureRisk(task: string, toolName?: string): number {
  const patterns = getFailurePatterns();
  if (patterns.length === 0) return 0;

  const taskSig = extractTaskSignature(task);
  let maxRisk = 0;

  for (const pattern of patterns) {
    const sigOverlap = signatureOverlap(taskSig, pattern.taskSignature);
    if (sigOverlap < 0.25) continue;

    if (toolName && pattern.toolName && pattern.toolName === toolName) {
      maxRisk = Math.max(maxRisk, sigOverlap * Math.min(pattern.attemptCount / 2, 1) * 0.8);
    } else if (!toolName || !pattern.toolName) {
      maxRisk = Math.max(maxRisk, sigOverlap * Math.min(pattern.attemptCount / 3, 1) * 0.4);
    }
  }

  return Math.min(maxRisk, 0.95);
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

export function initStrategySelector(): void {
  if (isPatched) {
    return;
  }

  const prototype = StrategyAdapter.prototype as unknown as PatchableStrategyAdapter;
  const originalSelectStrategy = prototype.selectStrategy;

  prototype.selectStrategy = function selectStrategy(input: StrategyAdapterInput): StrategyDecision {
    const similarExperiences = isHistoricalTask(input.task)
      ? (input.similarExperiences ?? []).filter((experience) => supportsHistoricalPrices(experience))
      : input.similarExperiences;

    const riskScoredExperiences = (similarExperiences ?? []).map((exp) => ({
      experience: exp,
      failureRisk: computeFailureRisk(input.task, exp.toolUsed),
      successRate: typeof exp.qualityScore === 'number' ? exp.qualityScore : (exp.success ? 0.8 : 0.2),
    }));

    const safeExperiences = riskScoredExperiences
      .filter((item) => item.failureRisk < 0.6)
      .sort((a, b) => {
        const aScore = a.successRate * (1 - a.failureRisk);
        const bScore = b.successRate * (1 - b.failureRisk);
        return bScore - aScore;
      })
      .map((item) => item.experience);

    const decision = originalSelectStrategy.call(this, {
      ...input,
      similarExperiences: safeExperiences,
    });

    if (decision.strategy === 'reuse_existing_tool' && decision.selectedToolName) {
      const reuseRisk = computeFailureRisk(input.task, decision.selectedToolName);
      if (reuseRisk > 0.6) {
        return {
          ...decision,
          strategy: 'generate_new_tool',
          selectedToolName: undefined,
          reason: `${decision.reason} Tool "${decision.selectedToolName}" has high failure risk (${Math.round(reuseRisk * 100)}%) on similar tasks. Creating new tool instead.`,
        };
      }
    }

    return decision;
  };

  isPatched = true;
}
