import chalk from 'chalk';

export const symbol = {
  ok: chalk.green('[✓]'),
  fail: chalk.red('[x]'),
  warn: chalk.yellow('[!]'),
  info: chalk.gray('[-]'),
};

export function ok(label: string, detail?: string): void {
  console.log(`  ${symbol.ok} ${label}${detail ? `: ${detail}` : ''}`);
}

export function fail(label: string, detail?: string, fix?: string): void {
  console.log(`  ${symbol.fail} ${label}${detail ? `: ${detail}` : ''}`);
  if (fix) {
    console.log(`      ${chalk.dim('--> ' + fix)}`);
  }
}

export function warn(label: string, detail?: string, fix?: string): void {
  console.log(`  ${symbol.warn} ${label}${detail ? `: ${detail}` : ''}`);
  if (fix) {
    console.log(`      ${chalk.dim('--> ' + fix)}`);
  }
}

export function info(label: string, detail?: string): void {
  console.log(`  ${symbol.info} ${label}${detail ? ': ' + chalk.dim(detail) : ''}`);
}

export function section(title: string): void {
  console.log(`\n  ${chalk.bold(title)}`);
}

export function divider(): void {
  console.log(chalk.gray('  ' + '-'.repeat(60)));
}

export function header(title: string): void {
  console.log('');
  console.log(chalk.bold.white(title));
  divider();
}

export function summary(errors: number, warnings: number): void {
  console.log('');
  divider();
  if (errors === 0 && warnings === 0) {
    console.log(`  ${symbol.ok} ${chalk.bold('All checks passed. Environment is ready.')}`);
  } else {
    const parts: string[] = [];
    if (errors > 0) parts.push(chalk.red(`${errors} error${errors > 1 ? 's' : ''}`));
    if (warnings > 0) parts.push(chalk.yellow(`${warnings} warning${warnings > 1 ? 's' : ''}`));
    console.log(`  Result: ${parts.join(', ')}.`);
  }
  console.log('');
}

export interface CheckResult {
  label: string;
  status: 'ok' | 'fail' | 'warn' | 'skip';
  detail?: string;
  fix?: string;
}

export function printResult(result: CheckResult): void {
  switch (result.status) {
    case 'ok':
      ok(result.label, result.detail);
      break;
    case 'fail':
      fail(result.label, result.detail, result.fix);
      break;
    case 'warn':
      warn(result.label, result.detail, result.fix);
      break;
    case 'skip':
      info(result.label, result.detail ?? 'Skipped');
      break;
  }
}

/** 
 * Cinematic 2-second delay with a spinner for demo purposes 
 * Makes the tool feel like it's performing deep analysis.
 */
export async function diagnosticPulse(message = 'Analyzing Midnight environment...'): Promise<void> {
  const spinner = ['○', '◎', '◉', '●'];
  let i = 0;
  
  process.stdout.write(`\r  ${chalk.cyan(spinner[0])} ${chalk.dim(message)} `);
  
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${chalk.cyan(spinner[i++ % 4])} ${chalk.dim(message)} `);
  }, 150);

  return new Promise((resolve) => {
    setTimeout(() => {
      clearInterval(interval);
      process.stdout.write('\r' + ' '.repeat(process.stdout.columns ?? 80) + '\r');
      resolve();
    }, 1800); // ~2 second pulse
  });
}
