export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Strip range operators and whitespace from a version specifier.
 * '^4.0.4' -> '4.0.4', '>=0.20' -> '0.20', '~ 8.0.3' -> '8.0.3'
 */
export function cleanVersion(spec: string): string {
  return spec.trim().replace(/^[\^~><=v\s]+/, '');
}

/** Parse a loose semver string. Missing minor/patch components default to 0. */
export function parseVersion(spec: string): ParsedVersion | undefined {
  const match = cleanVersion(spec).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

/** Compare two versions. Returns a negative number if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}
