# midnight-medic

Environment diagnostics, version sync, and Compact linting for Midnight Network developers.

## Installation

```bash
npm install -g midnight-medic
# or run without installing:
npx midnight-medic doctor
```

## Commands

### `midnight-medic doctor`

Runs a full local environment scan before you start your DApp.

Checks: Docker daemon, port conflicts (6300, 8088, 9944), Preprod/Preview Indexer connectivity, Proof Server health, and your wallet balance.

```
midnight-medic doctor
```

Use `--export` to copy a Markdown-formatted report to your clipboard (perfect for Discord support threads):

```
midnight-medic doctor --export
```

```
Midnight Doctor — running environment scan...

  Docker
  [✓] Daemon: Running (v27.0.3)

  Ports
  [x] 6300 (proofServer): Occupied by 'node' (pid 14221)
      --> kill -9 14221  (or: docker stop <container-name>)
  [✓] 8088 (indexer): Available
  [✓] 9944 (node): Available

  Network
  [✓] Preprod Indexer: Reachable (https://indexer.preprod...)
  [!] Preview Indexer: Timeout (>4000ms)

  Proof Server
  [✓] Proof Server (localhost:6300): Healthy (v8.0.3)

  Wallet
  [!] Wallet (WALLET_SEED): mn_addr_preprod1jj9q... has 0 tNight
      --> Visit: https://faucet.preprod.midnight.network to fund your wallet

  ------------------------------------------------------------
  Result: 1 error, 2 warnings.
```

---

### `midnight-medic sync`

Detects version mismatches between your `@midnight-ntwrk/ledger-vX` SDK and your Docker Compose proof-server image.

```
midnight-medic sync
```

Add `--fix` to automatically update your YAML files:

```
midnight-medic sync --fix
```

```
Midnight Sync — checking version compatibility...

  Detected Packages
  [✓] @midnight-ntwrk/ledger-v8: 8.0.3
  [✓] Expected Proof Server: midnightntwrk/proof-server:8.0.3
  [✓] Expected SDK: ^4.0.4
  [✓] Expected Compiler: 0.30.0

  Docker Compose Files
  [x] proof-server.yml: Found 'midnightntwrk/proof-server:8.0.2', expected '...8.0.3'
      --> Run: midnight-medic sync --fix to update proof-server.yml

  ------------------------------------------------------------
  Result: 1 issue found. Run with --fix to apply.
```

---

### `midnight-medic lint [path]`

Statically analyzes your `.compact` files for common pre-compilation errors.

```
midnight-medic lint ./contract/src
```

```
Midnight Lint — scanning Compact contracts...
  (Note: Static pattern-matching. Always defer to the Compact compiler.)

  game.compact
  [✓] Pragma: Valid version directive found
  [!] Line 42: 'playerKey' used in ledger assignment — may need .disclose()
      --> Consider: ledger.field = disclose(playerKey)
  [!] Line 88: Constructor declares 2 arg(s): [creator, maxPlayers] — ensure api.ts passes 'args: [...]'

  ------------------------------------------------------------
  Result: 2 warnings.
```

## Compatibility Matrix

| Ledger | Proof Server | SDK | Compiler |
| :--- | :--- | :--- | :--- |
| 8.0.3 | midnightntwrk/proof-server:8.0.3 | ^4.0.4 | 0.30.0 |
| 8.0.2 | midnightntwrk/proof-server:8.0.2 | ^4.0.3 | 0.29.0 |
| 7.1.0 | midnightntwrk/proof-server:7.1.0 | ^3.1.0 | 0.22.0 |

## License

MIT
