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

/**
 * Get the process name occupying a port using lsof (macOS/Linux).
 * Returns undefined on Windows or if lsof is not available.
 */
function getPortOwner(port: number): { pid: string; name: string } | undefined {
  try {
    const output = execSync(`lsof -i :${port} -sTCP:LISTEN -n -P`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = output.trim().split('\n').slice(1);
    if (lines.length === 0) return undefined;
    const parts = lines[0].trim().split(/\s+/);
    return { name: parts[0] ?? 'unknown', pid: parts[1] ?? '?' };
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
    ? `kill -9 ${owner.pid}  (or: docker stop <container-name>)`
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
