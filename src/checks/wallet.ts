import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CheckResult } from '../ui/output.js';
import { NETWORK_URLS } from '../compat/matrix.js';

/** Read WALLET_SEED from a .env file in the given directory. */
function readWalletSeedFromEnv(cwd: string): string | undefined {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return undefined;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key?.trim() === 'WALLET_SEED') {
      return valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return undefined;
}

/**
 * Query the Preprod Indexer for the tNight (unshielded) balance of a given address.
 * Returns null if the query fails or times out.
 */
async function queryBalance(address: string): Promise<bigint | null> {
  const url = NETWORK_URLS.preprod.indexer;
  const query = `
    query GetBalance($address: String!) {
      unshieldedCoins(where: { address: { _eq: $address } }) {
        value
      }
    }
  `;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { address } }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { unshieldedCoins?: { value: string }[] };
    };

    const coins = json?.data?.unshieldedCoins ?? [];
    return coins.reduce((sum, c) => sum + BigInt(c.value), 0n);
  } catch {
    return null;
  }
}

/**
 * Check wallet balance by reading WALLET_SEED from .env.
 * Tries to dynamically import the Midnight wallet SDK from the project's own node_modules.
 * If the SDK is not available, produces a helpful hint without crashing.
 */
export async function checkWallet(cwd: string): Promise<CheckResult> {
  const label = 'Wallet (WALLET_SEED)';

  const seed = readWalletSeedFromEnv(cwd);
  if (!seed) {
    return {
      label,
      status: 'skip',
      detail: 'WALLET_SEED not found in .env — skipping balance check',
    };
  }

  // Attempt to derive address using the project's own Midnight SDK
  let address: string | undefined;
  try {
    const sdkPath = path.join(cwd, 'node_modules', '@midnight-ntwrk', 'wallet-sdk-hd', 'dist', 'index.js');
    if (fs.existsSync(sdkPath)) {
      const { HDWallet, Roles } = (await import(sdkPath)) as {
        HDWallet: { fromSeed: (b: Buffer) => { type: string; hdWallet: any } };
        Roles: { NightExternal: string };
      };
      const { Buffer } = await import('node:buffer');
      const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
      if (hd.type === 'seedOk') {
        const keys = hd.hdWallet.selectAccount(0).selectRoles([Roles.NightExternal]).deriveKeysAt(0);
        if (keys.type === 'keysDerived') {
          // Grab the unshielded public key hex — the address will be derived from this
          address = keys.keys?.[Roles.NightExternal]?.publicKey?.toString('hex');
        }
      }
    }
  } catch {
    // SDK not available — degrade gracefully
  }

  if (!address) {
    return {
      label,
      status: 'warn',
      detail: 'WALLET_SEED found but could not derive address (SDK not in local node_modules)',
      fix: `Manually check balance at ${NETWORK_URLS.preprod.faucet}`,
    };
  }

  const balance = await queryBalance(address);
  if (balance === null) {
    return {
      label,
      status: 'warn',
      detail: 'WALLET_SEED found but Indexer query timed out — balance unknown',
    };
  }

  if (balance === 0n) {
    return {
      label,
      status: 'warn',
      detail: `${address.slice(0, 20)}... has 0 tNight`,
      fix: `Visit ${NETWORK_URLS.preprod.faucet} to fund your wallet`,
    };
  }

  const formatted = balance.toLocaleString();
  return {
    label,
    status: 'ok',
    detail: `${address.slice(0, 20)}... — ${formatted} tNight`,
  };
}
