import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { header, section, ok, fail, warn, info, divider } from '../ui/output.js';
import { checkPragma, checkDisclosures, extractConstructorArgs, type LintIssue } from '../lint/rules.js';

/** Find all .compact files. */
async function findCompactFiles(dir: string): Promise<string[]> {
  return glob('**/*.compact', {
    cwd: dir,
    ignore: ['node_modules/**', 'dist/**', 'managed/**'],
    absolute: true,
  });
}

export async function runLint(targetDir: string): Promise<void> {
  header('Midnight Lint — scanning Compact contracts...');
  console.log(chalk.dim('  (Note: Static pattern-matching. Always defer to the Compact compiler.)\n'));

  const files = await findCompactFiles(targetDir);

  if (files.length === 0) {
    info('No .compact files found', `Searched in: ${targetDir}`);
    console.log('');
    return;
  }

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
