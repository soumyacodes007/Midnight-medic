import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { glob } from 'glob';
import chalk from 'chalk';
import { header, divider, ok, fail, warn, info } from '../ui/output.js';

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
  do_communications_commitment: boolean;
  num_inputs: number;
  instructions: ZKIRInstruction[];
}

interface CircuitArg {
  name: string;
  type: { 'type-name': string; maxval?: number; length?: number };
}

interface ContractCircuit {
  name: string;
  pure: boolean;
  proof: boolean;
  arguments: CircuitArg[];
}

interface ContractInfo {
  'compiler-version': string;
  'language-version': string;
  circuits: ContractCircuit[];
}

interface SlotNode {
  op: string;
  slot: number;
  deps: number[];
  instIdx: number;
  inst?: ZKIRInstruction;
  isPub?: boolean;
  argName?: string; // resolved from contract-info
  semantics?: string; // human-readable meaning
}

interface TraceFrame {
  type: 'constraint_violation' | 'input_mismatch' | 'timeout' | 'memory' | 'unknown_failure';
  circuit?: string;
  assertIdx?: number;
  condSlot?: number;
  rawError: string;
  explanation: string;
  suggestedFix: string;
  zkirGraph?: SlotNode[];
  sourceHint?: string;
  argMismatch?: { expected: string; got: string };
}

// ─── ZKIR Graph Builder ───────────────────────────────────────────────────────

function buildSlotGraph(insts: ZKIRInstruction[], numPub: number): Map<number, SlotNode> {
  const graph = new Map<number, SlotNode>();

  // Register public input slots
  for (let i = 0; i < numPub; i++) {
    graph.set(i, { op: 'public_arg', slot: i, deps: [], instIdx: -1, isPub: true });
  }

  let slot = numPub;
  const valueProducing = new Set([
    'load_imm', 'private_input', 'public_input', 'persistent_hash',
    'add', 'sub', 'mul', 'neg', 'cond_select', 'test_eq',
    'div_mod_power_of_two', 'less_than', 'copy', 'output',
  ]);

  for (let idx = 0; idx < insts.length; idx++) {
    const inst = insts[idx]!;
    const op = inst.op;

    if (valueProducing.has(op)) {
      const deps: number[] = [];
      if (inst.inputs) deps.push(...inst.inputs);
      if (inst.a != null) deps.push(inst.a);
      if (inst.b != null) deps.push(inst.b);
      if (inst.var != null) deps.push(inst.var);

      graph.set(slot, {
        op,
        slot,
        deps,
        instIdx: idx,
        inst,
        semantics: describeInstruction(op, inst, slot, numPub),
      });
      slot++;
    }
  }

  return graph;
}

function describeInstruction(op: string, inst: ZKIRInstruction, slot: number, numPub: number): string {
  switch (op) {
    case 'load_imm': {
      const hex = inst.imm ?? '';
      if (hex.length <= 4) return `constant ${parseInt(hex || '0', 16)}`;
      if (hex.startsWith('6672616D')) {
        // "framed:" in hex — this is a ledger key prefix
        return `ledger key prefix "${Buffer.from(hex, 'hex').toString('utf-8').replace(/[^\x20-\x7E]/g, '?')}"`;
      }
      return `constant 0x${hex.slice(0, 16)}${hex.length > 16 ? '...' : ''}`;
    }
    case 'private_input': return `private witness input`;
    case 'public_input': return `public ledger value read`;
    case 'persistent_hash':
      return `hash(${inst.inputs?.slice(0, 2).join(', ')}...) → commitment key`;
    case 'add': return `add(var[${inst.a}], var[${inst.b}])`;
    case 'sub': return `subtract(var[${inst.a}], var[${inst.b}])`;
    case 'mul': return `multiply(var[${inst.a}], var[${inst.b}])`;
    case 'test_eq': return `test_eq(var[${inst.a}], var[${inst.b}]) → boolean`;
    case 'less_than': return `var[${inst.a}] < var[${inst.b}] → boolean`;
    case 'cond_select': return `if/else branch`;
    case 'div_mod_power_of_two': return `bitfield decomposition`;
    case 'copy': return `copy(var[${inst.var}])`;
    default: return op;
  }
}

// Trace all the "ancestors" of a slot recursively, to explain what was being checked
function explainSlotChain(
  slotId: number,
  graph: Map<number, SlotNode>,
  numPub: number,
  depth = 0,
  visited = new Set<number>(),
): string[] {
  if (visited.has(slotId) || depth > 5) return [];
  visited.add(slotId);

  const node = graph.get(slotId);
  if (!node) return [`unknown var[${slotId}]`];

  const indent = '  '.repeat(depth);

  if (node.isPub) {
    const label = node.argName ? `"${node.argName}"` : `public_arg[${slotId}]`;
    return [`${indent}var[${slotId}] = ${label} (public circuit input)`];
  }

  const lines: string[] = [
    `${indent}var[${slotId}] = ${node.semantics ?? node.op} (inst #${node.instIdx})`,
  ];

  for (const dep of node.deps.slice(0, 3)) {
    lines.push(...explainSlotChain(dep, graph, numPub, depth + 1, visited));
  }

  return lines;
}

// Find all assert instructions and their condition variable
function findAsserts(insts: ZKIRInstruction[]): Array<{ instIdx: number; cond: number }> {
  const result: Array<{ instIdx: number; cond: number }> = [];
  for (let i = 0; i < insts.length; i++) {
    const inst = insts[i]!;
    if (inst.op === 'assert' && inst.cond != null) {
      result.push({ instIdx: i, cond: inst.cond });
    }
  }
  return result;
}

// ─── Contract Info Loader ─────────────────────────────────────────────────────

async function loadContractInfo(zkDir: string): Promise<ContractInfo | null> {
  // Walk up from zkDir to find compiler/contract-info.json
  const candidates = [
    path.join(zkDir, '..', 'compiler', 'contract-info.json'),
    path.join(zkDir, '..', '..', 'compiler', 'contract-info.json'),
    path.join(zkDir, 'contract-info.json'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return JSON.parse(fs.readFileSync(c, 'utf-8')) as ContractInfo;
      } catch {
        // skip
      }
    }
  }
  return null;
}

// ─── ZKIR Loader ─────────────────────────────────────────────────────────────

function loadZKIR(zkFile: string): ZKIRFile | null {
  try {
    return JSON.parse(fs.readFileSync(zkFile, 'utf-8')) as ZKIRFile;
  } catch {
    return null;
  }
}

// ─── Source Hint Engine ───────────────────────────────────────────────────────
// Scan the .compact source file for function definitions and find the best
// matching lines based on what the ZKIR is checking.

function buildSourceHint(
  circuit: string,
  traceLines: string[],
  cwd: string,
): string | undefined {
  const compactFiles = glob.sync('**/*.compact', {
    cwd,
    ignore: ['node_modules/**'],
    absolute: true,
  });
  if (compactFiles.length === 0) return undefined;

  for (const file of compactFiles) {
    const src = fs.readFileSync(file, 'utf-8').split('\n');
    const fnStartLine = src.findIndex(
      (l) => l.includes(`circuit ${circuit}`) || l.includes(`export circuit ${circuit}`),
    );
    if (fnStartLine === -1) continue;

    // Extract the function body (up to 30 lines)
    const relevantLines = src.slice(fnStartLine, fnStartLine + 40);
    const fname = path.relative(cwd, file);

    // Find lines with assert/hash/witness patterns
    const hits = relevantLines
      .map((line, i) => ({ line, lineNo: fnStartLine + i + 1 }))
      .filter(({ line }) =>
        /assert|witness|hash|disclose|public_input|ledger\.|\.disclose/.test(line),
      );

    if (hits.length === 0) {
      return `${fname}:${fnStartLine + 1} — circuit ${circuit} definition`;
    }

    const hintLines = hits
      .slice(0, 6)
      .map(({ line, lineNo }) => `  ${chalk.dim(String(lineNo).padStart(4))} | ${chalk.yellow(line.trim())}`)
      .join('\n');

    return `${chalk.bold.white(fname)}\n${hintLines}`;
  }

  return undefined;
}

// ─── Error Pattern Detection ──────────────────────────────────────────────────

const ERROR_PATTERNS = [
  {
    regex: /public transcript input mismatch/i,
    type: 'input_mismatch' as const,
    explanation: 'The number or type of public inputs sent to the circuit does not match what the ZKIR expects.',
    fix: 'Check that your function arguments match the circuit signature. Recompile if you changed the .compact file.',
  },
  {
    regex: /constraint.*fail|failed.*constraint|unsatisfiable/i,
    type: 'constraint_violation' as const,
    explanation: 'A mathematical constraint (assert) inside the ZK circuit evaluated to false.',
    fix: 'An assert() in your Compact contract failed. Run: midnight-medic trace --circuit <name> to see which one.',
  },
  {
    regex: /cannot prove|proof generation failed|prover.*error/i,
    type: 'unknown_failure' as const,
    explanation: 'The prover could not generate a valid proof. This usually means an invalid witness value.',
    fix: 'Check that your witness() functions return values that satisfy all circuit constraints.',
  },
  {
    regex: /timeout|timed out/i,
    type: 'timeout' as const,
    explanation: 'Proof generation exceeded the timeout limit.',
    fix: 'Increase Docker memory/CPU limits. Ensure your circuit is not excessively complex.',
  },
  {
    regex: /memory|oom|out of memory/i,
    type: 'memory' as const,
    explanation: 'The proof server ran out of memory.',
    fix: 'Increase Docker memory in Docker Desktop (recommended 8GB+).',
  },
];

// ─── Proof Request Tracker ────────────────────────────────────────────────────

// The proof server logs which circuit it's proving via HTTP:
// "Starting to process request for /prove..." (then the circuit name comes in request body)
// We track the LAST circuit that was being proved
const PROVE_REQUEST_RE = /Starting to process request for \/prove/i;
const HTTP_LOG_RE = /POST \/prove HTTP/i;
const CIRCUIT_NAME_RE = /circuit[:\s]+"?(\w+)"?/i;

// ─── Trace Report Printer ─────────────────────────────────────────────────────

function printTraceReport(frame: TraceFrame): void {
  console.log('');
  console.log(chalk.bgRed.white.bold('  !! ZK PROOF FAILURE DETECTED !!  '));
  divider();
  console.log('');

  // Error type badge
  const badges: Record<string, string> = {
    constraint_violation: chalk.red.bold('[CONSTRAINT VIOLATION]'),
    input_mismatch: chalk.red.bold('[INPUT MISMATCH]'),
    timeout: chalk.yellow.bold('[TIMEOUT]'),
    memory: chalk.red.bold('[OUT OF MEMORY]'),
    unknown_failure: chalk.red.bold('[PROOF FAILED]'),
  };

  console.log(`  ${badges[frame.type] ?? '[FAILURE]'}`);
  if (frame.circuit) {
    console.log(`  ${chalk.dim('Circuit:')} ${chalk.cyan(frame.circuit)}`);
  }
  console.log('');

  // Explanation
  console.log(`  ${chalk.bold.white('What happened:')}`);
  console.log(`  ${frame.explanation}`);
  console.log('');

  // ZKIR analysis for constraint violations
  if (frame.type === 'constraint_violation' && frame.zkirGraph && frame.zkirGraph.length > 0) {
    console.log(`  ${chalk.bold.white('Circuit Trace (ZKIR analysis):')}`);
    divider();
    for (const line of frame.zkirGraph) {
      const prefix = line.isPub
        ? chalk.cyan('  [pub_arg]')
        : chalk.dim('  [op]     ');
      const label = line.argName ? chalk.cyan(line.argName) : chalk.dim(line.op);
      const sem = line.semantics ? chalk.dim(` — ${line.semantics}`) : '';
      console.log(`${prefix} var[${line.slot}] = ${label}${sem}`);
    }
    console.log('');
  }

  // Source hint
  if (frame.sourceHint) {
    console.log(`  ${chalk.bold.white('Relevant Compact source:')}`);
    console.log(`  ${chalk.dim('(Note: This is a heuristic match — always verify in the compiler)')}`);
    divider();
    console.log(frame.sourceHint);
    console.log('');
  }

  // Suggested fix
  console.log(`  ${chalk.bold.white('Suggested fix:')}`);
  console.log(`  ${chalk.yellow('->')} ${frame.suggestedFix}`);
  console.log('');

  // Raw log
  console.log(`  ${chalk.dim('Raw error:')} ${chalk.gray(frame.rawError.trim().slice(0, 160))}`);
  divider();
  console.log('');
}

// ─── Deep ZKIR Analyzer ───────────────────────────────────────────────────────

async function analyzeCircuitFailure(
  circuitName: string,
  zkDirs: string[],
  contractInfo: ContractInfo | null,
  cwd: string,
): Promise<{ zkirGraph: SlotNode[]; sourceHint?: string } | null> {
  // Find the ZKIR file for this circuit
  let zkFile: string | undefined;
  for (const dir of zkDirs) {
    const candidate = path.join(dir, `${circuitName}.zkir`);
    if (fs.existsSync(candidate)) {
      zkFile = candidate;
      break;
    }
  }

  if (!zkFile) return null;

  const zkir = loadZKIR(zkFile);
  if (!zkir) return null;

  const { instructions, num_inputs } = zkir;
  const graph = buildSlotGraph(instructions, num_inputs);

  // Resolve argument names from contract-info
  if (contractInfo) {
    const circuit = contractInfo.circuits.find((c) => c.name === circuitName);
    if (circuit) {
      circuit.arguments.forEach((arg, i) => {
        const node = graph.get(i);
        if (node) {
          node.argName = `${arg.name}: ${arg.type['type-name']}`;
        }
      });
    }
  }

  // Find all assert instructions
  const asserts = findAsserts(instructions);

  // Build the "most likely failing" trace — we explain ALL asserts
  const zkirGraph: SlotNode[] = [];
  for (const { instIdx, cond } of asserts) {
    const node = graph.get(cond);
    if (node) {
      zkirGraph.push({
        ...node,
        semantics: `assert at inst[${instIdx}] checks this condition`,
      });
    }
  }

  // Add public inputs for context
  for (let i = 0; i < num_inputs && i < 8; i++) {
    const node = graph.get(i);
    if (node && !zkirGraph.find((n) => n.slot === i)) {
      zkirGraph.unshift(node);
    }
  }

  // Build source hint
  const sourceHint = buildSourceHint(circuitName, [], cwd);

  return { zkirGraph, sourceHint };
}

// ─── Container Detection ──────────────────────────────────────────────────────

function detectProofServerContainer(): string | undefined {
  try {
    const { execSync } = require('node:child_process');
    const out = execSync('docker ps --format "{{.Names}}\t{{.Image}}"', { encoding: 'utf-8' });
    for (const line of out.split('\n')) {
      if (
        line.includes('proof-server') ||
        line.includes('prover') ||
        line.includes('midnight-proof')
      ) {
        return line.split('\t')[0]?.trim();
      }
    }
  } catch {
    // Docker not running
  }
  return undefined;
}

// ─── Post-mortem Single-Circuit Analysis ─────────────────────────────────────

async function runPostMortem(circuitName: string, cwd: string): Promise<void> {
  header(`Midnight Trace — post-mortem analysis: ${circuitName}`);
  console.log(chalk.dim('  Analyzing ZKIR graph without a live Docker event...\n'));

  const zkFilesFound = await glob('**/zkir/*.zkir', {
    cwd,
    ignore: ['node_modules/**'],
    absolute: true,
  });
  const zkDirs = [...new Set(zkFilesFound.map((f) => path.dirname(f)))];

  if (zkDirs.length === 0) {
    warn('No ZKIR directories found', 'Compile your contract first: npx compactc');
    return;
  }

  const contractInfo = await loadContractInfo(zkDirs[0]!);
  if (contractInfo) {
    ok('contract-info.json', `Compiler v${contractInfo['compiler-version']}`);
  }

  const result = await analyzeCircuitFailure(circuitName, zkDirs, contractInfo, cwd);

  if (!result) {
    fail('ZKIR Analysis', `Could not find ${circuitName}.zkir in any managed/ directory`);
    info('Available circuits', zkDirs.map((d) => fs.readdirSync(d).filter((f) => f.endsWith('.zkir')).map((f) => f.replace('.zkir', '')).join(', ')).join(', '));
    return;
  }

  const frame: TraceFrame = {
    type: 'constraint_violation',
    circuit: circuitName,
    rawError: `(post-mortem analysis — no live error captured)`,
    explanation: `Static analysis of circuit "${circuitName}": these are all the assert() constraints that could cause a proof failure.`,
    suggestedFix: `Cross-reference the assert chain below with your witness() functions in ${circuitName} to find which value is violating a constraint.`,
    zkirGraph: result.zkirGraph,
    sourceHint: result.sourceHint,
  };

  printTraceReport(frame);

  // Summary table
  const zkFile = zkDirs.map((d) => path.join(d, `${circuitName}.zkir`)).find((f) => fs.existsSync(f));
  if (zkFile) {
    const zkir = loadZKIR(zkFile)!;
    const asserts = findAsserts(zkir.instructions);
    console.log(`  ${chalk.bold.white('Constraint Summary for')} ${chalk.cyan(circuitName)}`);
    divider();
    console.log(`  ${chalk.dim('Total instructions:')}  ${zkir.instructions.length}`);
    console.log(`  ${chalk.dim('Public inputs:    ')}  ${zkir.num_inputs}`);
    console.log(`  ${chalk.dim('Assert count:     ')}  ${chalk.yellow(String(asserts.length))} — any of these can cause a proof failure`);
    console.log(`  ${chalk.dim('Assert positions: ')}  ${asserts.map((a) => `inst[${a.instIdx}]`).join(', ')}`);
    console.log('');
  }
}

// ─── Live Monitor Mode ────────────────────────────────────────────────────────

async function runLiveMonitor(containerName: string, cwd: string): Promise<void> {
  header(`Midnight Trace — live proof monitor: ${containerName}`);
  console.log(chalk.dim('  Streaming Docker logs and analyzing ZK proof failures in real-time.'));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));
  divider();

  // Pre-load all ZKIR directories
  const zkFilesLive = await glob('**/zkir/*.zkir', {
    cwd,
    ignore: ['node_modules/**'],
    absolute: true,
  });
  const zkDirs = [...new Set(zkFilesLive.map((f) => path.dirname(f)))];

  const contractInfo = zkDirs.length > 0 ? await loadContractInfo(zkDirs[0]!) : null;
  if (contractInfo) {
    ok('Contract artifacts', `${contractInfo.circuits.length} circuits loaded`);
    divider();
  }

  let lastCircuit: string | undefined;
  let buffer = '';

  const proc = spawn('docker', ['logs', '-f', '--tail', '30', containerName], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const processLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Track which circuit is being proved
    if (PROVE_REQUEST_RE.test(trimmed)) {
      // Next HTTP log will confirm it, just note a proof started
      console.log(`  ${chalk.dim('[trace]')} ${chalk.dim('Proof request incoming...')}`);
      return;
    }

    // Try to extract circuit name from JSON body logs
    const circMatch = trimmed.match(CIRCUIT_NAME_RE);
    if (circMatch?.[1]) {
      lastCircuit = circMatch[1];
    }

    // Check for errors
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.regex.test(trimmed)) {
        let zkirGraph: SlotNode[] | undefined;
        let sourceHint: string | undefined;

        if (lastCircuit && zkDirs.length > 0 && pattern.type === 'constraint_violation') {
          const result = await analyzeCircuitFailure(lastCircuit, zkDirs, contractInfo, cwd);
          if (result) {
            zkirGraph = result.zkirGraph;
            sourceHint = result.sourceHint;
          }
        }

        const frame: TraceFrame = {
          type: pattern.type,
          circuit: lastCircuit,
          rawError: trimmed,
          explanation: pattern.explanation,
          suggestedFix: lastCircuit
            ? `${pattern.fix}\n  Run: midnight-medic trace --circuit ${lastCircuit} for deep analysis`
            : pattern.fix,
          zkirGraph,
          sourceHint,
        };

        printTraceReport(frame);
        return;
      }
    }

    // Successful proof
    if (/POST \/prove HTTP.*200/i.test(trimmed)) {
      const match = trimmed.match(/took ([\d.]+)s/);
      const time = match ? ` in ${match[1]}s` : '';
      console.log(`  ${chalk.green('[✓]')} Proof generated${chalk.dim(time)}`);
      return;
    }

    // Other notable log lines
    if (/starting to process/i.test(trimmed)) {
      console.log(`  ${chalk.dim('[-]')} ${trimmed.slice(0, 90)}`);
      return;
    }

    // Default: show as dim
    console.log(chalk.dim(`      ${trimmed.slice(0, 100)}`));
  };

  const onData = (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) void processLine(line);
    }
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('error', (err) => {
    fail('Docker', `Failed to attach: ${err.message}`);
  });

  proc.on('close', (code) => {
    console.log('');
    divider();
    if (code === 0 || code === null) {
      console.log(chalk.dim('  Trace session ended.'));
    } else {
      fail('Docker', `Exited with code ${code}. Container may have stopped.`);
    }
  });

  process.on('SIGINT', () => {
    proc.kill('SIGTERM');
    console.log(chalk.dim('\n  Trace session terminated.'));
    process.exit(0);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function runTrace(options: {
  circuit?: string;
  container?: string;
  cwd: string;
}): Promise<void> {
  // Post-mortem mode: analyze a specific circuit without Docker
  if (options.circuit) {
    await runPostMortem(options.circuit, options.cwd);
    return;
  }

  // Live mode: stream Docker logs
  const container = options.container ?? detectProofServerContainer();
  if (!container) {
    console.log('');
    console.log(chalk.yellow('  [!] No running proof server container detected.'));
    console.log(chalk.dim('  Start it first, or use: midnight-medic trace --circuit <circuit-name>'));
    console.log(chalk.dim('  for post-mortem analysis without a live Docker session.'));
    console.log('');
    console.log(`  ${chalk.bold.white('Usage:')}`);
    console.log(`  ${chalk.cyan('midnight-medic trace')}                         Live monitor (auto-detect container)`);
    console.log(`  ${chalk.cyan('midnight-medic trace --circuit castPrivateVote')} Deep-analyze a specific circuit`);
    console.log(`  ${chalk.cyan('midnight-medic trace --container my-prover')}    Specify container name manually`);
    console.log('');
    return;
  }

  await runLiveMonitor(container, options.cwd);
}
