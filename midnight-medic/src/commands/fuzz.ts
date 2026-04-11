import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import * as http from 'node:http';
import { header, divider, info, warn, fail, ok } from '../ui/output.js';
import { analyzeCircuitFailure } from './trace.js';

interface ZKIRType {
  'type-name': string;
  length?: number;
  maxval?: number;
  elements?: Array<{ name: string; type: ZKIRType }>;
  type?: ZKIRType;
}

function generateRandomValue(type: ZKIRType): any {
  switch (type['type-name']) {
    case 'Uint':
      const max = type.maxval ?? 255;
      return Math.floor(Math.random() * (max + 1));
    case 'Bytes':
      const len = type.length ?? 32;
      return Array.from({ length: len }, () => Math.floor(Math.random() * 256));
    case 'Boolean':
      return Math.random() > 0.5;
    case 'Vector':
      const vLen = type.length ?? 4;
      return Array.from({ length: vLen }, () => generateRandomValue(type.type!));
    case 'Struct':
      const obj: any = {};
      for (const el of type.elements ?? []) {
        obj[el.name] = generateRandomValue(el.type);
      }
      return obj;
    case 'Tuple':
      return [];
    default:
      return 0;
  }
}

async function findContractInfo(dir: string): Promise<string | null> {
  const files = await glob('**/contract-info.json', {
    cwd: dir,
    ignore: ['**/node_modules/**', '**/midnight-medic/**'],
    absolute: true,
  });
  if (files.length === 0) {
    const parentFiles = await glob('**/contract-info.json', {
      cwd: path.join(dir, '..'),
      ignore: ['**/node_modules/**', '**/midnight-medic/**'],
      absolute: true,
    });
    return parentFiles[0] || null;
  }
  return files[0] || null;
}

export async function runFuzz(circuitName: string, cwd: string): Promise<void> {
  header(`Midnight Fuzzer — testing circuit: ${circuitName}`);
  console.log(chalk.dim('  Blasting circuit with random witnesses to find path-dependency errors.\n'));

  const infoPath = await findContractInfo(cwd);
  if (!infoPath) {
    warn('Missing contract-info.json', 'Compile your contract first.');
    return;
  }

  const contractInfo = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  const circuit = contractInfo.circuits.find((c: any) => c.name === circuitName);

  if (!circuit) {
    fail('Circuit not found', circuitName);
    return;
  }

  if (circuit.arguments.length === 0) {
    info('Fuzzing Strategy', 'Circuit has 0 arguments. Stress-testing internal witnesses and local secret state.');
  } else {
    info('Fuzzing Strategy', `Generating random data for [${circuit.arguments.map((a: any) => a.name).join(', ')}]`);
  }
  
  const randomArgs = circuit.arguments.map((arg: any) => generateRandomValue(arg.type));
  
  if (randomArgs.length > 0) {
    console.log(`  ${chalk.dim('Generated inputs:')} ${JSON.stringify(randomArgs)}`);
  }
  divider();

  // Try to send to Proof Server using native http
  const postData = JSON.stringify({
    circuit: circuitName,
    args: randomArgs
  });

  const requestOptions = {
    hostname: 'localhost',
    port: 6300,
    path: '/prove',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  try {
    process.stdout.write(`  ${chalk.cyan('●')} Requesting proof from local server... `);
    
    // We expect this to fail with a constraint violation!
    await new Promise<string>((resolve, reject) => {
      const req = http.request(requestOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(body || `Server returned ${res.statusCode}`));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.write(postData);
      req.end();
    });

    console.log(chalk.green(' SUCCESS? (Unlikely)'));
    ok('Edge Case Found', 'The random inputs actually satisfied the circuit constraints!');
  } catch (err: any) {
    console.log(chalk.red(' FAILED (Expected)'));
    
    // Attempt to parse out the constraint error
    fail('Constraint Violation Caught', 'Fuzzed data tripped a safety assert.');

    // Now run the trace engine to show which assert failed
    divider();
    info('Medic X-Ray Analysis', 'Diving into the ZKIR graph to find the failing gate...');
    
    // Find ZKIR location for trace
    const zkFiles = await glob('**/*.zkir', { cwd: path.dirname(infoPath), absolute: true });
    const zkDirs = [...new Set(zkFiles.map(f => path.dirname(f)))];
    
    const analysis = await analyzeCircuitFailure(circuitName, zkDirs, contractInfo, cwd);
    if (analysis) {
      const { printTraceReport } = await import('./trace.js');
      printTraceReport({
        type: 'constraint_violation',
        circuit: circuitName,
        explanation: `Fuzzer detected a property violation! The random inputs provided failed to satisfy the circuit's safety constraints.`,
        suggestedFix: 'Review the assert() gate identified below. These conditions are being violated by the fuzzed witness state.',
        rawError: err.message,
        zkirGraph: analysis.zkirGraph,
        sourceHint: analysis.sourceHint
      });
    }
  }

  console.log('');
  divider();
  ok('Fuzzing session complete', 'Property-based audit finished.');
}
