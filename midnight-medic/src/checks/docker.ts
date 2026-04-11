import { execSync } from 'node:child_process';
import type { CheckResult } from '../ui/output.js';

// Prepend common install paths for Docker on macOS/Linux
const DOCKER_CMD_PREFIX = 'export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin && ';

function runDocker(cmd: string): string {
  return execSync(`${DOCKER_CMD_PREFIX}${cmd}`, { 
    encoding: 'utf-8', 
    stdio: ['pipe', 'pipe', 'pipe'] 
  }).trim();
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
    runDocker('docker info');
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
    const output = runDocker(
      `docker ps --format "{{.Names}}|||{{.Image}}|||{{.Status}}|||{{.Ports}}"`,
    );
    return output
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
 * Find the most likely proof server container.
 */
export function findProofServerContainer(): string | undefined {
  const containers = listRunningContainers();
  const match = containers.find(
    (c) =>
      c.image.includes('proof-server') ||
      c.name.includes('proof-server') ||
      c.name.includes('prover')
  );
  return match?.name;
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
 * Check for conflicting containers (even if stopped).
 */
export function checkDockerConflicts(containerNames: string[]): CheckResult[] {
  const results: CheckResult[] = [];
  try {
    const output = runDocker('docker ps -a --format "{{.Names}}|||{{.ID}}|||{{.Status}}"');
    
    const allContainers = output.split('\n').filter(Boolean).map(line => {
      const [name, id, status] = line.split('|||');
      return { name: name ?? '', id: id ?? '', status: status ?? '' };
    });

    for (const target of containerNames) {
      const match = allContainers.find(c => c.name === target);
      if (match) {
        // If it's not "Up", it's a potential zombie conflict
        if (!match.status.startsWith('Up')) {
          results.push({
            label: `Conflict: ${target}`,
            status: 'fail',
            detail: `Zombie container detected (ID: ${match.id.substring(0, 7)})`,
            fix: `docker rm -f ${match.id}`,
            metadata: { containerId: match.id }
          });
        }
      }
    }
  } catch {
    // Docker not running or unavailable
  }
  return results;
}

/**
 * Forcefully remove a container by ID.
 */
export function removeContainer(id: string): boolean {
  try {
    runDocker(`docker rm -f ${id}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Docker version string.
 */
export function getDockerVersion(): string {
  try {
    return runDocker('docker version --format "{{.Server.Version}}"');
  } catch {
    return 'unknown';
  }
}
