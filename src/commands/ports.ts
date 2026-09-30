import { header, printResult, summary } from '../ui/output.js';
import { checkPort } from '../checks/port.js';
import { MIDNIGHT_PORTS } from '../compat/matrix.js';

export interface PortsOptions {
  json?: boolean;
}

const PORT_LABELS: Record<keyof typeof MIDNIGHT_PORTS, string> = {
  proofServer: 'Proof Server',
  indexer: 'Indexer',
  node: 'Node',
};

/** Quick check of the local ports used by the Midnight stack. */
export async function runPorts(options: PortsOptions = {}): Promise<void> {
  const entries = Object.entries(MIDNIGHT_PORTS) as [keyof typeof MIDNIGHT_PORTS, number][];
  const results = await Promise.all(
    entries.map(([key, port]) => checkPort(port, `${PORT_LABELS[key]} (${port})`)),
  );

  const failures = results.filter((r) => r.status === 'fail').length;
  if (failures > 0) process.exitCode = 1;

  if (options.json) {
    console.log(
      JSON.stringify(
        results.map(({ port, occupied, pid, processName }) => ({ port, occupied, pid, processName })),
        null,
        2,
      ),
    );
    return;
  }

  header('Midnight Ports — checking local port availability...');
  for (const result of results) printResult(result);
  summary(failures, 0);
}
