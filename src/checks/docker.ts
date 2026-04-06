import { execSync } from 'node:child_process';
import type { CheckResult } from '../ui/output.js';

export interface DockerCheckResult extends CheckResult {
  running: boolean;
}

export interface ContainerInfo {
  name: string;
  image: string;
  status: string;
  ports: string;
}

/**
 * Check if the Docker daemon is running.
 */
export function checkDockerDaemon(): CheckResult {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return { label: 'Daemon', status: 'ok', detail: 'Running' };
  } catch {
    return {
      label: 'Daemon',
      status: 'fail',
      detail: 'Not running or not installed',
      fix: 'Start Docker Desktop or run: sudo systemctl start docker',
    };
  }
}

/**
 * List all running Docker containers as structured objects.
 */
export function listRunningContainers(): ContainerInfo[] {
  try {
    const output = execSync(
      `docker ps --format "{{.Names}}|||{{.Image}}|||{{.Status}}|||{{.Ports}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, image, status, ports] = line.split('|||');
        return { name: name ?? '', image: image ?? '', status: status ?? '', ports: ports ?? '' };
      });
  } catch {
    return [];
  }
}

/**
 * Check if a specific container is running by name.
 */
export function checkContainer(containerName: string): CheckResult {
  const containers = listRunningContainers();
  const match = containers.find((c) => c.name.includes(containerName));

  if (match) {
    return {
      label: `Container '${containerName}'`,
      status: 'ok',
      detail: match.status,
    };
  }

  return {
    label: `Container '${containerName}'`,
    status: 'warn',
    detail: 'Not running',
    fix: `Start it with: docker compose -f proof-server.yml up -d`,
  };
}

/**
 * Get Docker version string.
 */
export function getDockerVersion(): string {
  try {
    return execSync('docker version --format "{{.Server.Version}}"', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'unknown';
  }
}
