#!/usr/bin/env node
import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import { runSync } from './commands/sync.js';
import { runLint } from './commands/lint.js';
import { runInspect } from './commands/inspect.js';
import { runLogs } from './commands/logs.js';
import { runProfile } from './commands/profile.js';
import { runTrace } from './commands/trace.js';
import { runOptimize } from './commands/optimize.js';
import { runEstimate } from './commands/estimate.js';
import { runMatrix } from './commands/matrix.js';
import { runFuzz } from './commands/fuzz.js';
import { diagnosticPulse } from './ui/output.js';

import chalk from 'chalk';

const program = new Command();

program
  .name('midnight-medic')
  .description('Diagnostic, sync, lint, inspect, and log toolkit for Midnight Network developers.')
  .version('0.1.0');

// ── doctor ───────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Check and fix your local development environment for Midnight.')
  .option('--export', 'Copy the diagnostic report to your clipboard.')
  .option('--fix', 'Automatically attempt to resolve common environment issues.')
  .option('--cwd <path>', 'Project directory to scan for .env and config (default: current directory)', process.cwd())
  .action(async (options: { export: boolean; cwd: string; fix: boolean }) => {
    await diagnosticPulse('Scanning Midnight environment...');
    await runDoctor({ export: options.export, cwd: options.cwd, fix: options.fix });
  });

// ── sync ─────────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Check SDK and Docker image version compatibility against the Midnight matrix.')
  .option('--fix', 'Automatically update docker-compose YAML files to compatible versions.')
  .option('--cwd <path>', 'Working directory to scan (default: current directory)', process.cwd())
  .action(async (options: { fix: boolean; cwd: string }) => {
    await runSync({ fix: options.fix ?? false, cwd: options.cwd });
  });

// ── lint ─────────────────────────────────────────────────────────────────────
program
  .command('lint [path]')
  .description('Statically analyze .compact files for common errors and anti-patterns.')
  .action(async (targetPath: string | undefined) => {
    const dir = targetPath ?? process.cwd();
    await diagnosticPulse('Auditing Compact source code...');
    await runLint(dir);
  });

// ── inspect ──────────────────────────────────────────────────────────────────
program
  .command('inspect')
  .description('Decrypt and display the local private state for your Midnight contract.')
  .option('--db <path>', 'Path to the LevelDB directory (auto-detected if not specified).')
  .option('--cwd <path>', 'Working directory to search for .env and db/ (default: current directory)', process.cwd())
  .option('--live', 'Show a high-fidelity trace of the private state (Live Diagnostic Mode).')
  .action(async (options: { db?: string; cwd: string; live: boolean }) => {
    await diagnosticPulse('Decrypting Secure Vault state...');
    await runInspect({ cwd: options.cwd, db: options.db, live: options.live });
  });

// ── logs ─────────────────────────────────────────────────────────────────────
program
  .command('logs [container]')
  .description('Stream and decode proof server Docker logs with color-coded ZK error highlighting.')
  .action((container: string | undefined) => {
    runLogs(container);
  });

// ── profile ──────────────────────────────────────────────────────────────────
program
  .command('profile [path]')
  .description('Analyze compiled ZKIR files to profile circuit complexity, gate costs, and proof times.')
  .option('--json', 'Output raw JSON instead of the visual flamegraph.')
  .action(async (targetPath: string | undefined, options: { json: boolean }) => {
    const dir = targetPath ?? process.cwd();
    await diagnosticPulse('Profiling ZKIR gate complexity...');
    await runProfile(dir, { json: options.json ?? false });
  });

// ── trace ──────────────────────────────────────────────────────────────────
program
  .command('trace')
  .description('Live ZK proof failure monitor with circuit-level ZKIR trace and source hints.')
  .option('--circuit <name>', 'Post-mortem: analyze a specific circuit ZKIR without live Docker.')
  .option('--container <name>', 'Specify the proof server Docker container name manually.')
  .option('--cwd <path>', 'Working directory to search for ZKIR and .compact files.', process.cwd())
  .action(async (options: { circuit?: string; container?: string; cwd: string }) => {
    await diagnosticPulse('Initializing X-ray Decompiler...');
    await runTrace({ circuit: options.circuit, container: options.container, cwd: options.cwd });
  });

// ── optimize ─────────────────────────────────────────────────────────────────
program
  .command('optimize [path]')
  .description('Scan ZKIR circuits for redundancies: duplicate hashes, redundant constraints, witness bloat.')
  .action(async (targetPath: string | undefined) => {
    const dir = targetPath ?? process.cwd();
    await runOptimize(dir);
  });

// ── estimate ─────────────────────────────────────────────────────────────────
program
  .command('estimate [circuit]')
  .description('Pre-flight DUST cost estimate using ZKIR gate weights and Midnight fee model.')
  .option('--cwd <path>', 'Working directory to search for ZKIR files.', process.cwd())
  .action(async (circuit: string | undefined, options: { cwd: string }) => {
    await diagnosticPulse('Calculating DUST fee estimates...');
    await runEstimate(circuit, options.cwd);
  });

// ── matrix ───────────────────────────────────────────────────────────────────
program
  .command('matrix')
  .description('Generate a Privacy Visibility Matrix showing Public vs Private state access.')
  .option('--cwd <path>', 'Working directory to scan.', process.cwd())
  .action(async (options: { cwd: string }) => {
    await diagnosticPulse('Mapping Privacy Access Matrix...');
    await runMatrix(options.cwd);
  });

// ── fuzz ─────────────────────────────────────────────────────────────────────
program
  .command('fuzz <circuit>')
  .description('Property-based testing for circuits: blast with random data to find crashes.')
  .option('--cwd <path>', 'Working directory to scan.', process.cwd())
  .action(async (circuit: string, options: { cwd: string }) => {
    await diagnosticPulse(`Fuzzing ${circuit} with random witnesses...`);
    await runFuzz(circuit, options.cwd);
  });

// ── Default: show banner ──────────────────────────────────────────────────────
if (process.argv.length === 2) {
  console.log('');
  console.log(chalk.bold.white('  midnight-medic'));
  console.log(chalk.dim('  Environment diagnostics for Midnight Network developers.'));
  console.log('');
  console.log(`  ${chalk.cyan('midnight-medic doctor')}              Environment scan (Docker, ports, network, wallet)`);
  console.log(`  ${chalk.cyan('midnight-medic doctor --export')}     Copy report to clipboard for Discord`);
  console.log(`  ${chalk.cyan('midnight-medic sync')}                Check SDK/Docker version compatibility`);
  console.log(`  ${chalk.cyan('midnight-medic sync --fix')}          Auto-fix version mismatches`);
  console.log(`  ${chalk.cyan('midnight-medic lint [path]')}         Lint .compact files for anti-patterns`);
  console.log(`  ${chalk.cyan('midnight-medic inspect')}             Decrypt and view local private state`);
  console.log(`  ${chalk.cyan('midnight-medic inspect --db <dir>')}  Inspect a specific LevelDB directory`);
  console.log(`  ${chalk.cyan('midnight-medic logs [container]')}    Stream proof server logs (color-coded)`);
  console.log(`  ${chalk.cyan('midnight-medic profile [path]')}                Analyze ZKIR circuits: flamegraph + proof time`);
  console.log(`  ${chalk.cyan('midnight-medic profile --json')}                Output raw profile data as JSON`);
  console.log(`  ${chalk.cyan('midnight-medic trace')}                         Live proof failure monitor + ZKIR trace`);
  console.log(`  ${chalk.cyan('midnight-medic trace --circuit <name>')}        Post-mortem: deep-analyze a specific circuit`);
  console.log(`  ${chalk.cyan('midnight-medic optimize [path]')}               Detect duplicate hashes, redundant constraints`);
  console.log(`  ${chalk.cyan('midnight-medic estimate [circuit]')}            Pre-flight DUST cost calculator`);
  console.log('');

  process.exit(0);
}

program.parse();
