import { describe, it, expect } from 'vitest';
import { checkAssertMessages } from '../../src/lint/rules.js';

const lines = (src: string) => src.split('\n');

describe('checkAssertMessages', () => {
  it('accepts an assert with a message', () => {
    expect(checkAssertMessages(lines('  assert(x > 0, "x must be positive");'), 'a.compact')).toHaveLength(0);
  });

  it('flags an assert without a message', () => {
    const issues = checkAssertMessages(lines('  assert(x > 0);'), 'a.compact');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(1);
  });

  it('ignores commented-out asserts', () => {
    expect(checkAssertMessages(lines('// assert(x > 0);'), 'a.compact')).toHaveLength(0);
  });

  it('does not match identifiers that merely contain "assert"', () => {
    expect(checkAssertMessages(lines('reassert(x);'), 'a.compact')).toHaveLength(0);
  });
});

describe('rule ids', () => {
  it('tags assert issues with their rule id', () => {
    expect(checkAssertMessages(lines('assert(x);'), 'a.compact')[0]?.rule).toBe('assert-message');
  });
});
