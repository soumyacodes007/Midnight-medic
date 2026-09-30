import { describe, it, expect } from 'vitest';
import {
  COMPAT_MATRIX,
  MIDNIGHT_PORTS,
  findCompatEntry,
  findCompatEntryByImage,
  latestCompatEntry,
} from '../../src/compat/matrix.js';

describe('compat matrix', () => {
  it('has unique ledger versions', () => {
    const versions = COMPAT_MATRIX.map((e) => e.ledgerVersion);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('pins each proof-server image to its ledger version', () => {
    for (const entry of COMPAT_MATRIX) {
      expect(entry.proofServerImage.endsWith(`:${entry.ledgerVersion}`)).toBe(true);
    }
  });

  it('finds entries by exact or ranged version', () => {
    expect(findCompatEntry('8.0.3')?.sdkVersion).toBe('^4.0.4');
    expect(findCompatEntry('^8.0.2')?.sdkVersion).toBe('^4.0.3');
    expect(findCompatEntry('1.0.0')).toBeUndefined();
  });

  it('finds entries by proof-server image', () => {
    expect(findCompatEntryByImage('midnightntwrk/proof-server:7.1.0')?.ledgerVersion).toBe('7.1.0');
  });

  it('returns the newest entry as latest', () => {
    expect(latestCompatEntry().ledgerVersion).toBe('8.0.3');
  });

  it('uses the standard Midnight ports', () => {
    expect(MIDNIGHT_PORTS).toEqual({ proofServer: 6300, indexer: 8088, node: 9944 });
  });
});
