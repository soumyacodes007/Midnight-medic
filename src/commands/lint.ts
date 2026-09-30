import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { header, section, ok, fail, warn, info, divider } from '../ui/output.js';
import {
  checkPragma,
  checkDisclosures,
  checkAssertMessages,
  extractConstructorArgs,
  type LintIssue,
} from '../lint/rules.js';

/** Find all .compact files. */
async function findCompactFiles(dir: string): Promise<string[]> {
  return glob('**/*.compact', {
    cwd: dir,
    ignore: ['node_modules/**', 'dist/**', 'managed/**'],
    absolute: true,
  });
}

export interface LintOptions {
  json?: boolean;
}

interface FileReport {
  file: string;
  issues: LintIssue[];
}

function lintFile(filePath: string, relPath: string): FileReport {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const issues: LintIssue[] = [];

  const pragmaIssue = checkPragma(lines, relPath);
  if (pragmaIssue) issues.push(pragmaIssue);
  issues.push(...checkDisclosures(lines, relPath));
  issues.push(...checkAssertMessages(lines, relPath));
  const constructorIssue = extractConstructorArgs(lines, relPath);
  if (constructorIssue) issues.push(constructorIssue);

  return { file: relPath, issues };
}

export async function runLint(targetDir: string, options: LintOptions = {}): Promise<void> {
  const files = await findCompactFiles(targetDir);
  const reports = files.map((filePath) => lintFile(filePath, path.relative(targetDir, filePath)));

  const allIssues = reports.flatMap((r) => r.issues);
  const totalErrors = allIssues.filter((i) => i.severity === 'error').length;
  const totalWarnings = allIssues.length - totalErrors;

  if (options.json) {
    console.log(JSON.stringify({ files: reports, errors: totalErrors, warnings: totalWarnings }, null, 2));
    return;
  }

  header('Midnight Lint — scanning Compact contracts...');
  console.log(chalk.dim('  (Note: Static pattern-matching. Always defer to the Compact compiler.)\n'));

  if (files.length === 0) {
    info('No .compact files found', `Searched in: ${targetDir}`);
    console.log('');
    return;
  }

  for (const report of reports) {
    section(report.file);

    if (!report.issues.some((i) => i.message.includes('ragma'))) {
      ok('Pragma', 'Valid version directive found');
    }

    if (report.issues.length === 0) {
      ok('No issues found');
      continue;
    }

    for (const issue of report.issues) {
      const loc = `Line ${issue.line}`;
      if (issue.severity === 'error') fail(loc, issue.message, issue.fix);
      else warn(loc, issue.message, issue.fix);
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
