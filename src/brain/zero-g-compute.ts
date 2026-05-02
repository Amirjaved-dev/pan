import { createRequire } from 'node:module';

const ZERO_G_RPC_URL = 'https://evmrpc-testnet.0g.ai';
const ZERO_G_FETCH_TIMEOUT_MS = 15_000;

type ZeroGChatOptions = {
  privateKey: string;
  rpcUrl?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
};

type ZeroGChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

type Broker = {
  inference: {
    listService(): Promise<unknown[]>;
    getServiceMetadata(providerAddress: string): Promise<{ endpoint: string; model: string }>;
    getRequestHeaders(providerAddress: string): Promise<Record<string, string>>;
  };
};

function createCoreRequire(): NodeRequire {
  const localRequire = createRequire(import.meta.url);
  const coreEntry = localRequire.resolve('@zero-agents/core');
  return createRequire(coreEntry);
}

function isChatbotService(service: unknown): service is unknown[] {
  return Array.isArray(service) && service[1] === 'chatbot' && Boolean(service[10]);
}

async function getChatbotProviderAddress(listService: () => Promise<unknown[]>): Promise<string> {
  const services = await listService();
  const chatbot = services.find(isChatbotService);
  const provider = chatbot?.[0];
  if (typeof provider !== 'string' || !provider) {
    throw new Error('0G Compute did not return an available chatbot provider');
  }
  return provider;
}

function isZeroGChatCompletionResponse(value: unknown): value is ZeroGChatCompletionResponse {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as ZeroGChatCompletionResponse).choices),
  );
}

export async function createZeroGChatCompletion(options: ZeroGChatOptions): Promise<string> {
  const coreRequire = createCoreRequire();
  const { ethers } = coreRequire('ethers') as {
    ethers: {
      JsonRpcProvider: new (url: string) => unknown;
      Wallet: new (privateKey: string, provider: unknown) => unknown;
    };
  };
  const { createZGComputeNetworkBroker } = coreRequire('@0glabs/0g-serving-broker') as {
    createZGComputeNetworkBroker(wallet: unknown): Promise<Broker>;
  };

  const provider = new ethers.JsonRpcProvider(options.rpcUrl ?? ZERO_G_RPC_URL);
  const wallet = new ethers.Wallet(options.privateKey, provider);
  const broker = await createZGComputeNetworkBroker(wallet);
  const providerAddress = await getChatbotProviderAddress(broker.inference.listService.bind(broker.inference));
  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
  const headers = await broker.inference.getRequestHeaders(providerAddress);

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(ZERO_G_FETCH_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`0G Compute request failed with status ${response.status}`);
  }

  const data = await response.json() as unknown;
  if (!isZeroGChatCompletionResponse(data)) {
    throw new Error('0G Compute returned an invalid chat completion response');
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('0G Compute returned an empty chat completion response');
  }

  return content;
}
