import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { header, section, ok, fail, warn, info, divider } from '../ui/output.js';

interface LintIssue {
  file: string;
  line: number;
  severity: 'error' | 'warn';
  message: string;
  fix?: string;
}

/** Check pragma version at file header. */
function checkPragma(lines: string[], file: string): LintIssue | null {
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i] ?? '';
    const match = line.match(/pragma\s+compact\s+version\s+["']?([0-9.>=<^~]+)["']?/);
    if (match) {
      const version = match[1] ?? '';
      const numericVersion = version.replace(/[^0-9.]/g, '');
      const [major, minor] = numericVersion.split('.').map(Number);
      if ((minor ?? 0) < 20 && (major ?? 0) === 0) {
        return {
          file,
          line: i + 1,
          severity: 'warn',
          message: `Pragma version ${version} may be too old — recommend >= 0.20`,
          fix: 'Update pragma to: pragma compact version ">=0.20"',
        };
      }
      return null;
    }
  }
  return {
    file,
    line: 1,
    severity: 'warn',
    message: 'No pragma directive found',
    fix: 'Add at the top: pragma compact version ">=0.20"',
  };
}

/** Detect variables used in ledger operations without .disclose() */
function checkDisclosures(lines: string[], file: string): LintIssue[] {
  const issues: LintIssue[] = [];

  // Pattern: assignment or comparison in ledger/circuit context using a non-literal without disclose
  const ledgerOpPattern = /ledger\.\w+\s*=\s*([a-zA-Z_]\w*)(?!\s*\.disclose\(\))/;
  const incrementPattern = /\+\=\s*([a-zA-Z_]\w*)(?!\s*\.disclose\(\))/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Skip comments and disclose lines
    if (line.trim().startsWith('//') || line.includes('.disclose()')) continue;

    // Check for private variables used in ledger context
    const ledgerMatch = line.match(ledgerOpPattern);
    if (ledgerMatch?.[1]) {
      const varName = ledgerMatch[1];
      // Only flag if it looks like a potential witness variable (context based)
      const contextLines = lines.slice(Math.max(0, i - 5), i).join('\n');
      if (contextLines.includes('witness') || contextLines.includes('private')) {
        issues.push({
          file,
          line: i + 1,
          severity: 'warn',
          message: `'${varName}' used in ledger assignment — may need .disclose()`,
          fix: `Consider: ledger.field = disclose(${varName})`,
        });
      }
    }

    const incMatch = line.match(incrementPattern);
    if (incMatch?.[1]) {
      const varName = incMatch[1];
      const contextLines = lines.slice(Math.max(0, i - 3), i).join('\n');
      if (contextLines.includes('witness') || contextLines.includes('private') || line.includes('ledger')) {
        issues.push({
          file,
          line: i + 1,
          severity: 'warn',
          message: `'${varName}' used in increment without .disclose()`,
          fix: `Consider: ledger.field += disclose(${varName})`,
        });
      }
    }
  }

  return issues;
}

/** Detect constructor arguments from the compact file. */
function extractConstructorArgs(lines: string[], file: string): LintIssue | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = line.match(/constructor\s*\(([^)]+)\)/);
    if (match?.[1]) {
      const args = match[1]
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a !== 'context');

      if (args.length > 0) {
        return {
          file,
          line: i + 1,
          severity: 'warn',
          message: `Constructor declares ${args.length} arg(s): [${args.join(', ')}] — ensure api.ts passes 'args: [...]' to deployContract()`,
          fix: `In api.ts: deployContract(providers, { ..., args: [${args.map(() => '<value>').join(', ')}] })`,
        };
      }
    }
  }
  return null;
}

/** Find all .compact files. */
async function findCompactFiles(dir: string): Promise<string[]> {
  let files = await glob('**/*.compact', {
    cwd: dir,
    ignore: ['**/node_modules/**', '**/midnight-medic/**', '**/dist/**', '**/managed/**'],
    absolute: true,
  });

  // Self-Correction: If not found in current dir, walk up to workspace root
  if (files.length === 0) {
    files = await glob('**/*.compact', {
      cwd: path.join(dir, '..'),
      ignore: ['**/node_modules/**', '**/midnight-medic/**', '**/dist/**', '**/managed/**'],
      absolute: true,
    });
  }
  return files;
}

export async function runLint(targetDir: string): Promise<void> {
  header('Midnight Lint — scanning Compact contracts...');
  console.log(chalk.dim('  (Note: Static pattern-matching. Always defer to the Compact compiler.)\n'));

  const allFiles = await findCompactFiles(targetDir);

  if (allFiles.length === 0) {
    info('No .compact files found', `Searched in: ${targetDir} and its parent.`);
    console.log('');
    return;
  }

  // De-duplicate by basename (keep the one in src if possible)
  const uniqueFilesMap = new Map<string, string>();
  for (const f of allFiles) {
    const name = path.basename(f);
    const existing = uniqueFilesMap.get(name);
    // Prefer src/ or shorter paths as source of truth
    if (!existing || f.includes('/src/') || f.length < existing.length) {
      uniqueFilesMap.set(name, f);
    }
  }
  const files = Array.from(uniqueFilesMap.values());

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const filePath of files) {
    const relPath = path.relative(targetDir, filePath);
    section(relPath);

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const issues: LintIssue[] = [];

    // Run all checks
    const pragmaIssue = checkPragma(lines, relPath);
    if (pragmaIssue) issues.push(pragmaIssue);
    else ok('Pragma', 'Valid version directive found');

    const disclosureIssues = checkDisclosures(lines, relPath);
    issues.push(...disclosureIssues);

    const constructorIssue = extractConstructorArgs(lines, relPath);
    if (constructorIssue) issues.push(constructorIssue);

    if (issues.length === 0) {
      ok('No issues found');
    } else {
      for (const issue of issues) {
        const loc = `Line ${issue.line}`;
        if (issue.severity === 'error') {
          fail(loc, issue.message, issue.fix);
          totalErrors++;
        } else {
          warn(loc, issue.message, issue.fix);
          totalWarnings++;
        }
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  divider();
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`  ${chalk.green('[✓]')} ${chalk.bold('No lint issues found.')}`);
  } else {
    const parts: string[] = [];
    if (totalErrors > 0) parts.push(chalk.red(`${totalErrors} error${totalErrors !== 1 ? 's' : ''}`));
    if (totalWarnings > 0) parts.push(chalk.yellow(`${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}`));
    console.log(`  Result: ${parts.join(', ')}.`);
  }
  console.log('');
}
