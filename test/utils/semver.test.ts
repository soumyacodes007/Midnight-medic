import { describe, it, expect } from 'vitest';
import { cleanVersion, parseVersion, compareVersions } from '../../src/utils/semver.js';

describe('cleanVersion', () => {
  it.each([
    ['^4.0.4', '4.0.4'],
    ['~8.0.3', '8.0.3'],
    ['>=0.20', '0.20'],
    ['v1.2.3', '1.2.3'],
    [' 8.0.3 ', '8.0.3'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanVersion(input)).toBe(expected);
  });
});

describe('parseVersion', () => {
  it('parses a full version', () => {
    expect(parseVersion('8.0.3')).toEqual({ major: 8, minor: 0, patch: 3 });
  });

  it('defaults missing components to 0', () => {
    expect(parseVersion('>=0.20')).toEqual({ major: 0, minor: 20, patch: 0 });
  });

  it('returns undefined for non-numeric input', () => {
    expect(parseVersion('latest')).toBeUndefined();
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('8.0.3', '7.1.0')).toBeGreaterThan(0);
    expect(compareVersions('8.0.2', '8.0.3')).toBeLessThan(0);
    expect(compareVersions('^4.0.4', '4.0.4')).toBe(0);
  });
});
