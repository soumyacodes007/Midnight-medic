import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import yaml from 'js-yaml';
import { header, section, ok, fail, warn, info, divider } from '../ui/output.js';
import { COMPAT_MATRIX, findCompatEntry } from '../compat/matrix.js';
import chalk from 'chalk';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Extract ordered ledger version from package.json (e.g. '@midnight-ntwrk/ledger-v8' -> '8.0.3') */
function detectLedgerVersion(pkgJson: PackageJson): { packageName: string; version: string } | undefined {
  const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  for (const [name, version] of Object.entries(allDeps)) {
    if (name.match(/^@midnight-ntwrk\/ledger-v\d+$/)) {
      return { packageName: name, version: version.replace(/^\^|~/, '') };
    }
  }
  return undefined;
}

/** Find all docker-compose YAML files in the current directory. */
async function findYamlFiles(cwd: string): Promise<string[]> {
  return glob('**/*.yml', {
    cwd,
    ignore: ['node_modules/**', 'dist/**'],
    absolute: true,
  });
}

/** Extract proof-server image version from a YAML file. */
function extractProofServerImage(filePath: string): { image: string; file: string } | undefined {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content) as Record<string, any>;
    const services = parsed?.services as Record<string, any> | undefined;
    if (!services) return undefined;

    for (const svc of Object.values(services)) {
      const image = svc?.image as string | undefined;
      if (image?.includes('proof-server')) {
        return { image, file: path.basename(filePath) };
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Apply the version fix to the YAML file in place. */
function applyFix(filePath: string, currentImage: string, correctImage: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const updated = content.replaceAll(currentImage, correctImage);
    fs.writeFileSync(filePath, updated, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function runSync(options: { fix: boolean; cwd: string }): Promise<void> {
  header('Midnight Sync — checking version compatibility...');

  // ── Read package.json ──────────────────────────────────────────────────────
  const pkgPath = path.join(options.cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fail('package.json', 'Not found in current directory');
    return;
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson;
  const ledgerInfo = detectLedgerVersion(pkgJson);

  if (!ledgerInfo) {
    warn('Ledger SDK', 'No @midnight-ntwrk/ledger-vX package found in dependencies');
    info('Hint', 'This tool works best inside a Midnight project directory');
    return;
  }

  section('Detected Packages');
  ok(ledgerInfo.packageName, ledgerInfo.version);

  const entry = findCompatEntry(ledgerInfo.version);
  if (!entry) {
    warn(
      'Compatibility',
      `No compatibility entry found for ledger ${ledgerInfo.version}`,
      `Check the matrix at: https://docs.midnight.network`,
    );
    console.log(chalk.dim(`\n  Known versions: ${COMPAT_MATRIX.map((e) => e.ledgerVersion).join(', ')}`));
    return;
  }

  ok('Expected Proof Server', entry.proofServerImage);
  ok('Expected SDK', entry.sdkVersion);
  ok('Expected Compiler', entry.compilerVersion);

  // ── Scan YAML files ────────────────────────────────────────────────────────
  section('Docker Compose Files');
  const yamlFiles = await findYamlFiles(options.cwd);

  let issueCount = 0;
  let fixedCount = 0;

  for (const filePath of yamlFiles) {
    const found = extractProofServerImage(filePath);
    if (!found) continue;

    if (found.image === entry.proofServerImage) {
      ok(found.file, `${found.image} (compatible)`);
    } else {
      issueCount++;
      fail(
        found.file,
        `Found '${found.image}', expected '${entry.proofServerImage}'`,
        options.fix
          ? undefined
          : `Run: midnight-medic sync --fix to update ${found.file}`,
      );

      if (options.fix) {
        const fixed = applyFix(filePath, found.image, entry.proofServerImage);
        if (fixed) {
          ok(`  Fixed ${found.file}`, `Updated to ${entry.proofServerImage}`);
          fixedCount++;
        } else {
          fail(`  Could not fix ${found.file}`, 'Permission error or parse failure');
        }
      }
    }
  }

  if (yamlFiles.length === 0 || issueCount === 0 && fixedCount === 0) {
    info('No docker-compose files with proof-server found');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  divider();
  if (issueCount === 0) {
    console.log(`  ${chalk.green('[✓]')} ${chalk.bold('All versions are compatible.')}`);
  } else if (options.fix) {
    console.log(`  Result: ${fixedCount} issue${fixedCount !== 1 ? 's' : ''} fixed.`);
  } else {
    console.log(
      `  Result: ${chalk.red(`${issueCount} issue${issueCount !== 1 ? 's' : ''} found`)}. Run with --fix to apply.`,
    );
  }
  console.log('');
}
