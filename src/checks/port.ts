import * as net from 'node:net';
import { execSync } from 'node:child_process';
import type { CheckResult } from '../ui/output.js';

export interface PortCheckResult extends CheckResult {
  port: number;
  occupied: boolean;
  pid?: string;
  processName?: string;
}

/**
 * Check if a TCP port is available using node:net.
 * Returns true if the port is available (connection refused), false if occupied.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket
      .on('connect', () => {
        socket.destroy();
        resolve(false); // port is occupied
      })
      .on('timeout', () => {
        socket.destroy();
        resolve(true); // assume available
      })
      .on('error', () => {
        resolve(true); // connection refused = available
      })
      .connect(port, '127.0.0.1');
  });
}

export interface PortOwner {
  pid: string;
  name: string;
}

/** Parse `lsof -i :<port> -sTCP:LISTEN -n -P` output (macOS/Linux). */
export function parseLsofOutput(output: string): PortOwner | undefined {
  const lines = output.trim().split('\n').slice(1);
  if (lines.length === 0 || !lines[0]?.trim()) return undefined;
  const parts = lines[0].trim().split(/\s+/);
  return { name: parts[0] ?? 'unknown', pid: parts[1] ?? '?' };
}

/** Parse `netstat -ano -p tcp` output (Windows) and return the PID listening on `port`. */
export function parseNetstatOutput(output: string, port: number): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // Proto  Local Address  Foreign Address  State  PID
    if (parts.length < 5 || parts[0]?.toUpperCase() !== 'TCP') continue;
    if (parts[3]?.toUpperCase() !== 'LISTENING') continue;
    if (parts[1]?.endsWith(`:${port}`)) return parts[4];
  }
  return undefined;
}

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Get the process occupying a port.
 * Uses lsof on macOS/Linux and netstat + tasklist on Windows.
 */
function getPortOwner(port: number): PortOwner | undefined {
  try {
    if (process.platform === 'win32') {
      const pid = parseNetstatOutput(run('netstat -ano -p tcp'), port);
      if (!pid) return undefined;
      const csv = run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).trim();
      const name = csv.match(/^"([^"]+)"/)?.[1] ?? 'unknown';
      return { pid, name };
    }
    return parseLsofOutput(run(`lsof -i :${port} -sTCP:LISTEN -n -P`));
  } catch {
    return undefined;
  }
}

export async function checkPort(port: number, label: string): Promise<PortCheckResult> {
  const available = await isPortAvailable(port);

  if (available) {
    return {
      label,
      port,
      occupied: false,
      status: 'ok',
      detail: 'Available',
    };
  }

  const owner = getPortOwner(port);
  const detail = owner ? `Occupied by '${owner.name}' (pid ${owner.pid})` : 'Occupied';
  const fix = owner
    ? `${process.platform === 'win32' ? `taskkill /PID ${owner.pid} /F` : `kill -9 ${owner.pid}`}  (or: docker stop <container-name>)`
    : `Find what is using port ${port} and stop it`;

  return {
    label,
    port,
    occupied: true,
    pid: owner?.pid,
    processName: owner?.name,
    status: 'fail',
    detail,
    fix,
  };
}
