import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { header, ok, fail, warn, info, divider } from '../ui/output.js';

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

/** Find candidate LevelDB state directories in the project. */
function findStateDirs(cwd: string): string[] {
  const candidates = ['db', 'private-state', '.private-state', 'state', 'data/private'];
  return candidates
    .map((c) => path.join(cwd, c))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
}

/** Pretty-print a JSON object as an indented tree to the terminal. */
function printStateTree(obj: unknown, indent = '    '): void {
  if (obj === null || obj === undefined) {
    console.log(`${indent}${chalk.dim('(empty)')}`);
    return;
  }

  if (typeof obj !== 'object') {
    console.log(`${indent}${chalk.yellow(String(obj))}`);
    return;
  }

  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) {
    console.log(`${indent}${chalk.dim('{}')}`);
    return;
  }

  for (const [key, value] of entries) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      console.log(`${indent}${chalk.cyan(key)}:`);
      printStateTree(value, indent + '  ');
    } else if (Array.isArray(value)) {
      console.log(`${indent}${chalk.cyan(key)}: ${chalk.dim(`[Array: ${value.length} items]`)}`);
      if (value.length > 0 && value.length <= 5) {
        value.forEach((item, i) => {
          console.log(`${indent}  ${chalk.dim(`[${i}]`)} ${chalk.yellow(String(item))}`);
        });
      }
    } else if (typeof value === 'bigint') {
      console.log(`${indent}${chalk.cyan(key)}: ${chalk.green(value.toString())} ${chalk.dim('(BigInt)')}`);
    } else if (typeof value === 'boolean') {
      console.log(`${indent}${chalk.cyan(key)}: ${value ? chalk.green('true') : chalk.red('false')}`);
    } else {
      // Truncate long hex/byte strings
      const displayValue = String(value);
      const truncated =
        displayValue.length > 64
          ? displayValue.slice(0, 32) + chalk.dim('...') + displayValue.slice(-8)
          : displayValue;
      console.log(`${indent}${chalk.cyan(key)}: ${chalk.yellow(truncated)}`);
    }
  }
}

export async function runInspect(options: { cwd: string; db?: string }): Promise<void> {
  header('Midnight Inspect — private state viewer...');

  // ── 1. Read Wallet Seed ──────────────────────────────────────────────────
  const seed = readWalletSeedFromEnv(options.cwd);
  if (!seed) {
    fail('WALLET_SEED', 'Not found in .env', 'Add WALLET_SEED=<your-seed-hex> to your .env file');
    console.log('');
    return;
  }
  ok('WALLET_SEED', `Found (${seed.length} chars)`);

  // ── 2. Locate LevelDB Directory ──────────────────────────────────────────
  let dbDir: string | undefined = options.db;
  if (!dbDir) {
    const found = findStateDirs(options.cwd);
    if (found.length === 0) {
      warn(
        'LevelDB',
        'No local state directory found (db/, private-state/, state/)',
        'Run your DApp at least once to create local state, then run inspect again',
      );
      console.log('');
      return;
    }
    dbDir = found[0]!;
    info('LevelDB', `Using ${path.relative(options.cwd, dbDir)}/`);
  } else if (!fs.existsSync(dbDir)) {
    fail('LevelDB', `Directory '${options.db}' does not exist`);
    console.log('');
    return;
  }

  // ── 3. Try SDK-based decryption ──────────────────────────────────────────
  console.log('');
  const possibleSdkPaths = [
    path.join(options.cwd, 'node_modules', '@midnight-ntwrk', 'midnight-js-level-private-state-provider', 'dist', 'index.js'),
    path.join(options.cwd, 'node_modules', '@midnight-ntwrk', 'midnight-js-level-private-state-provider', 'dist', 'cjs', 'index.js'),
  ];

  const sdkPath = possibleSdkPaths.find((p) => fs.existsSync(p));

  if (sdkPath) {
    ok('SDK', `Found midnight-js-level-private-state-provider`);
    console.log('');

    try {
      const sdk = (await import(sdkPath)) as {
        LevelPrivateStateProvider?: {
          open: (dir: string, seed: Buffer) => Promise<{ getState: () => Promise<unknown> }>;
        };
        createLevelPrivateStateProvider?: unknown;
      };

      const { Buffer } = await import('node:buffer');
      const seedBuffer = Buffer.from(seed, 'hex');

      // Try to open the private state store using the SDK
      if (sdk.LevelPrivateStateProvider?.open) {
        const store = await sdk.LevelPrivateStateProvider.open(dbDir, seedBuffer);
        const state = await store.getState();
        console.log(`  ${chalk.bold.white('Private State')}`);
        divider();
        printStateTree(state);
        console.log('');
        divider();
        ok('Inspection complete', 'State decrypted successfully via SDK.');
      } else {
        throw new Error('SDK API shape mismatch — trying fallback raw read');
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      warn('SDK Decryption', `Failed: ${message}`);
      console.log(chalk.dim(`  Falling back to raw directory listing...\n`));
      rawDirFallback(dbDir, options.cwd);
    }
  } else {
    warn(
      'SDK Not Found',
      '@midnight-ntwrk/midnight-js-level-private-state-provider not in local node_modules',
    );
    console.log(chalk.dim('  Showing raw LevelDB directory contents instead:\n'));
    rawDirFallback(dbDir, options.cwd);
  }

  console.log('');
}

/** Fallback: show raw db/ file listing if SDK decryption isn't available. */
function rawDirFallback(dbDir: string, cwd: string): void {
  try {
    const entries = fs.readdirSync(dbDir, { withFileTypes: true });
    if (entries.length === 0) {
      info('LevelDB', 'Directory is empty — no local state has been written yet');
      return;
    }
    console.log(`  ${chalk.bold.white('LevelDB Contents')} (encrypted — SDK required to decrypt)`);
    divider();
    for (const entry of entries.slice(0, 20)) {
      const relPath = path.relative(cwd, path.join(dbDir, entry.name));
      if (entry.isDirectory()) {
        info(relPath + '/', chalk.dim('directory'));
      } else {
        const size = fs.statSync(path.join(dbDir, entry.name)).size;
        info(relPath, `${(size / 1024).toFixed(1)} KB`);
      }
    }
    if (entries.length > 20) {
      console.log(chalk.dim(`    ...and ${entries.length - 20} more files`));
    }
  } catch {
    fail('LevelDB', 'Could not read directory');
  }
}
