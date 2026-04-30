export type ExecutionGateResult =
  | { allowed: true }
  | { allowed: false; response: string };

const CAPABILITY_RESPONSE = [
  'I can help in three concrete ways:',
  '1. Answer direct questions without creating useless tools.',
  '2. Run repeatable tasks with generated/reused tools, like fetching prices, calling public APIs, formatting data, or doing calculations.',
  '3. Manage this CLI workspace: agents, tools, status, ENS identity, and AXL/network checks.',
].join('\n');

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordCount(input: string): number {
  return normalize(input).split(' ').filter(Boolean).length;
}

export function checkExecutionGate(input: string): ExecutionGateResult {
  const text = normalize(input);

  if (!text) {
    return { allowed: false, response: 'What do you want me to do?' };
  }

  if (/\b(hi|hii|hy|hello|helo|hey|yo|sup|thanks|thank you|thx)\b/.test(text) && wordCount(text) <= 4) {
    return { allowed: false, response: 'I am here. Give me a task, ask a question, or ask what I can do.' };
  }

  if (/\b(who are you|who are u|what are you|what are u|your name|ur name|what can you do|what can u do|what u can do|what abilities|abilities u have|abilities you have|capabilities|features|how can you help|how can u help)\b/.test(text)) {
    return { allowed: false, response: CAPABILITY_RESPONSE };
  }

  if (/\b(do you know me|do u know me|do you remember me|do u remember me|what u know about me|what do you know about me|tell me about me)\b/.test(text)) {
    return { allowed: false, response: 'I only know what is available in this local Pan Agents workspace and the current conversation. I do not know private personal details unless you tell me.' };
  }

  if (/\b(who|what|why|how|where)\b/.test(text) && wordCount(text) <= 3) {
    return { allowed: false, response: 'What do you want to know or do?' };
  }

  return { allowed: true };
}
