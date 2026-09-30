# Changelog

## Unreleased

### Added
- `ports` command: quick availability check for ports 6300, 8088, and 9944 (`--json` supported).
- `matrix` command: print the ledger / proof-server / SDK / compiler compatibility matrix (`--json` supported).
- `lint --json` for machine-readable output.
- `lint --strict` to exit non-zero when warnings are found; `lint` now exits non-zero on errors.
- New lint rule `assert-message`: flags `assert()` calls without a failure message.
- Every lint issue now carries a stable `rule` id.
- Windows support for identifying the process that holds a port (`netstat` + `tasklist`).
- `MEDIC_TIMEOUT_MS` environment variable to override network request timeouts.
- Vitest unit test suite and GitHub Actions CI (Linux + Windows, Node 18/20/22).

### Fixed
- `sync` now handles ledger version ranges such as `>=8.0.3` when looking up the compatibility matrix.

### Changed
- `.env` parsing is shared between `doctor` and `inspect`, and now supports `export` prefixes and CRLF files.
- README no longer uses emoji.

## 0.1.0

- Initial release: `doctor`, `sync`, `lint`, `inspect`, `logs`, `profile`, `trace`, `optimize`, `estimate`.
