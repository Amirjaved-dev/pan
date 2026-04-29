export type ShellIntent =
  | { type: 'agent_task' }
  | { type: 'help' }
  | { type: 'status' }
  | { type: 'tools'; query?: string }
  | { type: 'agents' }
  | { type: 'network' }
  | { type: 'smalltalk' }
  | { type: 'clarify'; reason: string };

const TASK_VERBS = new Set([
  'find',
  'get',
  'fetch',
  'create',
  'build',
  'write',
  'generate',
  'calculate',
  'compare',
  'summarize',
  'analyze',
  'check',
  'monitor',
  'track',
  'search',
  'lookup',
]);

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasAny(input: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(input));
}

function firstWord(input: string): string {
  return input.split(' ')[0] ?? '';
}

function isToolWord(input: string): boolean {
  return /\b(tool|tools|toool|toools|available tool|availble tool|available tools|availble tools)\b/i.test(input);
}

function isListLike(input: string): boolean {
  return hasAny(input, ['list', 'show', 'what', 'which', 'available', 'availble', 'have', 'installed', 'existing']);
}

export function classifyShellIntent(input: string): ShellIntent {
  const text = normalize(input);
  if (!text) return { type: 'clarify', reason: 'empty input' };

  if (hasAny(text, ['hi', 'hello', 'hey']) && text.split(' ').length <= 3) {
    return { type: 'smalltalk' };
  }

  if (/\b(help|commands|usage|how to use|what can i do|what can you do|capabilities)\b/.test(text)) {
    return { type: 'help' };
  }

  if (/\b(status|health|config|configuration|doctor)\b/.test(text)) {
    return { type: 'status' };
  }

  if (isToolWord(text) && isListLike(text)) {
    return { type: 'tools' };
  }

  if (isToolWord(text) && hasAny(text, ['search', 'find'])) {
    const query = text.replace(/\b(search|find|tool|tools|toool|toools|for|about)\b/g, '').trim();
    return { type: 'tools', query: query || undefined };
  }

  if (/\b(agent|agents)\b/.test(text) && isListLike(text)) {
    return { type: 'agents' };
  }

  if (/\b(network|axl|peer|peers)\b/.test(text) && isListLike(text)) {
    return { type: 'network' };
  }

  if (TASK_VERBS.has(firstWord(text))) {
    return { type: 'agent_task' };
  }

  if (text.endsWith('price') || /\b(price|quote|rate|worth)\b/.test(text)) {
    return { type: 'agent_task' };
  }

  if (text.split(' ').length <= 3 && /\b(what|why|how|who|where)\b/.test(text)) {
    return { type: 'clarify', reason: 'question is too short to safely run as an agent task' };
  }

  return { type: 'agent_task' };
}
