# Contributing to midnight-medic

Thanks for helping make Midnight development less painful.

## Setup

```bash
npm install
npm run dev -- doctor     # run the CLI from source
npm run lint              # type check
npm test                  # unit tests (vitest)
npm run build             # bundle to dist/
```

## Project layout

| Path | Purpose |
| :--- | :--- |
| `src/index.ts` | CLI entry point and command registration (commander) |
| `src/commands/` | One file per CLI command |
| `src/checks/` | Environment probes (Docker, ports, network, wallet) |
| `src/lint/rules.ts` | Pure Compact lint rules, each returning `LintIssue`s |
| `src/compat/matrix.ts` | Ledger / proof-server / SDK / compiler compatibility table |
| `src/utils/` | Small shared helpers (env parsing, semver) |
| `src/ui/output.ts` | Terminal formatting helpers |
| `test/` | Vitest unit tests, mirroring the `src/` layout |

## Adding a lint rule

1. Add a function to `src/lint/rules.ts` that takes `(lines, file)` and returns `LintIssue[]`.
2. Add its id to the `LintRule` union.
3. Call it from `lintFile()` in `src/commands/lint.ts`.
4. Add a test file under `test/lint/`.

## Updating the compatibility matrix

Add a new entry at the top of `COMPAT_MATRIX` in `src/compat/matrix.ts`, then update the table in `README.md`.
The matrix tests check that each proof-server image tag matches its ledger version.

## Commit style

Use short conventional prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`.
