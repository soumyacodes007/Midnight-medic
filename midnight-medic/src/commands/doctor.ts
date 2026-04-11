import chalk from 'chalk';
import { execSync } from 'node:child_process';
import { checkDockerDaemon, getDockerVersion, checkDockerConflicts, removeContainer } from '../checks/docker.js';
import { checkPort, killProcess } from '../checks/port.js';
import { checkIndexer, checkProofServer } from '../checks/network.js';
import { checkWallet } from '../checks/wallet.js';
import { MIDNIGHT_PORTS } from '../compat/matrix.js';
import { section, printResult, summary, header, divider, info } from '../ui/output.js';
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

export async function runDoctor(options: { export: boolean; cwd: string; fix?: boolean }): Promise<void> {
  header('Midnight Doctor — running environment scan...');
  if (options.fix) {
    info('Healing Engine', 'Auto-fix mode engaged. Attempting to resolve failures...');
  }

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

  // ── Conflicts (Zombie Containers) ──────────────────────────────────────────
  const conflictResults = checkDockerConflicts(['skity-proof-server', 'skity-indexer', 'skity-node']);
  if (conflictResults.length > 0) {
    section('Conflicts');
    for (const r of conflictResults) {
      if (options.fix && r.status === 'fail' && r.metadata?.containerId) {
        process.stdout.write(chalk.dim(`    [fix] Removing zombie container ${r.label.split(': ')[1]}... `));
        const success = removeContainer(r.metadata.containerId as string);
        if (success) {
          console.log(chalk.green('Done.'));
          r.status = 'ok';
          r.detail = chalk.dim('Conflict cleared by doctor');
          r.fix = undefined;
        } else {
          console.log(chalk.red('Failed.'));
        }
      }
      printResult(r);
      allResults.push(r);
    }
  }

  // ── Network & Proof Server (Check first to inform Port results) ───────────
  const [preprodResult, previewResult, proofResult] = await Promise.all([
    checkIndexer('preprod'),
    checkIndexer('preview'),
    checkProofServer(),
  ]);

  // ── Ports ──────────────────────────────────────────────────────────────────
  section('Ports');
  const portKeys = Object.entries(MIDNIGHT_PORTS) as [string, number][];
  const portResults = await Promise.all(
    portKeys.map(([name, port]) =>
      checkPort(port, `${port} (${name})`),
    ),
  );

  let anyFixes = false;
  portResults.forEach((r) => {
    // Suppress error if the Proof Server is actually healthy on this port
    if (r.port === 6300 && proofResult.status === 'ok') {
      r.status = 'ok';
      r.detail = chalk.green('Active (Expected: Proof Server)');
      r.fix = undefined;
    }
    // Suppress error if Indexer is healthy on this port (8088)
    if (r.port === 8088 && (preprodResult.status === 'ok' || previewResult.status === 'ok')) {
      r.status = 'ok';
      r.detail = chalk.green('Active (Expected: Indexer)');
      r.fix = undefined;
    }

    // Attempt fix if port is occupied and not by an expected service
    if (options.fix && r.status === 'fail' && r.occupied && r.pid) {
      process.stdout.write(chalk.dim(`    [fix] Terminating process ${r.pid} (${r.processName})... `));
      const success = killProcess(r.pid);
      if (success) {
        console.log(chalk.green('Done.'));
        r.status = 'ok';
        r.detail = chalk.dim('Port cleared by doctor');
        r.fix = undefined;
        anyFixes = true;
      } else {
        console.log(chalk.red('Failed.'));
      }
    }
    
    printResult(r);
    allResults.push(r);
  });

  // ── Re-verify if fixes were applied ────────────────────────────────────────
  let finalPreprod = preprodResult;
  let finalPreview = previewResult;
  let finalProof = proofResult;
  
  if (anyFixes) {
    process.stdout.write(chalk.dim('  [-] Verifying fixes... '));
    const [revPre, revPrv, revPrf] = await Promise.all([
      checkIndexer('preprod'),
      checkIndexer('preview'),
      checkProofServer(),
    ]);
    finalPreprod = revPre;
    finalPreview = revPrv;
    finalProof = revPrf;
    console.log(chalk.green('Recovery complete.'));
  }

  // ── Network Details ────────────────────────────────────────────────────────
  section('Services');
  printResult(finalPreprod);
  printResult(finalPreview);
  printResult(finalProof);
  allResults.push(finalPreprod, finalPreview, finalProof);

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
