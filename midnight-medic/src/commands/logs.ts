import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { header, divider } from '../ui/output.js';
import { listRunningContainers, findProofServerContainer } from '../checks/docker.js';

// ── Known Midnight Proof Server error patterns ─────────────────────────────
interface LogPattern {
  regex: RegExp;
  label: string;
  explanation: string;
  fix?: string;
  severity: 'error' | 'warn' | 'info';
}

const LOG_PATTERNS: LogPattern[] = [
  {
    regex: /public transcript input mismatch/i,
    label: 'Public Transcript Mismatch',
    explanation:
      'The data passed to the proof server does not match what the circuit expects. This usually means a private input was changed after the circuit was compiled.',
    fix: 'Delete your managed/ folder and recompile: npx compactc',
    severity: 'error',
  },
  {
    regex: /constraint.*fail|failed.*constraint/i,
    label: 'Circuit Constraint Failure',
    explanation:
      'A mathematical constraint in your ZK circuit was violated. Common causes: arithmetic overflow, value out of bounds, or missing .disclose().',
    fix: 'Run: midnight-medic lint ./contract/src to find potential issues',
    severity: 'error',
  },
  {
    regex: /cannot prove|proof generation failed|prover error/i,
    label: 'Proof Generation Failed',
    explanation:
      'The prover could not generate a valid proof. This usually results from invalid witness values.',
    fix: 'Check your witness functions return values that satisfy all circuit constraints',
    severity: 'error',
  },
  {
    regex: /key not found|zkir not found|missing.*artifact/i,
    label: 'Missing ZK Artifacts',
    explanation:
      'The proof server cannot find the prover key or ZKIR file for your contract.',
    fix: 'Recompile your contracts and ensure managed/ dir is populated',
    severity: 'error',
  },
  {
    regex: /timeout|timed out|request took too long/i,
    label: 'Proof Server Timeout',
    explanation:
      'Proof generation took too long. This can happen if ZK parameters are not fully downloaded yet.',
    fix: 'Wait a few minutes for ZK params to download, then retry',
    severity: 'warn',
  },
  {
    regex: /memory|oom|out of memory/i,
    label: 'Out of Memory',
    explanation: 'The proof server ran out of memory during proof generation.',
    fix: 'Increase Docker memory allocation in Docker Desktop settings (recommended: 8GB+)',
    severity: 'error',
  },
  {
    regex: /downloading.*key|fetching.*param|initializing prover/i,
    label: 'ZK Parameters Loading',
    explanation: 'Proof server is downloading ZK proving keys. This is normal on first startup.',
    severity: 'info',
  },
  {
    regex: /listening on|server started|proof server ready/i,
    label: 'Proof Server Ready',
    explanation: 'Proof server is up and accepting requests.',
    severity: 'info',
  },
];

function formatErrorBox(pattern: LogPattern, rawLine: string): void {
  if (pattern.severity === 'error') {
    console.log('');
    console.log(chalk.bgRed.white.bold('  !! ZK ERROR DETECTED !!  '));
    console.log(chalk.red(`  ${pattern.label}`));
    console.log(chalk.dim(`  ${pattern.explanation}`));
    if (pattern.fix) {
      console.log(chalk.dim(`  --> ${pattern.fix}`));
    }
    console.log(chalk.gray(`  Raw: ${rawLine.trim().slice(0, 120)}`));
    console.log('');
  } else if (pattern.severity === 'warn') {
    console.log('');
    console.log(chalk.yellow(`  [!] ${pattern.label}: ${pattern.explanation}`));
    if (pattern.fix) {
      console.log(chalk.dim(`      --> ${pattern.fix}`));
    }
    console.log('');
  } else {
    console.log(chalk.dim(`  [-] ${pattern.label}`));
  }
}

function processLogLine(line: string): void {
  // Match against all known patterns
  for (const pattern of LOG_PATTERNS) {
    if (pattern.regex.test(line)) {
      formatErrorBox(pattern, line);
      return;
    }
  }

  // Default formatting: dim gray for regular lines
  console.log(chalk.dim(`  ${line.trim()}`));
}

/** Find the most likely proof server container name from running containers. */

export function runLogs(containerName?: string): void {
  header('Midnight Logs — streaming proof server output...');

  // Auto-detect container if not specified
  const target = containerName ?? findProofServerContainer();

  if (!target) {
    console.log(chalk.yellow('  [!] No proof server container detected.'));
    console.log(chalk.dim('  Start it first with: npm run preprod-ps'));
    console.log(chalk.dim('  Or specify manually: midnight-medic logs <container-name>'));
    console.log('');
    return;
  }

  console.log(`  ${chalk.dim('Container:')} ${chalk.cyan(target)}`);
  console.log(`  ${chalk.dim('Press Ctrl+C to stop following.')}`);
  divider();

  const proc = spawn('docker', ['logs', '-f', '--tail', '50', target], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Stream stdout
  let stdoutBuffer = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) processLogLine(line);
    }
  });

  // Stream stderr (Docker logs can send to stderr)
  let stderrBuffer = '';
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) processLogLine(line);
    }
  });

  proc.on('error', (err) => {
    console.log(chalk.red(`  [x] Failed to attach to Docker: ${err.message}`));
    console.log(chalk.dim('  Make sure Docker is running and the container name is correct.'));
  });

  proc.on('close', (code) => {
    console.log('');
    divider();
    if (code === 0 || code === null) {
      console.log(chalk.dim('  Log stream ended.'));
    } else {
      console.log(chalk.red(`  [x] Docker exited with code ${code}.`));
      console.log(chalk.dim(`  Container '${target}' may have stopped.`));
    }
    console.log('');
  });

  // Handle graceful Ctrl+C
  process.on('SIGINT', () => {
    proc.kill('SIGTERM');
    console.log('');
    console.log(chalk.dim('  Stopped.'));
    process.exit(0);
  });
}
