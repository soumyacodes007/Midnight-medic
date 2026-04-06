import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { checkDockerDaemon, getDockerVersion } from '../checks/docker.js';
import { checkPort } from '../checks/port.js';
import { checkIndexer, checkProofServer } from '../checks/network.js';
import { checkWallet } from '../checks/wallet.js';
import { MIDNIGHT_PORTS } from '../compat/matrix.js';
import { section, printResult, summary, header, divider } from '../ui/output.js';
import type { CheckResult } from '../ui/output.js';

function countResults(results: CheckResult[]): { errors: number; warnings: number } {
  return results.reduce(
    (acc, r) => {
      if (r.status === 'fail') acc.errors++;
      if (r.status === 'warn') acc.warnings++;
      return acc;
    },
    { errors: 0, warnings: 0 },
  );
}

/** Format results as Markdown for clipboard export. */
function formatMarkdown(
  dockerResult: CheckResult,
  portResults: CheckResult[],
  networkResults: CheckResult[],
  proofResult: CheckResult,
  walletResult: CheckResult,
): string {
  const statusIcon = (status: string) =>
    status === 'ok' ? '✓' : status === 'fail' ? 'x' : '!';

  const lines = [
    '## Midnight Medic — Environment Report',
    '',
    `**Generated**: ${new Date().toISOString()}`,
    '',
    '### Docker',
    `- [${statusIcon(dockerResult.status)}] ${dockerResult.label}: ${dockerResult.detail ?? ''}`,
    '',
    '### Ports',
    ...portResults.map(
      (r) => `- [${statusIcon(r.status)}] Port ${r.label}: ${r.detail ?? ''}${r.fix ? ` → ${r.fix}` : ''}`,
    ),
    '',
    '### Network',
    ...networkResults.map(
      (r) => `- [${statusIcon(r.status)}] ${r.label}: ${r.detail ?? ''}`,
    ),
    '',
    '### Proof Server',
    `- [${statusIcon(proofResult.status)}] ${proofResult.label}: ${proofResult.detail ?? ''}`,
    '',
    '### Wallet',
    `- [${statusIcon(walletResult.status)}] ${walletResult.label}: ${walletResult.detail ?? ''}`,
  ];

  return lines.join('\n');
}

/** Copy text to clipboard using OS-native tools. */
function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else if (platform === 'linux') {
      execSync('xclip -selection clipboard', { input: text });
    } else if (platform === 'win32') {
      execSync('clip', { input: text });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(options: { export: boolean; cwd: string }): Promise<void> {
  header('Midnight Doctor — running environment scan...');

  const allResults: CheckResult[] = [];

  // ── Docker ─────────────────────────────────────────────────────────────────
  section('Docker');
  const dockerVersion = getDockerVersion();
  const dockerResult = checkDockerDaemon();
  if (dockerResult.status === 'ok' && dockerVersion !== 'unknown') {
    dockerResult.detail = `Running (v${dockerVersion})`;
  }
  printResult(dockerResult);
  allResults.push(dockerResult);

  // ── Ports ──────────────────────────────────────────────────────────────────
  section('Ports');
  const portKeys = Object.entries(MIDNIGHT_PORTS) as [string, number][];
  const portResults = await Promise.all(
    portKeys.map(([name, port]) =>
      checkPort(port, `${port} (${name})`),
    ),
  );
  portResults.forEach((r) => {
    printResult(r);
    allResults.push(r);
  });

  // ── Network ────────────────────────────────────────────────────────────────
  section('Network');
  const [preprodResult, previewResult] = await Promise.all([
    checkIndexer('preprod'),
    checkIndexer('preview'),
  ]);
  printResult(preprodResult);
  printResult(previewResult);
  allResults.push(preprodResult, previewResult);

  // ── Proof Server ───────────────────────────────────────────────────────────
  section('Proof Server');
  const proofResult = await checkProofServer();
  printResult(proofResult);
  allResults.push(proofResult);

  // ── Wallet ─────────────────────────────────────────────────────────────────
  section('Wallet');
  const walletResult = await checkWallet(options.cwd);
  printResult(walletResult);
  allResults.push(walletResult);

  // ── Summary ────────────────────────────────────────────────────────────────
  const { errors, warnings } = countResults(allResults);
  summary(errors, warnings);

  // ── Export ─────────────────────────────────────────────────────────────────
  if (options.export) {
    divider();
    const markdown = formatMarkdown(dockerResult, portResults, [preprodResult, previewResult], proofResult, walletResult);
    const copied = copyToClipboard(markdown);
    if (copied) {
      console.log(`  ${chalk.green('[✓]')} Report copied to clipboard. Paste it into Discord.`);
    } else {
      console.log(`  ${chalk.yellow('[!]')} Could not copy to clipboard. Here is the report:\n`);
      console.log(chalk.dim(markdown));
    }
    console.log('');
  }
}
