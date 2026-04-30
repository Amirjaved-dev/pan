import chalk from 'chalk';
import { writeLine } from './quiet-console.js';

const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets';
const COINGECKO_SIMPLE_URL = 'https://api.coingecko.com/api/v3/simple/price';

const SYMBOL_TO_ID: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  ltc: 'litecoin',
  doge: 'dogecoin',
  xrp: 'ripple',
  ada: 'cardano',
  bnb: 'binancecoin',
  dot: 'polkadot',
  link: 'chainlink',
  avax: 'avalanche-2',
  uni: 'uniswap',
  trx: 'tron',
};

type CoinMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap_rank: number | null;
  price_change_percentage_24h: number | null;
};

type SimplePrice = Record<string, { usd?: number; usd_24h_change?: number }>;

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isCryptoMarketTask(input: string): boolean {
  const text = normalize(input);
  const asksPrice = /\b(price|prices|live|market|quote|worth|rate)\b/.test(text);
  const mentionsCrypto = /\b(crypto|cryptos|coin|coins|token|tokens|btc|bitcoin|eth|ethereum|sol|solana|ltc|litecoin|doge|xrp|ada|bnb)\b/.test(text);
  return asksPrice && mentionsCrypto;
}

function getRequestedTopCount(input: string): number | null {
  const match = input.match(/\btop\s+(\d{1,2})\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(25, value));
}

function getRequestedIds(input: string): string[] {
  const text = normalize(input);
  const ids = new Set<string>();

  for (const [symbol, id] of Object.entries(SYMBOL_TO_ID)) {
    if (new RegExp(`\\b${symbol}\\b`).test(text)) ids.add(id);
  }

  if (/\bbitcoin\b/.test(text)) ids.add('bitcoin');
  if (/\bethereum\b/.test(text)) ids.add('ethereum');
  if (/\bsolana\b/.test(text)) ids.add('solana');
  if (/\blitecoin\b/.test(text)) ids.add('litecoin');

  return Array.from(ids);
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function formatChange(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

async function fetchTopMarkets(count: number): Promise<CoinMarket[]> {
  const url = new URL(COINGECKO_MARKETS_URL);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('order', 'market_cap_desc');
  url.searchParams.set('per_page', String(count));
  url.searchParams.set('page', '1');
  url.searchParams.set('sparkline', 'false');
  url.searchParams.set('price_change_percentage', '24h');
  return fetchJson<CoinMarket[]>(url.toString());
}

async function fetchSimplePrices(ids: string[]): Promise<SimplePrice> {
  const url = new URL(COINGECKO_SIMPLE_URL);
  url.searchParams.set('ids', ids.join(','));
  url.searchParams.set('vs_currencies', 'usd');
  url.searchParams.set('include_24hr_change', 'true');
  return fetchJson<SimplePrice>(url.toString());
}

export async function runCryptoMarketTask(task: string): Promise<void> {
  const topCount = getRequestedTopCount(task);
  const fetchedAt = new Date().toISOString();

  if (topCount) {
    const markets = await fetchTopMarkets(topCount);
    writeLine(chalk.green('[result]'));
    writeLine(`Top ${markets.length} crypto prices by market cap`);
    writeLine(`Source: CoinGecko | fetchedAt: ${fetchedAt}`);
    writeLine('');
    for (const coin of markets) {
      const rank = coin.market_cap_rank ? `#${coin.market_cap_rank}` : '#?';
      writeLine(`${rank.padEnd(4)} ${coin.name.padEnd(16)} ${coin.symbol.toUpperCase().padEnd(6)} ${formatUsd(coin.current_price).padStart(14)}  24h ${formatChange(coin.price_change_percentage_24h)}`);
    }
    return;
  }

  const ids = getRequestedIds(task);
  if (ids.length === 0) {
    writeLine(chalk.yellow('  Which crypto asset should I price? Try "btc price" or "top 10 crypto prices".'));
    return;
  }

  const prices = await fetchSimplePrices(ids);
  writeLine(chalk.green('[result]'));
  writeLine(`Crypto prices`);
  writeLine(`Source: CoinGecko | fetchedAt: ${fetchedAt}`);
  writeLine('');
  for (const id of ids) {
    const item = prices[id];
    if (!item?.usd) {
      writeLine(`${id}: unavailable`);
      continue;
    }
    writeLine(`${id.padEnd(16)} ${formatUsd(item.usd).padStart(14)}  24h ${formatChange(item.usd_24h_change)}`);
  }
}
