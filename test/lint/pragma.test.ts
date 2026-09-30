import { describe, it, expect } from 'vitest';
import { checkPragma } from '../../src/lint/rules.js';

const lines = (src: string) => src.split('\n');

describe('checkPragma', () => {
  it('accepts a modern pragma', () => {
    expect(checkPragma(lines('pragma compact version ">=0.20";'), 'a.compact')).toBeNull();
  });

  it('accepts a pragma that is not on the first line', () => {
    const src = '// header comment\n\npragma compact version "0.30";';
    expect(checkPragma(lines(src), 'a.compact')).toBeNull();
  });

  it('warns on an outdated pragma', () => {
    const issue = checkPragma(lines('pragma compact version "0.18";'), 'a.compact');
    expect(issue).not.toBeNull();
    expect(issue?.severity).toBe('warn');
    expect(issue?.line).toBe(1);
    expect(issue?.message).toContain('0.18');
  });

  it('warns when no pragma is present', () => {
    const issue = checkPragma(lines('export circuit foo(): [] {}'), 'a.compact');
    expect(issue?.message).toBe('No pragma directive found');
  });

  it('only looks at the first 10 lines', () => {
    const src = Array(12).fill('// filler').join('\n') + '\npragma compact version "0.30";';
    expect(checkPragma(lines(src), 'a.compact')?.message).toBe('No pragma directive found');
  });
});
