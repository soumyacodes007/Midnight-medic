import type { CheckResult } from '../ui/output.js';
import { NETWORK_URLS } from '../compat/matrix.js';

const TIMEOUT_MS = 4000;

/** Fetch with a configurable timeout via AbortController. */
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ping the Midnight Indexer GraphQL endpoint.
 * Uses a lightweight introspection query to check connectivity and block height.
 */
export async function checkIndexer(
  network: 'preprod' | 'preview',
): Promise<CheckResult & { blockHeight?: number }> {
  const url = NETWORK_URLS[network].indexer;
  const label = `${network.charAt(0).toUpperCase() + network.slice(1)} Indexer`;

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });

    if (!res.ok) {
      return { label, status: 'fail', detail: `HTTP ${res.status}` };
    }

    return { label, status: 'ok', detail: `Reachable (${url})` };
  } catch (e: unknown) {
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return {
      label,
      status: 'fail',
      detail: isTimeout ? `Timeout (>${TIMEOUT_MS}ms)` : 'Unreachable',
      fix: 'Check your internet connection or Midnight network status.',
    };
  }
}

/**
 * Check the local Proof Server health endpoint.
 */
export async function checkProofServer(
  port = 6300,
): Promise<CheckResult & { version?: string }> {
  const url = `http://localhost:${port}/version`;
  const label = `Proof Server (localhost:${port})`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      return { label, status: 'fail', detail: `HTTP ${res.status}` };
    }
    const text = (await res.text()).trim().replace(/"/g, '');
    
    // Validate that it looks like a semantic version (e.g. 8.0.3)
    const isVersion = /^\d+\.\d+\.\d+$/.test(text);
    
    if (isVersion) {
      return { label, status: 'ok', detail: `Healthy (v${text})`, version: text };
    } else {
      return { 
        label, 
        status: 'fail', 
        detail: `Invalid response: "${text.substring(0, 20)}..."`,
        fix: 'A non-Midnight process is responding on this port. Run with --fix to clear it.'
      };
    }
  } catch (e: unknown) {
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return {
      label,
      status: 'fail',
      detail: isTimeout ? `Timeout (>${TIMEOUT_MS}ms)` : 'Not reachable',
      fix: `Start the proof server with: npm run preprod-ps`,
    };
  }
}
