import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { parseEnv, readEnvValue, readWalletSeedFromEnv } from '../../src/utils/env.js';

describe('parseEnv', () => {
  it('parses simple key/value pairs', () => {
    expect(parseEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('skips comments and blank lines', () => {
    expect(parseEnv('# comment\n\nA=1\n  # indented comment')).toEqual({ A: '1' });
  });

  it('strips surrounding quotes', () => {
    expect(parseEnv(`A="quoted"\nB='single'`)).toEqual({ A: 'quoted', B: 'single' });
  });

  it('keeps "=" characters inside values', () => {
    expect(parseEnv('URL=https://x.io/?a=b')).toEqual({ URL: 'https://x.io/?a=b' });
  });

  it('handles export prefixes and CRLF line endings', () => {
    expect(parseEnv('export A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
});

describe('readEnvValue', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('returns undefined when there is no .env file', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medic-env-'));
    expect(readEnvValue(dir, 'ANY')).toBeUndefined();
  });

  it('reads WALLET_SEED from .env', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medic-env-'));
    fs.writeFileSync(path.join(dir, '.env'), 'WALLET_SEED="abc123"\n');
    expect(readWalletSeedFromEnv(dir)).toBe('abc123');
  });
});
