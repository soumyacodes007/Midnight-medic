import { describe, it, expect } from 'vitest';
import { extractConstructorArgs } from '../../src/lint/rules.js';

const lines = (src: string) => src.split('\n');

describe('extractConstructorArgs', () => {
  it('returns null when there is no constructor', () => {
    expect(extractConstructorArgs(lines('export circuit foo(): [] {}'), 'a.compact')).toBeNull();
  });

  it('reports constructor arguments', () => {
    const issue = extractConstructorArgs(lines('constructor(owner: Bytes<32>, limit: Uint<64>) {'), 'a.compact');
    expect(issue?.message).toContain('2 arg(s)');
    expect(issue?.fix).toContain('args: [<value>, <value>]');
  });

  it('does not count the context parameter', () => {
    const issue = extractConstructorArgs(lines('constructor(owner: Bytes<32>, context) {'), 'a.compact');
    expect(issue?.message).toContain('1 arg(s)');
  });

  it('reports the line number of the constructor', () => {
    const src = 'pragma compact version "0.30";\n\nconstructor(owner: Bytes<32>) {';
    expect(extractConstructorArgs(lines(src), 'a.compact')?.line).toBe(3);
  });
});
