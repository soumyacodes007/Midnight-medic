import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { header, divider, info, warn, section } from '../ui/output.js';

interface StateAccess {
  name: string;
  type: 'ledger' | 'witness' | 'private';
  circuits: string[];
}

async function findCompactFiles(dir: string): Promise<string[]> {
  let files = await glob('**/*.compact', {
    cwd: dir,
    ignore: ['**/node_modules/**', '**/midnight-medic/**', '**/dist/**', '**/managed/**'],
    absolute: true,
  });

  if (files.length === 0) {
    files = await glob('**/*.compact', {
      cwd: path.join(dir, '..'),
      ignore: ['**/node_modules/**', '**/midnight-medic/**', '**/dist/**', '**/managed/**'],
      absolute: true,
    });
  }
  return files;
}

export async function runMatrix(cwd: string): Promise<void> {
  header('Midnight Privacy Matrix — visibility audit...');
  console.log(chalk.dim('  Mapping data accessibility across public and private state domains.\n'));

  const files = await findCompactFiles(cwd);

  if (files.length === 0) {
    warn('No .compact files found', 'Compile your contract first.');
    return;
  }

  // Simple de-duplication
  const mainFile = files.find(f => f.includes('/src/')) || files[0]!;
  const content = fs.readFileSync(mainFile, 'utf-8');
  const lines = content.split('\n');

  const access: StateAccess[] = [];
  const circuits: string[] = [];

  // Parse circuits
  for (const line of lines) {
    const circuitMatch = line.match(/export\s+circuit\s+(\w+)/);
    if (circuitMatch?.[1]) circuits.push(circuitMatch[1]);
  }

  // Parse ledger (public state)
  for (const line of lines) {
    const ledgerMatch = line.match(/ledger\s+(\w+)/);
    if (ledgerMatch?.[1]) {
      access.push({ name: ledgerMatch[1], type: 'ledger', circuits: [] });
    }
  }

  // Parse witnesses (private state)
  for (const line of lines) {
    const witnessMatch = line.match(/witness\s+([a-zA-Z0-9_]+)/);
    if (witnessMatch?.[1]) {
      access.push({ name: witnessMatch[1], type: 'witness', circuits: [] });
    }
  }

  // Cross-reference (very simple regex heuristic for the demo)
  for (const acc of access) {
    for (const circuit of circuits) {
      // Find the circuit block
      const circuitIndex = lines.findIndex(l => l.includes(`circuit ${circuit}`));
      if (circuitIndex !== -1) {
        // Scan until next export or end of file
        const block = lines.slice(circuitIndex, circuitIndex + 50).join('\n');
        if (block.includes(acc.name)) {
          acc.circuits.push(circuit);
        }
      }
    }
  }

  // ── Render Access Report ──────────────────────────────────────────────────
  const ledgerState = access.filter(a => a.type === 'ledger');
  const witnessState = access.filter(a => a.type === 'witness');

  if (witnessState.length > 0) {
    section('🔐 PRIVATE VAULT (Witness/Secret State)');
    console.log(chalk.dim('  These variables never leave the user\'s machine. Only specific circuits can access them.'));
    divider();
    
    for (const acc of witnessState) {
      const circuitsList = acc.circuits.length === circuits.length 
        ? chalk.cyan('Accessed by all circuits') 
        : chalk.dim(acc.circuits.join(', '));
      
      console.log(`  ${chalk.cyan(acc.name.padEnd(25))} ${chalk.gray('-->')} ${circuitsList}`);
    }
  }

  if (ledgerState.length > 0) {
    console.log('');
    section('🌐 PUBLIC REGISTRY (Ledger/Shared State)');
    console.log(chalk.dim('  These variables are stored on the global Midnight ledger and are publicly visible.'));
    divider();

    for (const acc of ledgerState) {
      let circuitsList = '';
      if (acc.circuits.length === circuits.length) {
        circuitsList = chalk.yellow('Visible to all circuits');
      } else if (acc.circuits.length === 0) {
        circuitsList = chalk.gray('No circuit access (Static / Constant)');
      } else {
        circuitsList = chalk.dim(acc.circuits.join(', '));
      }

      console.log(`  ${chalk.yellow(acc.name.padEnd(25))} ${chalk.gray('-->')} ${circuitsList}`);
    }
  }

  console.log('\n  ' + chalk.dim('Legend: Ledger = Shared, Witness = Local Secret'));

  console.log('\n  ' + chalk.dim('Legend: (L) = Ledger (Public), (W) = Witness (Private)'));
  divider();
  console.log(`  ${chalk.green('[✓]')} Privacy matrix generated for ${circuits.length} circuits.`);
  console.log('');
}
