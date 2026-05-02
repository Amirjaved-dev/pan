/**
 * Detect ENS name from AGENT2_PRIVATE_KEY and print it to stdout.
 * Used by pan2.ps1 to auto-resolve identity before starting the shell.
 */
import { config as loadEnv } from 'dotenv';
import { detectEnsName } from './src/identity/ens.js';

loadEnv();

const privateKey = process.env.AGENT2_PRIVATE_KEY ?? process.env.ZERO_G_PRIVATE_KEY ?? '';
const rpcUrl = process.env.SEPOLIA_RPC_URL ?? 'https://sepolia.drpc.org';

if (!privateKey || privateKey === '0xYOUR_AGENT2_PRIVATE_KEY_HERE') {
  process.stderr.write('[ens] AGENT2_PRIVATE_KEY not set — using fallback name\n');
  process.stdout.write('execute-agent.eth\n');
  process.exit(0);
}

try {
  const name = await detectEnsName(privateKey, rpcUrl);
  process.stdout.write(`${name}\n`);
} catch {
  // Not resolvable on-chain — derive a deterministic name from address prefix
  const { Wallet } = await import('ethers');
  try {
    const wallet = new Wallet(privateKey);
    const addr = wallet.address.toLowerCase().slice(2, 8);
    process.stdout.write(`agent-${addr}.eth\n`);
  } catch {
    process.stdout.write('execute-agent.eth\n');
  }
}
