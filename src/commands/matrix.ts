import chalk from 'chalk';
import { header, divider } from '../ui/output.js';
import { COMPAT_MATRIX, latestCompatEntry } from '../compat/matrix.js';

export interface MatrixOptions {
  json?: boolean;
}

/** Print the Midnight component compatibility matrix. */
export function runMatrix(options: MatrixOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(COMPAT_MATRIX, null, 2));
    return;
  }

  header('Midnight Compatibility Matrix');

  const rows = [
    ['Ledger', 'Proof Server Image', 'SDK', 'Compiler'],
    ...COMPAT_MATRIX.map((e) => [e.ledgerVersion, e.proofServerImage, e.sdkVersion, e.compilerVersion]),
  ];
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((r) => (r[col] ?? '').length)));
  const latest = latestCompatEntry().ledgerVersion;

  rows.forEach((row, i) => {
    const line = row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join('   ');
    if (i === 0) console.log(`  ${chalk.bold(line)}`);
    else if (row[0] === latest) console.log(`  ${chalk.green(line)}  ${chalk.dim('(latest)')}`);
    else console.log(`  ${line}`);
  });

  console.log('');
  divider();
  console.log(chalk.dim('  Run `midnight-medic sync` to check your project against this matrix.'));
  console.log('');
}
