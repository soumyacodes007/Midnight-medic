import { describe, it, expect } from 'vitest';
import { parseLsofOutput, parseNetstatOutput } from '../../src/checks/port.js';

describe('parseLsofOutput', () => {
  it('extracts the process name and pid', () => {
    const output = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'com.docke 812 dev   45u  IPv6 0x1234      0t0  TCP *:6300 (LISTEN)',
    ].join('\n');
    expect(parseLsofOutput(output)).toEqual({ name: 'com.docke', pid: '812' });
  });

  it('returns undefined when nothing is listening', () => {
    expect(parseLsofOutput('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n')).toBeUndefined();
  });
});

describe('parseNetstatOutput', () => {
  const output = [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1044',
    '  TCP    0.0.0.0:6300           0.0.0.0:0              LISTENING       4812',
    '  TCP    127.0.0.1:9944         127.0.0.1:52011        ESTABLISHED     7720',
  ].join('\r\n');

  it('finds the pid listening on a port', () => {
    expect(parseNetstatOutput(output, 6300)).toBe('4812');
  });

  it('ignores non-listening connections', () => {
    expect(parseNetstatOutput(output, 9944)).toBeUndefined();
  });

  it('does not match a port that is only a suffix', () => {
    expect(parseNetstatOutput(output, 35)).toBeUndefined();
  });
});
