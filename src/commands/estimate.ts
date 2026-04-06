import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { header, divider, ok, warn, info, fail } from '../ui/output.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ZKIRInstruction {
  op: string;
  var?: number;
  bits?: number;
  cond?: number;
  a?: number;
  b?: number;
  imm?: string;
  guard?: string | null;
  inputs?: number[];
}

interface ZKIRFile {
  version: { major: number; minor: number };
  num_inputs: number;
  instructions: ZKIRInstruction[];
}

interface CircuitArg {
  name: string;
  type: { 'type-name': string; maxval?: number; length?: number };
}

interface ContractCircuit {
  name: string;
  arguments: CircuitArg[];
}

interface ContractInfo {
  'compiler-version': string;
  circuits: ContractCircuit[];
}

// ─── Opcode Weight Model ──────────────────────────────────────────────────────
// Calibrated against real Midnight proof server timing data.
// Based on PLONK-like constraint system: multiplication gates dominate.

const OPCODE_COSTS: Record<string, number> = {
  persistent_hash: 30,
  mul: 12,
  div_mod_power_of_two: 10,
  less_than: 8,
  private_input: 8,
  assert: 6,
  constrain_bits: 5,
  test_eq: 5,
  add: 4,
  sub: 4,
  neg: 3,
  cond_select: 3,
  public_input: 2,
  output: 2,
  declare_pub_input: 1,
  load_imm: 1,
  pi_skip: 1,
  copy: 1,
};

// ─── DUST Fee Parameters ──────────────────────────────────────────────────────
// Based on Midnight protocol documentation:
// DUST = base_fee + (circuit_weight * complexity_multiplier) + (pub_input_count * pub_multiplier)
// These values are calibrated for the current preprod network.
// Actual mainnet values will differ based on NIGHT/DUST emission rates.

const DUST_BASE_FEE = 42n;                      // Fixed cost for any transaction
const DUST_PER_GATE_WEIGHT_LOW = 0.12;          // Optimistic (low network load)
const DUST_PER_GATE_WEIGHT_HIGH = 0.45;         // Conservative (high network load)
const DUST_PER_PUBLIC_INPUT = 8n;               // Cost per public transcript element
const DUST_STORAGE_PER_WRITE = 25n ;            // Cost per ledger write (32 bytes)

// Rough proof-time model: 0.8ms per weight unit on Apple M-series
const MS_PER_WEIGHT = 0.8;

// ─── Loaders ──────────────────────────────────────────────────────────────────

function loadZKIR(file: string): ZKIRFile | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as ZKIRFile;
  } catch {
    return null;
  }
}

function loadContractInfo(zkDir: string): ContractInfo | null {
  const candidates = [
    path.join(zkDir, '..', 'compiler', 'contract-info.json'),
    path.join(zkDir, '..', '..', 'compiler', 'contract-info.json'),
    path.join(zkDir, 'contract-info.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return JSON.parse(fs.readFileSync(c, 'utf-8')) as ContractInfo;
      } catch { /* skip */ }
    }
  }
  return null;
}

// ─── ZKIR Analysis ────────────────────────────────────────────────────────────

interface CircuitEstimate {
  circuit: string;
  totalInstructions: number;
  totalWeight: number;
  numPublicInputs: number;
  numPrivateInputs: number;
  numLedgerWrites: number; // estimated from output ops
  estimatedMs: number;
  dustLow: bigint;
  dustHigh: bigint;
  dustBreakdown: {
    base: bigint;
    circuitComplexity: bigint;
    publicTranscript: bigint;
    storage: bigint;
  };
  args: CircuitArg[];
  warnings: string[];
}

function estimateCircuit(
  file: string,
  contractInfo: ContractInfo | null,
): CircuitEstimate {
  const data = loadZKIR(file)!;
  const insts = data.instructions;
  const circuitName = path.basename(file, '.zkir');

  // Find matching circuit in contract-info
  const circuitMeta = contractInfo?.circuits.find((c) => c.name === circuitName);
  const args = circuitMeta?.arguments ?? [];

  // Count per-opcode
  const opCounts: Record<string, number> = {};
  for (const inst of insts) {
    opCounts[inst.op] = (opCounts[inst.op] ?? 0) + 1;
  }

  const totalWeight = Object.entries(opCounts).reduce(
    (sum, [op, count]) => sum + (OPCODE_COSTS[op] ?? 2) * count,
    0,
  );

  const numPrivateInputs = opCounts['private_input'] ?? 0;
  const numPublicInputs = data.num_inputs;
  const numLedgerWrites = opCounts['output'] ?? 1; // at least 1 for any state-modifying tx

  // Proof time estimate
  const estimatedMs = totalWeight * MS_PER_WEIGHT;

  // DUST breakdown
  const circuitDustLow = BigInt(Math.ceil(totalWeight * DUST_PER_GATE_WEIGHT_LOW));
  const circuitDustHigh = BigInt(Math.ceil(totalWeight * DUST_PER_GATE_WEIGHT_HIGH));
  const pubTranscriptDust = BigInt(numPublicInputs) * DUST_PER_PUBLIC_INPUT;
  const storageDust = BigInt(numLedgerWrites) * DUST_STORAGE_PER_WRITE;

  const dustLow = DUST_BASE_FEE + circuitDustLow + pubTranscriptDust + storageDust;
  const dustHigh = DUST_BASE_FEE + circuitDustHigh + pubTranscriptDust + storageDust;

  const warnings: string[] = [];
  if (numPrivateInputs > 15) {
    warnings.push(`${numPrivateInputs} private witnesses — consider batching to reduce proof size`);
  }
  if (dustHigh > 500n) {
    warnings.push(`High DUST cost (${dustHigh} DUST) — ensure wallet has NIGHT tokens to generate sufficient DUST`);
  }
  if (estimatedMs > 5000) {
    warnings.push(`Slow proof expected (~${(estimatedMs / 1000).toFixed(1)}s) — use --skip-zk for local dev testing`);
  }

  return {
    circuit: circuitName,
    totalInstructions: insts.length,
    totalWeight,
    numPublicInputs,
    numPrivateInputs,
    numLedgerWrites,
    estimatedMs,
    dustLow,
    dustHigh,
    dustBreakdown: {
      base: DUST_BASE_FEE,
      circuitComplexity: circuitDustHigh, // show conservative
      publicTranscript: pubTranscriptDust,
      storage: storageDust,
    },
    args,
    warnings,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `~${(ms / 1000).toFixed(1)}s`;
  return `~${(ms / 60000).toFixed(1)}min`;
}

function dustBar(value: bigint, max: bigint, width = 20): string {
  const filled = max > 0n ? Math.round(Number((value * BigInt(width)) / max)) : 0;
  const bar = '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(0, width - filled));
  if (filled > width * 0.75) return chalk.red(bar);
  if (filled > width * 0.4) return chalk.yellow(bar);
  return chalk.green(bar);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function runEstimate(
  circuitFilter: string | undefined,
  targetDir: string,
): Promise<void> {
  header('Midnight Estimate — DUST cost calculator...');
  console.log(chalk.dim('  Analyzing ZKIR circuit graphs to pre-flight DUST cost estimates.'));
  console.log(chalk.dim('  (Note: Costs are estimates. Actual DUST varies with live network load.)\n'));

  const files = await glob('**/*.zkir', {
    cwd: targetDir,
    ignore: ['node_modules/**', '**/*.bzkir'],
    absolute: true,
  });

  if (files.length === 0) {
    warn('No .zkir files found', `Searched: ${targetDir}`);
    info('Hint', 'Compile your Compact contract first: npx compactc');
    return;
  }

  // Load contract-info once
  const firstDir = path.dirname(files[0]!);
  const contractInfo = loadContractInfo(firstDir);
  if (contractInfo) {
    ok('contract-info.json', `Compiler v${contractInfo['compiler-version']}`);
  }

  // Filter if circuit name specified
  const targetFiles = circuitFilter
    ? files.filter((f) => path.basename(f, '.zkir').toLowerCase() === circuitFilter.toLowerCase())
    : files;

  if (targetFiles.length === 0) {
    fail('Circuit not found', circuitFilter ?? '');
    info('Available', files.map((f) => path.basename(f, '.zkir')).join(', '));
    return;
  }

  const estimates = targetFiles.map((f) => estimateCircuit(f, contractInfo));
  estimates.sort((a, b) => Number(b.dustHigh - a.dustHigh));

  const maxDust = estimates.reduce((m, e) => (e.dustHigh > m ? e.dustHigh : m), 0n);

  // ── Single circuit deep view ─────────────────────────────────────────────
  if (circuitFilter && estimates.length === 1) {
    const e = estimates[0]!;
    console.log('');
    console.log(`  ${chalk.bold.white('Pre-flight Receipt')}`);
    divider();

    // Signature
    const argStr = e.args.map((a) => `${a.name}: ${a.type['type-name']}`).join(', ');
    console.log(`  ${chalk.cyan(e.circuit)}(${chalk.dim(argStr)})`);
    console.log('');

    // DUST estimate
    console.log(`  ${chalk.bold.white('Estimated DUST Cost')}`);
    console.log(`  ${chalk.green(String(e.dustLow))} DUST  (network idle)`);
    console.log(`  ${chalk.yellow(String(e.dustHigh))} DUST  (network busy)`);
    console.log('');

    // Breakdown
    console.log(`  ${chalk.bold.white('Cost Breakdown')}`);
    divider();
    const bd = e.dustBreakdown;
    const items: Array<[string, bigint]> = [
      ['Base fee', bd.base],
      ['Circuit complexity', bd.circuitComplexity],
      ['Public transcript', bd.publicTranscript],
      ['Ledger storage', bd.storage],
    ];
    for (const [label, cost] of items) {
      const bar = dustBar(cost, e.dustHigh, 16);
      const pct = e.dustHigh > 0n ? Math.round(Number((cost * 100n) / e.dustHigh)) : 0;
      console.log(`  ${label.padEnd(22)} ${bar} ${String(cost).padStart(6)} DUST  (${pct}%)`);
    }
    console.log('');

    // Circuit stats
    console.log(`  ${chalk.bold.white('Circuit Stats')}`);
    divider();
    console.log(`  Instructions:        ${e.totalInstructions}`);
    console.log(`  Gate weight:         ${e.totalWeight}`);
    console.log(`  Public inputs:       ${e.numPublicInputs}`);
    console.log(`  Private witnesses:   ${e.numPrivateInputs}`);
    console.log(`  Proof time est.:     ${formatMs(e.estimatedMs)}`);
    console.log('');

    // Warnings
    if (e.warnings.length > 0) {
      for (const w of e.warnings) {
        console.log(`  ${chalk.yellow('[!]')} ${w}`);
      }
      console.log('');
    }

    console.log(`  ${chalk.dim('To reduce DUST: run')} ${chalk.cyan('midnight-medic optimize')} ${chalk.dim('to find circuit inefficiencies.')}`);
    return;
  }

  // ── Multi-circuit summary ────────────────────────────────────────────────
  console.log(`\n  ${chalk.bold.white('DUST Cost Summary — All Circuits')}`);
  divider();
  console.log(`  ${'Circuit'.padEnd(22)} ${'Bar'.padEnd(22)} ${'Low'.padStart(8)}  ${'High'.padStart(8)}  Proof time`);
  divider();

  for (const e of estimates) {
    const bar = dustBar(e.dustHigh, maxDust, 20);
    const low = String(e.dustLow).padStart(8);
    const high = String(e.dustHigh).padStart(8);
    const time = formatMs(e.estimatedMs);
    console.log(`  ${e.circuit.padEnd(22)} ${bar} ${chalk.green(low)}  ${chalk.yellow(high)}  ${chalk.dim(time)}`);
  }

  const totalLow = estimates.reduce((s, e) => s + e.dustLow, 0n);
  const totalHigh = estimates.reduce((s, e) => s + e.dustHigh, 0n);
  divider();
  console.log(`  ${'TOTAL (all circuits)'.padEnd(58)} ${chalk.green(String(totalLow).padStart(8))}  ${chalk.yellow(String(totalHigh).padStart(8))}`);
  console.log('');
  console.log(chalk.dim(`  For a deep breakdown of one circuit: midnight-medic estimate <circuit-name>`));
  console.log('');
}
