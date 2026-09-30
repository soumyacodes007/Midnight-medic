import { describe, it, expect } from 'vitest';
import { checkDisclosures } from '../../src/lint/rules.js';

const lines = (src: string) => src.split('\n');

describe('checkDisclosures', () => {
  it('flags a witness value assigned to the ledger', () => {
    const src = ['witness secret(): Field;', 'circuit set(): [] {', '  const v = secret();', '  ledger.value = v;', '}'].join('\n');
    const issues = checkDisclosures(lines(src), 'a.compact');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(4);
    expect(issues[0]?.message).toContain("'v'");
  });

  it('ignores assignments that are already disclosed', () => {
    const src = ['witness secret(): Field;', 'ledger.value = v.disclose();'].join('\n');
    expect(checkDisclosures(lines(src), 'a.compact')).toHaveLength(0);
  });

  it('ignores assignments without private context', () => {
    const src = ['circuit set(x: Field): [] {', '  ledger.value = x;', '}'].join('\n');
    expect(checkDisclosures(lines(src), 'a.compact')).toHaveLength(0);
  });

  it('flags ledger increments with an undisclosed value', () => {
    const issues = checkDisclosures(lines('ledger.total += amount;'), 'a.compact');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('increment');
  });

  it('skips commented-out lines', () => {
    const src = ['witness secret(): Field;', '// ledger.value = v;'].join('\n');
    expect(checkDisclosures(lines(src), 'a.compact')).toHaveLength(0);
  });
});
