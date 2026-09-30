import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Parse the contents of a .env file into a key/value map.
 * Supports comments, `export` prefixes, and single/double quoted values.
 */
export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    if (!key) continue;

    result[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  return result;
}

/** Read a single variable from the .env file in `cwd`, if present. */
export function readEnvValue(cwd: string, key: string): string | undefined {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return undefined;
  return parseEnv(fs.readFileSync(envPath, 'utf-8'))[key];
}

/** Read WALLET_SEED from the .env file in `cwd`. */
export function readWalletSeedFromEnv(cwd: string): string | undefined {
  return readEnvValue(cwd, 'WALLET_SEED');
}
