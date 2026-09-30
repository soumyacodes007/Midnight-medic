import { describe, it, expect } from 'vitest';
import { resolveTimeout } from '../../src/checks/network.js';

describe('resolveTimeout', () => {
  it('falls back to the default when unset', () => {
    expect(resolveTimeout(undefined)).toBe(4000);
  });

  it('uses a valid override', () => {
    expect(resolveTimeout('10000')).toBe(10000);
  });

  it('floors fractional values', () => {
    expect(resolveTimeout('2500.7')).toBe(2500);
  });

  it.each(['abc', '0', '-100', ''])('rejects invalid value %j', (raw) => {
    expect(resolveTimeout(raw)).toBe(4000);
  });
});
