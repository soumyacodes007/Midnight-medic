export interface CompatEntry {
  ledgerVersion: string;
  proofServerImage: string;
  sdkVersion: string;
  compilerVersion: string;
}

/**
 * Official Midnight Network component compatibility matrix.
 * Keyed by the ledger-vX package version.
 * Update this table as new versions are released.
 */
export const COMPAT_MATRIX: CompatEntry[] = [
  {
    ledgerVersion: '8.0.3',
    proofServerImage: 'midnightntwrk/proof-server:8.0.3',
    sdkVersion: '^4.0.4',
    compilerVersion: '0.30.0',
  },
  {
    ledgerVersion: '8.0.2',
    proofServerImage: 'midnightntwrk/proof-server:8.0.2',
    sdkVersion: '^4.0.3',
    compilerVersion: '0.29.0',
  },
  {
    ledgerVersion: '7.1.0',
    proofServerImage: 'midnightntwrk/proof-server:7.1.0',
    sdkVersion: '^3.1.0',
    compilerVersion: '0.22.0',
  },
];

export const MIDNIGHT_PORTS = {
  proofServer: 6300,
  indexer: 8088,
  node: 9944,
} as const;

export const NETWORK_URLS = {
  preprod: {
    indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    node: 'https://rpc.preprod.midnight.network',
    faucet: 'https://faucet.preprod.midnight.network',
  },
  preview: {
    indexer: 'https://indexer.preview.midnight.network/api/v3/graphql',
    node: 'https://rpc.preview.midnight.network',
    faucet: 'https://faucet.preview.midnight.network',
  },
} as const;

export function findCompatEntry(ledgerVersion: string): CompatEntry | undefined {
  return COMPAT_MATRIX.find((e) => e.ledgerVersion === ledgerVersion);
}
