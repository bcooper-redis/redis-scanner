# Redis Discovery

Redis Discovery safely discovers Redis-compatible databases (Redis OSS, Redis Enterprise, Valkey, KeyDB where possible) on networks you are authorized to scan, and provides read-only inventory through a CLI and a lightweight Web UI. It never writes to a scanned instance, never stores or logs credentials, and never brute-forces passwords.

> **Only scan networks and hosts you are authorized to test.**

## Contents

- [Prerequisites](#prerequisites)
- [Install & build](#install--build)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Web UI guide](#web-ui-guide)
- [HTTP API](#http-api)
- [Security & responsible use](#security--responsible-use) (full detail in [SECURITY.md](SECURITY.md))
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Docker](#docker)

## Prerequisites

- Node.js 22 or later
- npm

## Install & build

```bash
git clone https://github.com/bcooper-redis/redis-discovery.git
cd redis-discovery
npm install
npm run build
```

`npm run build` compiles TypeScript to `dist/` and copies the Web UI's static assets (HTML/CSS/JS plus a locally-vendored copy of HTMX — no CDN, nothing is fetched from the network) into `dist/web/public/`.

Run the CLI directly:

```bash
node dist/cli/index.js --help
```

Or make `rscan` available as a command:

```bash
npm link          # from the project directory
rscan --help
```

## Quick start

Scan your local machine for Redis on the default port:

```bash
rscan scan -c 127.0.0.1/32
```

Scan a subnet across a few common ports:

```bash
rscan scan -c 10.0.0.0/24 -p 6379,6380-6385
```

No CIDR given? It auto-detects your local non-loopback subnets (capped at a /24 per interface) instead of scanning nothing:

```bash
rscan scan
```

Start the Web UI:

```bash
rscan serve
# then open http://localhost:3000
```

## CLI reference

### `rscan scan`

| Flag | Default | Description |
|---|---|---|
| `-c, --cidr <target>` | auto-detected local subnets | CIDR, IP, or hostname to scan. Repeatable: `-c 10.0.0.0/24 -c redis.example.com`. Hostnames are resolved via DNS (IPv4/A records only) and every resolved address is scanned. Add `:port` (e.g. `-c redis.example.com:6380`) to scan that target on a specific port instead of `-p`. |
| `-p, --port <ports>` | `6379` | Ports to scan — a single port, comma list, or ranges: `6379,6380-6385` |
| `-t, --timeout <ms>` | `1000` | Per-connection timeout in milliseconds |
| `--concurrency <n>` | `100` | Max concurrent connection attempts |
| `--tls` | off | Attempt TLS first; automatically falls back to plain on handshake failure |
| `--tls-skip-verify` | off | Skip TLS certificate verification (needed for self-signed certs) |
| `--username <user>` | — | ACL username for authentication; requires `--password` |
| `--password <pass>` | — | Password to authenticate with. Used only for this scan — never logged, printed, or persisted anywhere |
| `--format <format>` | `table` | Output format: `table`, `json`, `csv`, `ini`, or `xlsx` — the same shapes the Web UI's Results page exports, now available straight from the CLI |
| `--json` | off | Shorthand for `--format json`. Kept for backward compatibility; an explicit `--format` wins if both are given |

Progress and the final summary are written to stderr; results are written to stdout, so you can pipe just the data regardless of format — `csv`/`ini` are text, `xlsx` is binary, both write cleanly through a redirect:

```bash
rscan scan -c 10.0.0.0/24 --json > results.json
rscan scan -c 10.0.0.0/24 --format csv > results.csv
rscan scan -c 10.0.0.0/24 --format ini > config.ini
rscan scan -c 10.0.0.0/24 --format xlsx > results.xlsx
```

Exits `0` on a completed scan (including zero instances found) and `1` on a usage/input error (invalid CIDR, invalid port spec, `--username` without `--password`, or a CIDR range too large to scan — see [Troubleshooting](#troubleshooting)).

### `rscan credential-scan`

A different kind of scan: instead of sweeping a range and optionally authenticating with one shared credential, this scans an explicit list of known hosts from a CSV or INI file, each with its **own** username/password. Useful when you already have an inventory of hosts (e.g. from a CMDB) and a credential per host, and want inventory plus per-host auth success/failure in one pass.

| Flag | Default | Description |
|---|---|---|
| `-f, --file <path>` | — (required) | CSV file: `host,port,username,password` per line (`username`/`password` may be blank — that row is probed without attempting AUTH; a header row is fine and skipped automatically; a password containing a comma needs double quotes, e.g. `10.0.0.1,6379,,"p@ss,word"`) or an `.ini` file in the same format `rscan`'s own [Export INI](#web-ui-guide) produces. Format is chosen by file extension. |
| `-t, --timeout <ms>` | `1000` | Per-connection timeout in milliseconds |
| `--concurrency <n>` | `100` | Max concurrent connection attempts |
| `--tls` | off | Attempt TLS first; automatically falls back to plain on handshake failure |
| `--tls-skip-verify` | off | Skip TLS certificate verification (needed for self-signed certs) |
| `--format <format>` | `table` | Output format: `table`, `json`, `csv`, `ini`, or `xlsx` |
| `--json` | off | Shorthand for `--format json`. Kept for backward compatibility; an explicit `--format` wins if both are given |

```bash
rscan credential-scan -f known-hosts.csv --json > results.json
rscan credential-scan -f known-hosts.ini --format csv > results.csv
```

A malformed row/section (missing host, invalid port) is skipped with a warning on stderr rather than failing the whole file; the rest of the file still runs. Every row's credentials exist only for the single connection attempt that uses them — nothing here is retained afterward, matching `rscan scan --password`'s handling.

The INI format is designed for a round trip: run a regular scan, **Export INI** from the Results page (or `GET /api/export/ini`), fill in the blank `username`/`password` lines for whichever hosts you have credentials for in a text editor, then feed that same file back in here. The `tls`/`ca_cert`/`client_cert`/`client_key` fields in that file are ignored on read — TLS here is controlled by `--tls`/`--tls-skip-verify` same as everywhere else, and mTLS (client certs) isn't supported by this tool at all.

### `rscan serve`

| Flag | Default | Description |
|---|---|---|
| `--port <port>` | `3000` | HTTP port to listen on |
| `--host <host>` | `localhost` | HTTP host to bind |

```bash
rscan serve --port 8080 --host 0.0.0.0
```

The server is entirely local — it doesn't call out to any external service. Bind to `0.0.0.0` only if you understand you're exposing the scan/authenticate endpoints to your network.

## Web UI guide

Open the address `rscan serve` prints (default `http://localhost:3000`). Six links in the top nav:

- **Discover** — configure and start a scan: targets (CIDR ranges, bare IPs, or hostnames, one per line — hostnames are resolved via DNS and every resolved address is scanned), ports, timeout, concurrency, TLS options, and optional credentials for this scan only. Any target line may end in `:port` (e.g. `redis.example.com:6380`, or `10.0.0.0/24:6380`) to scan just that target on that port instead of the shared Ports field. Submitting takes you to Results. Non-credential fields are remembered for the rest of the browser tab's session (via `sessionStorage`), so navigating to Results and back doesn't lose what you typed — closing the tab or browser clears it.
  - **Upload CSV** — load targets from a CSV file instead of typing them: one target per line, `host` or `host,port` (a header row is skipped automatically). The file is read entirely in the browser and never uploaded to the server; it just replaces the Targets field, encoding each row with a port as `host:port` so that row is scanned on exactly its own port rather than every port seen in the file. It applies the same Timeout/Concurrency/TLS/credentials fields to every target — there's no way to give individual targets their own credentials via this form; that's what Credential Scan (below) is for.
- **Credential Scan** — a different kind of scan for a known list of hosts, each with its own username/password: upload a `host,port,username,password` CSV, **or** an INI file in the exact format Results' own Export INI produces below (the only two ways to supply targets here — `username`/`password` may be blank per row/section for an anonymous probe of that host), plus the same Timeout/Concurrency/TLS options as Discover, then submit. The INI path is meant for a round trip: run a scan, Export INI, fill in credentials for the hosts you need in a text editor, upload it back here. Like Discover's CSV upload, the file (either format) is parsed entirely in the browser; only the resulting host/port/username/password values are sent when you start the scan, never the raw file. Results land on the same Results page below, with the same table and export options — this scan type isn't visually distinct there, only distinguishable by its results actually authenticating per-row instead of anonymously. **Restart doesn't apply to a Credential Scan** and won't appear on Results afterward — each row's password exists only for the single request that used it, so there's nothing to replay; re-upload the file to run it again.
- **Results** — a target banner showing what's being (or was) scanned, live status and progress while a scan runs, then a table of discovered instances: host, port, product, version, TLS, auth status, role, mode, cluster state, connected replica count, what it's replicating from (for a replica), memory usage (used vs. configured max, or "no limit" when `maxmemory` is unset), key count, loaded modules, OS, uptime, latency, run ID, and TLS certificate + expiry. Each row has an **Authenticate** button that opens a dialog for that host's credentials — submitting re-probes with them and updates the row's inventory in place.
  - Below the table, **Export CSV**/**INI**/**XLSX** download the current (filtered, if "Hide duplicates" is checked — see below) results. **CSV** is a complete dump of every field the JSON API returns, not just what the table shows — this includes max memory (the configured `maxmemory` limit), peak used memory, total system memory, connected-client count, whether auth was required, full per-replica/per-database-keyspace/per-module detail (the table only shows counts/names), full cluster info (enabled/slots/known nodes/size, not just state), and the certificate's `validFrom` and SHA-256 fingerprint. **INI** produces a [config.ini](https://github.com/Redislabs-Solution-Architects/osstats) compatible with the `osstats` tool — one `[host:port]` section per result, pre-filled with `host`/`port`/`tls`; `username`/`password` are always left blank since Redis Discovery never retains credentials past the request that used them. This same file can be filled in with credentials and fed straight into **Credential Scan** (above) or `rscan credential-scan -f`. **XLSX** produces a file shaped like osstats' own `OSStats.xlsx` output — same sheet name (`ClusterData`) and column layout for the fields Redis Discovery's single probe actually knows (`Source`, `NodeId`, `NodeRole`, `RedisVersion`, `OS`, memory figures, `ConnectedSlaves`, `CurrItems`, `Namespaces`, ...). osstats' own output is mostly throughput/command-stats columns (`Throughput (Ops)`, `GetTypeCmds`, `SetTypeCmds`, ...) computed by holding a connection open, sampling `INFO COMMANDSTATS` twice several minutes apart, and subtracting — Redis Discovery does one point-in-time probe and never fabricates numbers for what it didn't measure, so those columns are omitted entirely rather than filled with 0 or blank.
  - **INI with credentials** — a separate button next to Export INI, for re-attaching credentials to an export. Clicking it warns that the resulting file will contain plaintext credentials, then lets you pick a CSV or INI file (e.g. one you filled in from an earlier Export INI); its `username`/`password` values are matched to the results below by host/port and merged into a freshly generated INI. This is entirely client-side — the file you pick, the merge, and the generated download all happen in the browser with no request to the server, so this doesn't change what the server itself ever stores: a plain **Export INI** (or the API) still always returns blank credentials. Handy for the iterate-on-credentials workflow: scan, Export INI, fill in a few passwords, Credential Scan that file, review which authenticated, then re-export **INI with credentials** from those same results before fixing just the ones that failed.
  - **TLS certificate info without credentials** — for any TLS target, the certificate's subject, issuer, expiry, and whether it's self-signed or CA-issued/trusted are read straight off the TLS handshake, independent of Redis-level auth. This is the one piece of real information available for a host that requires authentication you don't have — the "TLS Cert"/"Cert Expires" columns (and every other inventory column) still show `—` for that row, but the certificate columns don't, since the handshake already happened before AUTH was ever attempted.
  - **Same-database detection** — if two or more results report the same Run ID (Redis's own per-process identifier), that means the same database is reachable through more than one endpoint — for example, a Redis Enterprise database whose proxy answers on every cluster node, or (as happens on a machine with both Wi-Fi and Ethernet active on the same subnet) the same instance discovered via two of your own local addresses. A banner appears above the table with a **Hide duplicates** checkbox, **checked by default**, which collapses each such group down to a single representative row — this also strips the extra rows from Export CSV/INI/XLSX (as `&excludeDuplicates=true` on the underlying API calls). Uncheck it to see every endpoint each database was actually found at, with a "⚠ dup" badge and tooltip on each affected row's Run ID. The CLI always prints the full, un-collapsed list (no equivalent hide option there yet) and always warns on stderr when a scan turns up any duplicate group, regardless of `--format` — so the warning is visible even when stdout is redirected to a file. CSV/JSON/INI/XLSX rows still just carry the raw Run ID for each row so you can group them yourself.
  - **Pause** / **Resume** — freezes and resumes a running scan. Already-open connections finish naturally; nothing new starts until you resume.
  - **Stop** — ends the scan immediately, keeping whatever results were found so far.
  - **Restart** — re-runs the last scan's exact targets and options. Credentials are never persisted, so a restarted scan always runs anonymously — re-authenticate per host with the Authenticate button if needed. Not shown at all after a Credential Scan (see above) — its per-target passwords are never retained, so there's nothing to restart.
- **Settings** — non-sensitive scan defaults (ports, timeout, concurrency, TLS options) that pre-fill the Discover form. These are stored only in your browser's `localStorage` and are never sent anywhere until you actually start a scan. Credentials are never stored here or anywhere else.
- **About** — a summary of the tool's principles and non-goals.
- **Help** — opens the full user guide (`user-guide.html`) in a new tab. The guide itself is authored/maintained as a standalone file at the repo root (`redis_discovery_user_guide.html`) and copied into `dist/web/public/` at build time — see [scripts/copy-web-assets.js](scripts/copy-web-assets.js).

Only one scan runs at a time; starting a new one while another is in progress (scanning or paused) returns a conflict until it's finished or stopped.

## HTTP API

`rscan serve` exposes the same API the Web UI uses, if you want to script against it:

| Method & path | Purpose |
|---|---|
| `POST /api/scan` | Start a scan. Body: `{ cidrs?, ports?, timeoutMs?, concurrency?, tls?, tlsSkipVerify?, username?, password? }`. Returns `202` or `409` if one's already running or paused. |
| `POST /api/credential-scan` | Start a Credential Scan: an explicit, known-host list instead of a range, each target with its own credentials. Body: `{ targets: [{ host, port, username?, password? }, ...], timeoutMs?, concurrency?, tls?, tlsSkipVerify? }`. Same `202`/`409` semantics as `/api/scan`, plus `400` if `targets` is missing/empty or any entry has a bad host/port. Results land in the same shared state as a regular scan. |
| `POST /api/scan/pause` | Pause the running scan. `409` if none is running. |
| `POST /api/scan/resume` | Resume a paused scan. `409` if none is paused. |
| `POST /api/scan/stop` | Stop the running or paused scan, keeping results found so far. `409` if neither. |
| `POST /api/scan/restart` | Re-run the last scan's targets and options (never its credentials). `400` if there's no previous scan, `409` if one is currently running or paused. |
| `GET /api/results` | Current scan status (`idle`, `scanning`, `paused`, `done`, `error`, or `stopped`), progress, targets, and results. |
| `POST /api/authenticate` | Lightweight auth check against a single host — `{ host, port, username?, password }` → `{ authenticated, wrongPassword }`. Doesn't update scan state. |
| `POST /api/inventory` | Authenticate against a single host **and** return/update its full inventory — `{ host, port, username?, password }` → the updated result. This is what the Results page's Authenticate dialog uses. |
| `GET /api/export/csv` | Download current results as CSV. Add `?excludeDuplicates=true` to collapse each run_id-duplicate group to one row (see "Same-database detection" above). |
| `GET /api/export/ini` | Download current results as an [osstats](https://github.com/Redislabs-Solution-Architects/osstats)-compatible `config.ini` — one `[host:port]` section per result with `host`/`port`/`tls` filled in; `username`/`password` are always blank. Also supports `?excludeDuplicates=true`. |
| `GET /api/export/xlsx` | Download current results as an `.xlsx` shaped like osstats' own output (sheet `ClusterData`, same column layout) — populated only with fields Redis Discovery's single probe knows; osstats' throughput/command-stats columns are omitted, not faked. Also supports `?excludeDuplicates=true`. |

Credentials are accepted in request bodies (never in a URL) and are never echoed back in any response, logged, or persisted.

Each result's `inventory` includes `replication` (connected replicas, or master host/port/link status if this node is itself a replica), `memory` (used bytes, max memory, eviction policy), `keyspace` (per-database key/expiry counts), `modules` (name + version of anything loaded via `MODULE LIST`), `clusterInfo` (state and slot coverage, populated only when the node reports cluster mode), and `runId` (from `INFO`'s `run_id` — the same value across every endpoint that's actually the same running server; see "Same-database detection" above).

Each result also has a top-level `tlsCertificate` field — sitting *outside* `inventory`, not inside it, since it's read from the TLS handshake itself and stays populated even when `inventory` is `null` because auth is required. It's `null` for plaintext connections. Fields: `subject`, `issuer`, `validFrom`/`validTo`, `selfSigned` (issuer equals subject), `trusted` (chain validated against Node's CA store), and `fingerprint256`.

## Security & responsible use

> **Only scan networks and hosts you are authorized to test.**

Redis Discovery does a TCP connect scan, then — on open ports — a short, fixed sequence of read-only Redis commands (never more than `AUTH`, `PING`, `INFO`, `MODULE LIST`, `CLUSTER INFO`). It never sends a command that writes data, changes configuration, or alters cluster/replication state. Credentials are used for exactly one login attempt and are never logged, persisted, or echoed back. Everything lives in memory for the life of the process — no disk writes, no outbound calls to anything other than the hosts you asked it to scan.

**See [SECURITY.md](SECURITY.md) for the full security reference** — written for a security team evaluating this tool: the exact wire-level command sequence (verified via live capture), TLS/certificate verification behavior, credential lifecycle, data handling, and the Web UI's lack of built-in authentication (it has no access control of its own — read this before binding `rscan serve` to anything other than `localhost`).

## Troubleshooting

**"No Redis instances found."** — Ports are closed, filtered, or the timeout is too short for the network path. Try a larger `-t/--timeout`, confirm the target is reachable (`nc -zv <host> <port>`), and double-check the port list.

**A live Redis reports as "not Redis."** — If you're scanning through a restrictive ACL, confirm the account can at least run `INFO` (PING alone being denied is handled correctly and won't cause this). A closed port or a non-RESP service on that port will also show this way — that's by design.

**"Scan target too large: N hosts requested... (max 65536)."** — Your combined CIDR ranges exceed the safety cap. Scan a smaller or more specific range, or run multiple scans.

**"Could not resolve hostname ... ENOTFOUND" or the scan just fails when using a hostname target.** — The whole scan is rejected if any one hostname target fails to resolve, the same way an invalid CIDR is rejected. Double-check the spelling and that it resolves from this machine (`nslookup <hostname>` or `dig <hostname>`). Hostnames resolve to IPv4 addresses only (A records) — a host with only an IPv6 (AAAA) record won't resolve, since scanning is IPv4-only throughout.

**TLS scan falls back to plain unexpectedly.** — A TLS handshake failure (wrong port, non-TLS server, or an untrusted cert without `--tls-skip-verify`) causes an automatic fallback to a plain connection. If the plain attempt also fails, the host is reported as not found.

**`npm run build` says it can't find `node_modules/htmx.org`.** — Run `npm install` first; the build step vendors HTMX from `node_modules` and needs it installed.

**Web UI shows "Could not reach the server."** — `rscan serve` isn't running, or you navigated to a different port/host than it's bound to.

## Development

```bash
npm run typecheck        # tsc, both the app and test project
npm test                 # unit tests (mocked servers, no network required)
npm run test:integration # integration tests (spawns the built CLI, needs a live Redis)
npm run lint
npm run format            # or format:check
```

Integration tests default to a plain Redis on `127.0.0.1:6379` and Valkey on `127.0.0.1:6380`. Override or extend coverage with environment variables — all optional, tests requiring an unset one are skipped:

| Variable | Enables |
|---|---|
| `REDIS_8_PORT` | Redis target port (default `6379`) |
| `VALKEY_PORT` | Valkey target port (default `6380`) |
| `REDIS_7_HOST` / `REDIS_7_PORT` | Additional Redis 7.x coverage |
| `REDIS_TLS_HOST` / `REDIS_TLS_PORT` | TLS-enabled Redis coverage |
| `REDIS_AUTH_HOST` / `REDIS_AUTH_PORT` / `REDIS_AUTH_PASSWORD` | Password-protected Redis coverage |

Project layout: `src/scanner` (CIDR/port expansion, TCP probing, concurrency), `src/probe` (Redis protocol detection + INFO parsing), `src/inventory` (assembles the discovery pipeline), `src/cli`, `src/web` (Express API + static Web UI in `src/web/public/`), `src/export` (CSV).

## Docker

The `Dockerfile` builds entirely from local files — it doesn't need this repo to be on GitHub or any remote. It's a two-stage build: a `build` stage with full `npm ci` (TypeScript, and `htmx.org` — a devDependency whose only job is to be vendored into `dist/web/public/htmx.min.js` at build time) compiles the app, then a fresh `runtime` stage installs only production dependencies and copies in the compiled `dist/`. The final image never contains TypeScript, test files, or dev tooling.

```bash
docker build -t redis-discovery .
```

Runs the Web UI by default (the image's `ENTRYPOINT` is the CLI; the default `CMD` is `serve --host 0.0.0.0 --port 3000` — binding `0.0.0.0`, not `localhost`, is required so it's reachable from outside the container):

```bash
docker run --rm -p 3000:3000 redis-discovery
# open http://localhost:3000
```

Any extra arguments after the image name override the default `CMD`, so the same image runs one-shot scans too:

```bash
docker run --rm redis-discovery scan -c 10.0.0.0/24 -p 6379,6380
```

### The one thing that's genuinely different in a container: networking

Redis Discovery's core job is discovering what's on your network — and a container has its *own* network by default, not your machine's. This is the one place containerizing this specific tool needs extra thought, not just Docker boilerplate. Concretely, on this exact setup:

```
$ docker run --rm redis-discovery scan -c 127.0.0.1/32 -p 6379,6380
No Redis instances found.                     # the container's own loopback, not the host's

$ docker run --rm redis-discovery scan -p 6379  # no -c → auto-detects local subnets
Auto-detected CIDRs: 172.17.0.0/24            # Docker's internal bridge network, not your LAN

$ docker run --rm --network host redis-discovery scan -p 6379
Auto-detected CIDRs: 192.168.65.0/24, ...     # now it sees the real network
```

- **Scanning an explicit external target** (`-c <real-LAN-CIDR>`) generally works fine over the default bridge network — outbound connections are NAT'd through the host like any other container traffic.
- **Scanning `127.0.0.1` or letting it auto-detect local subnets** (omitting `-c`) reflects the *container's* loopback/network, not your machine's, unless you run with `--network host`. On Linux this shares the host's network namespace directly. On Docker Desktop (Mac/Windows) it's improved a lot in recent versions and worked correctly when tested above — but treat it as something to verify on your own Docker Desktop version rather than assumed.
- To reach a service on the host machine itself without `--network host`, use the special DNS name `host.docker.internal` — but resolve it to an IP first, since `-c` takes a literal CIDR, not a hostname:
  ```bash
  docker run --rm redis-discovery scan -c $(docker run --rm node:22-alpine node -e "require('dns').lookup('host.docker.internal',(e,a)=>console.log(a))")/32 -p 6379
  ```

If you're running the Web UI in a container and using its Discover page with a blank CIDR field (auto-detect), the same caveat applies — you'll see the container's network, not your LAN, unless you add `--network host` to the `docker run` command that starts it.
