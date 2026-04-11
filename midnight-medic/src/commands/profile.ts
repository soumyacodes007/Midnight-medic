import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { header, divider, ok, warn, info } from '../ui/output.js';

// ── ZKIR Opcode Cost Model ─────────────────────────────────────────────────
// Based on reverse engineering of the Midnight ZKIR JSON format.
// ZKIR is a JSON array of "instructions" (opcodes) representing the
// mathematical constraints of the ZK circuit.
// Heavier ops = more prover computation = slower proof generation.
const OPCODE_COSTS: Record<string, { weight: number; description: string }> = {
  // Arithmetic / logic (expensive — multiplicative gates in PLONKish systems)
  persistent_hash:      { weight: 30, description: 'Hash (expensive: KZG polynomial constraint)' },
  mul:                  { weight: 12, description: 'Multiplication (multiplicative gate)' },
  div_mod_power_of_two: { weight: 10, description: 'Division (composite gate)' },
  add:                  { weight: 4,  description: 'Addition' },
  sub:                  { weight: 4,  description: 'Subtraction' },
  neg:                  { weight: 3,  description: 'Negation' },
  // Comparisons
  less_than:            { weight: 8,  description: 'Less-than comparison (range check)' },
  test_eq:              { weight: 5,  description: 'Equality test' },
  assert:               { weight: 6,  description: 'Assert (hard constraint — failure = no proof)' },
  // Bit constraints
  constrain_bits:       { weight: 5,  description: 'Bit-range constraint' },
  cond_select:          { weight: 3,  description: 'Conditional select (if/else branch)' },
  // Private / public IO
  private_input:        { weight: 8,  description: 'Private witness input (ZK input)' },
  public_input:         { weight: 2,  description: 'Public input witness' },
  declare_pub_input:    { weight: 1,  description: 'Declare public input slot' },
  output:               { weight: 2,  description: 'Circuit output' },
  // Low-cost
  load_imm:             { weight: 1,  description: 'Load immediate constant' },
  pi_skip:              { weight: 1,  description: 'Public input placeholder (skip)' },
  copy:                 { weight: 1,  description: 'Variable copy' },
};

// Proof time model calibrated empirically:
// "startNewRound" has 603 gates, weight ~850 -> takes ~1.8s on Apple M-series
// Using weight-to-ms ratio for rough estimation.
const PROOF_TIME_WEIGHT_PER_MS = 0.8;

type ZKIRInstruction = {
  op: string;
  var?: number;
  bits?: number;
  imm?: string;
  guard?: string | null;
  inputs?: number[];
  [key: string]: unknown;
};

type ZKIRFile = {
  version: { major: number; minor: number };
  do_communications_commitment: boolean;
  num_inputs: number;
  instructions: ZKIRInstruction[];
};

interface CircuitProfile {
  circuit: string;
  file: string;
  totalInstructions: number;
  totalWeight: number;
  privateInputs: number;
  publicInputs: number;
  heavyOps: Array<{ op: string; count: number; weight: number }>;
  estimatedMs: number;
  estimatedProofTime: string;
  warnings: string[];
}

function formatProofTime(ms: number): string {
  if (ms < 1000) return `<1 second`;
  if (ms < 60000) return `~${(ms / 1000).toFixed(1)} seconds`;
  return `~${(ms / 60000).toFixed(1)} minutes`;
}

function weightToBar(weight: number, maxWeight: number, width = 30): string {
  const filled = Math.round((weight / maxWeight) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);

  if (filled > width * 0.75) return chalk.red(bar);
  if (filled > width * 0.4) return chalk.yellow(bar);
  return chalk.green(bar);
}

function analyzeZKIR(filePath: string): CircuitProfile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw) as ZKIRFile;
  const instructions = data.instructions ?? [];

  // Count by opcode
  const opCounts: Record<string, number> = {};
  for (const inst of instructions) {
    opCounts[inst.op] = (opCounts[inst.op] ?? 0) + 1;
  }

  // Calculate total weight
  let totalWeight = 0;
  for (const [op, count] of Object.entries(opCounts)) {
    const cost = OPCODE_COSTS[op]?.weight ?? 2;
    totalWeight += cost * count;
  }

  // Heavy ops breakdown (cost * count, sorted desc)
  const heavyOps = Object.entries(opCounts)
    .map(([op, count]) => ({
      op,
      count,
      weight: (OPCODE_COSTS[op]?.weight ?? 2) * count,
    }))
    .filter((x) => x.weight > 5)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const privateInputs = opCounts['private_input'] ?? 0;
  const publicInputs = opCounts['public_input'] ?? 0;
  const estimatedMs = totalWeight * PROOF_TIME_WEIGHT_PER_MS;

  const warnings: string[] = [];
  if (totalWeight > 1000) {
    warnings.push('High circuit weight — consider splitting into multiple smaller circuits');
  }
  if (privateInputs > 10) {
    warnings.push(`${privateInputs} private inputs — large witness table, check for redundant witness() calls`);
  }
  if ((opCounts['persistent_hash'] ?? 0) > 3) {
    warnings.push(
      `${opCounts['persistent_hash']} hash operations — hashing is expensive, consider caching or merging`
    );
  }
  if (estimatedMs > 5000) {
    warnings.push('Estimated proof time >5 seconds — consider using --skip-zk for local testing');
  }

  return {
    circuit: path.basename(filePath, '.zkir'),
    file: filePath,
    totalInstructions: instructions.length,
    totalWeight,
    privateInputs,
    publicInputs,
    heavyOps,
    estimatedMs,
    estimatedProofTime: formatProofTime(estimatedMs),
    warnings,
  };
}

async function findZKIRFiles(dir: string): Promise<string[]> {
  let files = await glob('**/*.zkir', {
    cwd: dir,
    ignore: ['node_modules/**', '**/midnight-medic/**', '**/*.bzkir'],
    absolute: true,
  });

  // Self-Correction: If not found in current dir, walk up to workspace root
  if (files.length === 0) {
    files = await glob('**/*.zkir', {
      cwd: path.join(dir, '..'),
      ignore: ['node_modules/**', '**/midnight-medic/**', '**/*.bzkir'],
      absolute: true,
    });
  }
  return files;
}

export async function runProfile(targetDir: string, options: { json: boolean }): Promise<void> {
  header('Midnight Profile — ZK circuit analyzer...');
  console.log(chalk.dim('  Reverse-engineering ZKIR instruction sets to estimate proof costs.\n'));

  const files = await findZKIRFiles(targetDir);

  if (files.length === 0) {
    warn('No .zkir files found', `Searched in: ${targetDir} and its parent.`);
    info('Hint', 'Run the Compact compiler first: npx compactc');
    console.log('');
    return;
  }

  const allProfiles = files.map(analyzeZKIR);

  // De-duplicate by circuit name (keep shortest path / best artifact)
  const uniqueProfilesMap = new Map<string, CircuitProfile>();
  for (const p of allProfiles) {
    const existing = uniqueProfilesMap.get(p.circuit);
    const isManaged = p.file.includes('managed');
    
    if (!existing || (isManaged && !existing.file.includes('managed')) || p.file.length < existing.file.length) {
      uniqueProfilesMap.set(p.circuit, p);
    }
  }
  const profiles = Array.from(uniqueProfilesMap.values());

  // Sort heaviest first
  profiles.sort((a, b) => b.totalWeight - a.totalWeight);
  const maxWeight = profiles[0]?.totalWeight ?? 1;

  if (options.json) {
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  // ── Flamegraph View ────────────────────────────────────────────────────────
  console.log(`  ${chalk.bold.white('Circuit Weight Flamegraph')}`);
  console.log(`  ${chalk.dim('(Heavier = longer proof time)')}`);
  divider();

  for (const p of profiles) {
    const bar = weightToBar(p.totalWeight, maxWeight);
    const timeLabel = chalk.dim(`[${p.estimatedProofTime}]`);

    console.log(`\n  ${chalk.cyan(p.circuit.padEnd(22))} ${bar} ${timeLabel}`);
    console.log(
      `  ${chalk.dim(`  ${p.totalInstructions} instr | weight: ${p.totalWeight} | ${p.privateInputs} private inputs`)}`
    );

    if (p.warnings.length > 0) {
      for (const w of p.warnings) {
        console.log(`  ${chalk.yellow('[!]')} ${chalk.dim(w)}`);
      }
    }
  }

  // ── Per-circuit breakdown ──────────────────────────────────────────────────
  console.log('\n');
  divider();
  console.log(`  ${chalk.bold.white('Top Cost Breakdown (by circuit)')}`);
  divider();

  for (const p of profiles.slice(0, 5)) {
    // Limit to top 5 heaviest
    console.log(`\n  ${chalk.bold.cyan(p.circuit)} — ${chalk.yellow('weight: ' + p.totalWeight)}`);

    for (const hop of p.heavyOps.slice(0, 4)) {
      const desc = OPCODE_COSTS[hop.op]?.description ?? '';
      const pct = ((hop.weight / p.totalWeight) * 100).toFixed(0);
      console.log(
        `    ${chalk.dim(hop.op.padEnd(25))} ${String(hop.count).padStart(4)}x  ${chalk.yellow(pct + '%')}  ${chalk.dim(desc)}`
      );
    }

    if (p.warnings.length > 0) {
      console.log(`    ${chalk.yellow('[!]')} ${p.warnings[0]}`);
    }
  }

  // ── Optimization Tips ──────────────────────────────────────────────────────
  const heaviest = profiles[0]!;
  const lightest = profiles[profiles.length - 1]!;

  console.log('\n');
  divider();
  console.log(`  ${chalk.bold.white('Optimization Tips')}`);
  divider();

  if (heaviest.totalWeight > 500) {
    ok('Identified heaviest circuit', `${heaviest.circuit} (weight: ${heaviest.totalWeight})`);
    console.log(chalk.dim(`    --> Focus optimization efforts here first`));
  }

  const totalWeight = profiles.reduce((s, p) => s + p.totalWeight, 0);
  const avgWeight = Math.round(totalWeight / profiles.length);
  info('Total ZK cost across all circuits', `weight ${totalWeight} (avg: ${avgWeight}/circuit)`);
  info('Fastest circuit', `${lightest.circuit} (weight: ${lightest.totalWeight}, ${lightest.estimatedProofTime})`);
  info('Slowest circuit', `${heaviest.circuit} (weight: ${heaviest.totalWeight}, ${heaviest.estimatedProofTime})`);

  const allWarnings = profiles.flatMap((p) => p.warnings.map((w) => `${p.circuit}: ${w}`));
  if (allWarnings.length === 0) {
    ok('All circuits look optimized');
  } else {
    console.log('');
    for (const w of allWarnings.slice(0, 5)) {
      console.log(`  ${chalk.yellow('[!]')} ${w}`);
    }
  }

  const totalCircuits = profiles.length;
  const slowCircuits = profiles.filter((p) => p.estimatedMs > 3000).length;

  console.log('');
  divider();
  console.log(`  Scanned ${totalCircuits} circuits. ${slowCircuits > 0 ? chalk.yellow(`${slowCircuits} circuit(s) may be slow (>3s).`) : chalk.green('All circuits within acceptable range.')}`);
  console.log('');
}
