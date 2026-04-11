# midnight-medic

Environment diagnostics, advanced ZK analysis, and state observability for Midnight Network developers.

## Installation

```bash
npm install -g midnight-medic
# or run without installing:
npx midnight-medic doctor
```

## Commands

### Environment & Diagnostics

#### `midnight-medic doctor`

Runs a full local environment scan before you start your DApp. Checks: Docker daemon, port conflicts, Indexer connectivity, Proof Server health, and wallet balances. Use `--export` for a Discord-friendly Markdown report.

```
midnight-medic doctor
```

#### `midnight-medic sync`

Detects version mismatches between your `@midnight-ntwrk/ledger-vX` SDK and your Docker Compose proof-server image. Use `--fix` to auto-resolve.

```
midnight-medic sync --fix
```

#### `midnight-medic lint [path]`

Statically analyzes your `.compact` files for common pre-compilation errors (e.g., missing `.disclose()`, pragma checks).

```
midnight-medic lint ./contract/src
```

---

### Advanced ZK Analysis (ZKIR)

#### `midnight-medic estimate [circuit-name]`

Calculates estimated DUST costs by deeply parsing compiled `.zkir` circuits. Breaks down base fees, circuit complexity, public transversals, and ledger storage.

```
midnight-medic estimate castPrivateVote
```

#### `midnight-medic optimize`

Scans all compiled `.zkir` files for redundant gates and optimization opportunities. Detects duplicate hashes, deep conditional branches, and excessive witness bloat, giving you actionable refactoring suggestions for your `.compact` files.

```
midnight-medic optimize
```

#### `midnight-medic profile`

Analyzes circuit weights by reverse-engineering ZKIR operation nodes. Outputs a visual flamegraph highlighting the heaviest mathematical operations and estimates proof generation time on local hardware.

```
midnight-medic profile
```

#### `midnight-medic trace [--circuit <name>]`

Tracks down cryptic ZK proof failures (like constraint violations or timeouts) by mapping runtime errors directly to your ZKIR graph and original `.compact` source code. Supports post-mortem static analysis or live Docker log monitoring.

```
midnight-medic trace
```

---

### State & Observability

#### `midnight-medic inspect [--db <path>]`

Decrypts and safely explores your local LevelDB private state store. Automatically locates your `.env` for the `WALLET_SEED`, resolves SDK paths, and prints your local DB in a structured, readable terminal tree.

```
midnight-medic inspect
```

#### `midnight-medic logs [container-name]`

Streams Proof Server logs but actually makes them readable. Filters out the noise, formats errors cleanly, and translates complex provers panics into human-readable action items.

```
midnight-medic logs
```

## Compatibility Matrix

| Ledger | Proof Server | SDK | Compiler |
| :--- | :--- | :--- | :--- |
| 8.0.3 | midnightntwrk/proof-server:8.0.3 | ^4.0.4 | 0.30.0 |
| 8.0.2 | midnightntwrk/proof-server:8.0.2 | ^4.0.3 | 0.29.0 |
| 7.1.0 | midnightntwrk/proof-server:7.1.0 | ^3.1.0 | 0.22.0 |

## License

MIT
