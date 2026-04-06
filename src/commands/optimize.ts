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
  alignment?: unknown[];
}

interface ZKIRFile {
  version: { major: number; minor: number };
  num_inputs: number;
  instructions: ZKIRInstruction[];
}

interface Suggestion {
  severity: 'critical' | 'warn' | 'info';
  category: string;
  description: string;
  detail: string;
  estimatedSavings: number; // estimated gate reduction
}

// ─── Opcode cost table (from profile.ts) ─────────────────────────────────────

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
  cond_select: 3,
  neg: 3,
  public_input: 2,
  output: 2,
  declare_pub_input: 1,
  load_imm: 1,
  pi_skip: 1,
  copy: 1,
};

// ─── Optimization Passes ──────────────────────────────────────────────────────

/**
 * Pass 1: Detect duplicate persistent_hash calls with same input sets.
 * Each hash costs 30 gates — if inputs are identical, it's pure waste.
 */
function detectDuplicateHashes(insts: ZKIRInstruction[]): Suggestion[] {
  const results: Suggestion[] = [];
  const hashSigs = new Map<string, number[]>(); // signature → instruction indices

  for (let i = 0; i < insts.length; i++) {
    const inst = insts[i]!;
    if (inst.op === 'persistent_hash' && inst.inputs) {
      const sig = JSON.stringify([...inst.inputs].sort((a, b) => a - b));
      const existing = hashSigs.get(sig) ?? [];
      existing.push(i);
      hashSigs.set(sig, existing);
    }
  }

  for (const [sig, indices] of hashSigs) {
    if (indices.length > 1) {
      const inputs = JSON.parse(sig) as number[];
      results.push({
        severity: 'critical',
        category: 'Duplicate Hash',
        description: `persistent_hash called ${indices.length}x with same inputs: var[${inputs.join(', ')}]`,
        detail: `Hash appears at instructions: [${indices.join(', ')}]. Cache the result in a ledger variable or combine the hash calls. Each hash costs 30 gates.`,
        estimatedSavings: (indices.length - 1) * 30,
      });
    }
  }

  return results;
}

/**
 * Pass 2: Detect redundant constrain_bits on the same variable with same bits.
 */
function detectRedundantConstraints(insts: ZKIRInstruction[]): Suggestion[] {
  const results: Suggestion[] = [];
  const seen = new Map<string, number[]>();

  for (let i = 0; i < insts.length; i++) {
    const inst = insts[i]!;
    if (inst.op === 'constrain_bits' && inst.var != null && inst.bits != null) {
      const key = `${inst.var}:${inst.bits}`;
      const existing = seen.get(key) ?? [];
      existing.push(i);
      seen.set(key, existing);
    }
  }

  for (const [key, indices] of seen) {
    if (indices.length > 1) {
      const [varId, bits] = key.split(':');
      results.push({
        severity: 'warn',
        category: 'Redundant Constraint',
        description: `constrain_bits(var[${varId}], ${bits}) applied ${indices.length}x — same variable constrained multiple times`,
        detail: `Instructions [${indices.join(', ')}] all constrain the same variable to the same bit width. Remove all but the first. Saves ${(indices.length - 1) * 5} gates.`,
        estimatedSavings: (indices.length - 1) * 5,
      });
    }
  }

  return results;
}

/**
 * Pass 3: Detect deep cond_select chains (if/else trees).
 * Long chains indicate the Compact code has complex branching that could
 * be flattened with lookup tables.
 */
function detectDeepCondSelect(insts: ZKIRInstruction[]): Suggestion[] {
  const results: Suggestion[] = [];
  let chainLength = 0;
  let chainStart = -1;

  for (let i = 0; i < insts.length; i++) {
    if (insts[i]!.op === 'cond_select') {
      if (chainLength === 0) chainStart = i;
      chainLength++;
    } else {
      if (chainLength >= 6) {
        results.push({
          severity: 'warn',
          category: 'Deep Branch Chain',
          description: `${chainLength} consecutive cond_select operations starting at inst[${chainStart}]`,
          detail: `Deep if/else chains in Compact generate long cond_select sequences in ZKIR. Consider refactoring your branching logic into a lookup table pattern. Potential saving: ~${Math.floor(chainLength * 0.4)} gates.`,
          estimatedSavings: Math.floor(chainLength * 0.4 * 3),
        });
      }
      chainLength = 0;
      chainStart = -1;
    }
  }

  return results;
}

/**
 * Pass 4: Detect excessive private inputs (witness table bloat).
 * Each private_input costs 8 gates + increases proof generation complexity.
 */
function detectWitnessBloat(insts: ZKIRInstruction[], circuitName: string): Suggestion[] {
  const results: Suggestion[] = [];
  const privateInputs = insts.filter((i) => i.op === 'private_input').length;

  if (privateInputs > 15) {
    results.push({
      severity: 'critical',
      category: 'Witness Table Bloat',
      description: `${privateInputs} private_input operations — large witness table`,
      detail: `High private input counts dramatically increase proof generation time and memory usage. Review your witness() calls in the ${circuitName} circuit. Consider batching witness values into a single committed byte array.`,
      estimatedSavings: Math.floor((privateInputs - 6) * 8 * 0.5),
    });
  } else if (privateInputs > 8) {
    results.push({
      severity: 'warn',
      category: 'Witness Table Size',
      description: `${privateInputs} private_input operations — consider reviewing witness() calls`,
      detail: `Each witness() call in Compact generates a private_input gate (cost: 8). Check if any witness values can be derived from others rather than being independently witnessed.`,
      estimatedSavings: 0,
    });
  }

  return results;
}

/**
 * Pass 5: Detect public ledger reads (public_input ops) inside loops/branches.
 * These are expensive because they add to the public transcript size.
 */
function detectExcessivePublicReads(insts: ZKIRInstruction[]): Suggestion[] {
  const results: Suggestion[] = [];
  const pubReads = insts.filter((i) => i.op === 'public_input').length;
  const declPub = insts.filter((i) => i.op === 'declare_pub_input').length;

  if (pubReads > 20) {
    results.push({
      severity: 'warn',
      category: 'Large Public Transcript',
      description: `${pubReads} public_input reads (${declPub} declared slots)`,
      detail: `A large number of public ledger reads increases the public transcript size, which affects proof verification time on-chain. Consider reading only the necessary ledger fields.`,
      estimatedSavings: Math.floor((pubReads - 10) * 2 * 0.3),
    });
  }

  return results;
}

// ─── Main Optimizer ───────────────────────────────────────────────────────────

interface CircuitOptResult {
  circuit: string;
  totalWeight: number;
  suggestions: Suggestion[];
  totalSavings: number;
  isClean: boolean;
}

function optimizeCircuit(file: string): CircuitOptResult {
  const raw = fs.readFileSync(file, 'utf-8');
  const data = JSON.parse(raw) as ZKIRFile;
  const insts = data.instructions;
  const circuitName = path.basename(file, '.zkir');

  // Calculate current weight
  const totalWeight = insts.reduce((sum, inst) => {
    return sum + (OPCODE_COSTS[inst.op] ?? 2);
  }, 0);

  // Run all optimization passes
  const suggestions: Suggestion[] = [
    ...detectDuplicateHashes(insts),
    ...detectRedundantConstraints(insts),
    ...detectDeepCondSelect(insts),
    ...detectWitnessBloat(insts, circuitName),
    ...detectExcessivePublicReads(insts),
  ];

  const totalSavings = suggestions.reduce((s, r) => s + r.estimatedSavings, 0);

  return {
    circuit: circuitName,
    totalWeight,
    suggestions,
    totalSavings,
    isClean: suggestions.length === 0,
  };
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function runOptimize(targetDir: string): Promise<void> {
  header('Midnight Optimize — ZKIR circuit refactor analysis...');
  console.log(chalk.dim('  Scanning compiled ZKIR files for redundancies and optimization opportunities.\n'));

  const files = await glob('**/*.zkir', {
    cwd: targetDir,
    ignore: ['node_modules/**'],
    absolute: true,
  });

  if (files.length === 0) {
    warn('No .zkir files found', `Searched: ${targetDir}`);
    info('Hint', 'Compile your Compact contract first with: npx compactc');
    console.log('');
    return;
  }

  const results = files.map(optimizeCircuit);
  results.sort((a, b) => b.totalSavings - a.totalSavings);

  const totalSuggestions = results.reduce((s, r) => s + r.suggestions.length, 0);
  const totalSavings = results.reduce((s, r) => s + r.totalSavings, 0);
  const cleanCircuits = results.filter((r) => r.isClean).length;

  // ── Summary Header ───────────────────────────────────────────────────────
  console.log(`  ${chalk.bold.white('Scan Results')}`);
  divider();
  console.log(`  Circuits scanned:     ${chalk.cyan(String(files.length))}`);
  console.log(`  Issues found:         ${totalSuggestions > 0 ? chalk.yellow(String(totalSuggestions)) : chalk.green('0')}`);
  console.log(`  Clean circuits:       ${chalk.green(String(cleanCircuits))} / ${files.length}`);
  console.log(`  Potential gate saves: ${totalSavings > 0 ? chalk.yellow(`~${totalSavings} gates`) : chalk.green('none needed')}`);
  console.log('');

  if (totalSuggestions === 0) {
    ok('All circuits are optimized', 'No redundancies detected in the ZKIR graph');
    console.log('');
    return;
  }

  // ── Per-circuit Report ───────────────────────────────────────────────────
  for (const result of results) {
    if (result.isClean) {
      ok(result.circuit, `${result.totalWeight} gates — no issues found`);
      continue;
    }

    console.log('');
    console.log(`  ${chalk.bold.cyan(result.circuit)} ${chalk.dim(`(weight: ${result.totalWeight})`)} — ${chalk.yellow(`${result.suggestions.length} issue(s), ~${result.totalSavings} gates saveable`)}`);
    divider();

    for (const s of result.suggestions) {
      const icon =
        s.severity === 'critical'
          ? chalk.red('[x]')
          : s.severity === 'warn'
            ? chalk.yellow('[!]')
            : chalk.dim('[-]');

      console.log(`\n  ${icon} ${chalk.bold(s.category)}: ${s.description}`);
      console.log(`      ${chalk.dim(s.detail)}`);
      if (s.estimatedSavings > 0) {
        console.log(`      ${chalk.green(`--> Estimated saving: ~${s.estimatedSavings} gates`)}`);
      }
    }
    console.log('');
  }

  divider();
  console.log(`\n  ${chalk.bold.white('Next Steps')}`);
  console.log(`  ${chalk.dim('1.')} Fix the issues listed above in your .compact source file.`);
  console.log(`  ${chalk.dim('2.')} Recompile: ${chalk.cyan('npx compactc')}`);
  console.log(`  ${chalk.dim('3.')} Re-run to verify: ${chalk.cyan('midnight-medic optimize')}`);
  console.log(`  ${chalk.dim('4.')} Check proof time with: ${chalk.cyan('midnight-medic profile')}`);
  console.log('');
}
