import type { SelfEvolvingAgent, Tool, ToolRegistry } from '@zero-agents/core';

type AgentWithRegistry = SelfEvolvingAgent & {
  getRegistry(): ToolRegistry;
};

const STOCK_PRICE_TOOL_CODE = `async function execute(params) {
  const aliases = {
    nvidia: 'NVDA',
    nvda: 'NVDA',
    apple: 'AAPL',
    aapl: 'AAPL',
    tesla: 'TSLA',
    tsla: 'TSLA',
    microsoft: 'MSFT',
    msft: 'MSFT',
    google: 'GOOGL',
    googl: 'GOOGL',
    alphabet: 'GOOGL',
    meta: 'META',
    amazon: 'AMZN',
    amzn: 'AMZN'
  };

  const text = String(params.symbol || params.query || params.task || 'NVDA').toLowerCase();
  let symbol = null;
  for (const [alias, ticker] of Object.entries(aliases)) {
    if (text.includes(alias)) {
      symbol = ticker;
      break;
    }
  }
  if (!symbol && /^[a-z.]{1,8}$/i.test(String(params.symbol || ''))) {
    symbol = String(params.symbol).toUpperCase();
  }
  symbol = symbol || 'NVDA';

  const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=1m');
  if (!response.ok) {
    return { error: 'Failed to fetch stock price: HTTP ' + response.status, recovered: false };
  }

  const data = await response.json();
  const result = data && data.chart && Array.isArray(data.chart.result) ? data.chart.result[0] : null;
  const meta = result && result.meta ? result.meta : null;
  const quote = result && result.indicators && Array.isArray(result.indicators.quote) ? result.indicators.quote[0] : null;
  const closes = quote && Array.isArray(quote.close) ? quote.close : [];
  let price = Number(meta && meta.regularMarketPrice);
  if (!Number.isFinite(price)) {
    for (let index = closes.length - 1; index >= 0; index -= 1) {
      const candidate = Number(closes[index]);
      if (Number.isFinite(candidate)) {
        price = candidate;
        break;
      }
    }
  }

  if (!Number.isFinite(price)) {
    return { error: 'Yahoo response did not include a finite stock price', recovered: false };
  }

  return {
    symbol,
    price,
    currency: typeof meta.currency === 'string' ? meta.currency : 'USD',
    marketTime: Number.isFinite(Number(meta.regularMarketTime)) ? Number(meta.regularMarketTime) : null
  };
}`;

const CRYPTO_HISTORICAL_PRICE_TOOL_CODE = `async function execute(params) {
  const aliases = {
    btc: { id: 'bitcoin', symbol: 'BTC' },
    bitcoin: { id: 'bitcoin', symbol: 'BTC' },
    eth: { id: 'ethereum', symbol: 'ETH' },
    ethereum: { id: 'ethereum', symbol: 'ETH' },
    sol: { id: 'solana', symbol: 'SOL' },
    solana: { id: 'solana', symbol: 'SOL' },
    ltc: { id: 'litecoin', symbol: 'LTC' },
    litecoin: { id: 'litecoin', symbol: 'LTC' },
    doge: { id: 'dogecoin', symbol: 'DOGE' },
    dogecoin: { id: 'dogecoin', symbol: 'DOGE' },
    xrp: { id: 'ripple', symbol: 'XRP' },
    ripple: { id: 'ripple', symbol: 'XRP' }
  };

  const text = String(params.symbol || params.query || params.task || 'BTC').toLowerCase();
  let asset = aliases.btc;
  for (const [alias, mapped] of Object.entries(aliases)) {
    if (text.includes(alias)) {
      asset = mapped;
      break;
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const targetSeconds = nowSeconds - 86400;
  const from = targetSeconds - 86400;
  const to = targetSeconds + 86400;
  const url = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(asset.id) + '/market_chart/range?vs_currency=usd&from=' + from + '&to=' + to;
  const response = await fetch(url);
  if (!response.ok) {
    return { error: 'Failed to fetch historical crypto price: HTTP ' + response.status, recovered: false };
  }

  const data = await response.json();
  const prices = data && Array.isArray(data.prices) ? data.prices : [];
  if (prices.length === 0) {
    return { error: 'No historical price data returned', recovered: false };
  }

  const targetMs = targetSeconds * 1000;
  let best = null;
  let bestDistance = Infinity;
  for (const row of prices) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const timestamp = Number(row[0]);
    const price = Number(row[1]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(price)) continue;
    const distance = Math.abs(timestamp - targetMs);
    if (distance < bestDistance) {
      best = { timestamp, price };
      bestDistance = distance;
    }
  }

  if (!best || !Number.isFinite(best.price)) {
    return { error: 'Historical price data did not include a finite price', recovered: false };
  }

  return {
    symbol: asset.symbol,
    price: best.price,
    currency: 'USD',
    timestamp: best.timestamp,
    timeframe: 'yesterday'
  };
}`;

const BUILT_IN_TOOLS: Tool[] = [
  {
    id: 'builtin-get-stock-price',
    name: 'get_stock_price',
    description: 'Fetches current stock/equity prices by ticker or company name, including NVIDIA/NVDA, Apple/AAPL, Tesla/TSLA, Microsoft/MSFT, Google/GOOGL, Meta/META, and Amazon/AMZN.',
    code: STOCK_PRICE_TOOL_CODE,
    schema: {
      input: { symbol: 'string', query: 'string', task: 'string' },
      output: { symbol: 'string', price: 'number', currency: 'string', marketTime: 'number' },
    },
    tags: ['stock', 'stocks', 'equity', 'price', 'quote', 'nvidia', 'nvda'],
    successRate: 1,
    usageCount: 0,
    createdAt: 0,
  },
  {
    id: 'builtin-get-crypto-historical-price',
    name: 'get_crypto_historical_price',
    description: 'Fetches historical or yesterday cryptocurrency prices for BTC/Bitcoin, ETH/Ethereum, SOL/Solana, LTC, DOGE, and XRP in USD.',
    code: CRYPTO_HISTORICAL_PRICE_TOOL_CODE,
    schema: {
      input: { symbol: 'string', query: 'string', task: 'string', timeframe: 'string' },
      output: { symbol: 'string', price: 'number', currency: 'string', timestamp: 'number', timeframe: 'string' },
    },
    tags: ['crypto', 'cryptocurrency', 'historical', 'history', 'yesterday', 'price', 'btc', 'bitcoin'],
    successRate: 1,
    usageCount: 0,
    createdAt: 0,
  },
];

export async function ensureBuiltInTools(agent: SelfEvolvingAgent): Promise<void> {
  const registry = (agent as AgentWithRegistry).getRegistry();

  for (const tool of BUILT_IN_TOOLS) {
    const existing = await registry.getToolByName(tool.name);
    if (existing?.id === tool.id) continue;

    await registry.importTool({
      ...tool,
      createdAt: Date.now(),
    });
  }
}
