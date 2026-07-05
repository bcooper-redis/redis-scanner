# Redis Scanner

Redis Scanner safely discovers Redis-compatible databases (Redis OSS, Redis Enterprise, Valkey, KeyDB where possible) on networks you are authorized to scan, and provides read-only inventory through a CLI and a lightweight Web UI. It never writes to a scanned instance, never stores or logs credentials, and never brute-forces passwords.

> **Only scan networks and hosts you are authorized to test.**

## Contents

- [Prerequisites](#prerequisites)
- [Install & build](#install--build)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Web UI guide](#web-ui-guide)
- [HTTP API](#http-api)
- [Security & responsible use](#security--responsible-use)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Docker](#docker)

## Prerequisites

- Node.js 22 or later
- npm

## Install & build

```bash
git clone <this repo>
cd RedisScanner
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
| `-c, --cidr <target>` | auto-detected local subnets | CIDR, IP, or hostname to scan. Repeatable: `-c 10.0.0.0/24 -c redis.example.com`. Hostnames are resolved via DNS (IPv4/A records only) and every resolved address is scanned. |
| `-p, --port <ports>` | `6379` | Ports to scan — a single port, comma list, or ranges: `6379,6380-6385` |
| `-t, --timeout <ms>` | `1000` | Per-connection timeout in milliseconds |
| `--concurrency <n>` | `100` | Max concurrent connection attempts |
| `--tls` | off | Attempt TLS first; automatically falls back to plain on handshake failure |
| `--tls-skip-verify` | off | Skip TLS certificate verification (needed for self-signed certs) |
| `--username <user>` | — | ACL username for authentication; requires `--password` |
| `--password <pass>` | — | Password to authenticate with. Used only for this scan — never logged, printed, or persisted anywhere |
| `--json` | off | Print results as a JSON array instead of a table |

Progress and the final summary are written to stderr; results (table or JSON) are written to stdout, so you can pipe just the data:

```bash
rscan scan -c 10.0.0.0/24 --json > results.json
```

Exits `0` on a completed scan (including zero instances found) and `1` on a usage/input error (invalid CIDR, invalid port spec, `--username` without `--password`, or a CIDR range too large to scan — see [Troubleshooting](#troubleshooting)).

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

Open the address `rscan serve` prints (default `http://localhost:3000`). Four pages, linked from the top nav:

- **Dashboard** — configure and start a scan: targets (CIDR ranges, bare IPs, or hostnames, one per line — hostnames are resolved via DNS and every resolved address is scanned), ports, timeout, concurrency, TLS options, and optional credentials for this scan only. Submitting takes you to Results. Non-credential fields are remembered for the rest of the browser tab's session (via `sessionStorage`), so navigating to Results and back doesn't lose what you typed — closing the tab or browser clears it.
  - **Upload CSV** — load targets from a CSV file instead of typing them: one target per line, `host` or `host,port` (a header row is skipped automatically). The file is read entirely in the browser and never uploaded to the server; it just replaces the Targets field and merges any ports found into the Ports field, applying the same Timeout/Concurrency/TLS/credentials fields to every target — there's no way yet to give individual targets their own credentials via the file.
- **Results** — a target banner showing what's being (or was) scanned, live status and progress while a scan runs, then a table of discovered instances: host, port, TLS, product, version, auth status, role, mode, cluster state, connected replica count, memory usage, key count, loaded modules, OS, uptime, and latency. Each row has an **Authenticate** button that opens a dialog for that host's credentials — submitting re-probes with them and updates the row's inventory in place. **Export CSV** downloads the current results with the same columns.
  - **Pause** / **Resume** — freezes and resumes a running scan. Already-open connections finish naturally; nothing new starts until you resume.
  - **Stop** — ends the scan immediately, keeping whatever results were found so far.
  - **Restart** — re-runs the last scan's exact targets and options. Credentials are never persisted, so a restarted scan always runs anonymously — re-authenticate per host with the Authenticate button if needed.
- **Settings** — non-sensitive scan defaults (ports, timeout, concurrency, TLS options) that pre-fill the Dashboard form. These are stored only in your browser's `localStorage` and are never sent anywhere until you actually start a scan. Credentials are never stored here or anywhere else.
- **About** — a summary of the tool's principles and non-goals.

Only one scan runs at a time; starting a new one while another is in progress (scanning or paused) returns a conflict until it's finished or stopped.

## HTTP API

`rscan serve` exposes the same API the Web UI uses, if you want to script against it:

| Method & path | Purpose |
|---|---|
| `POST /api/scan` | Start a scan. Body: `{ cidrs?, ports?, timeoutMs?, concurrency?, tls?, tlsSkipVerify?, username?, password? }`. Returns `202` or `409` if one's already running or paused. |
| `POST /api/scan/pause` | Pause the running scan. `409` if none is running. |
| `POST /api/scan/resume` | Resume a paused scan. `409` if none is paused. |
| `POST /api/scan/stop` | Stop the running or paused scan, keeping results found so far. `409` if neither. |
| `POST /api/scan/restart` | Re-run the last scan's targets and options (never its credentials). `400` if there's no previous scan, `409` if one is currently running or paused. |
| `GET /api/results` | Current scan status (`idle`, `scanning`, `paused`, `done`, `error`, or `stopped`), progress, targets, and results. |
| `POST /api/authenticate` | Lightweight auth check against a single host — `{ host, port, username?, password }` → `{ authenticated, wrongPassword }`. Doesn't update scan state. |
| `POST /api/inventory` | Authenticate against a single host **and** return/update its full inventory — `{ host, port, username?, password }` → the updated result. This is what the Results page's Authenticate dialog uses. |
| `GET /api/export/csv` | Download current results as CSV. |

Credentials are accepted in request bodies (never in a URL) and are never echoed back in any response, logged, or persisted.

Each result's `inventory` includes `replication` (connected replicas, or master host/port if this node is itself a replica), `memory` (used bytes, max memory, eviction policy), `keyspace` (per-database key/expiry counts), `modules` (name + version of anything loaded via `MODULE LIST`), and `clusterInfo` (state and slot coverage, populated only when the node reports cluster mode).

## Security & responsible use

- **Read-only by default** — no data-modifying Redis commands are ever sent.
- **No credential persistence** — passwords are used only for the request in flight.
- **No credential storage or logging** in Redis Scanner's own code — verified by code review; passwords never appear in a URL, a log line, or a thrown error message.
- **No brute-force, no scheduled scans, no command console** — out of scope by design.
- **Scan-size guard** — a single scan is capped at 65,536 combined hosts across all CIDRs, to prevent an oversized range (e.g. a `/8`) from exhausting memory before scanning even starts. If you hit "Scan target too large," narrow your CIDR or split it into multiple smaller scans.
- **One operational caveat outside Redis Scanner's control**: the underlying `ioredis` library can print command arguments — including AUTH credentials — to stderr if you set the `DEBUG=ioredis:*` environment variable yourself. Redis Scanner never sets this. Don't enable it while scanning with credentials.

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
docker build -t redis-scanner .
```

Runs the Web UI by default (the image's `ENTRYPOINT` is the CLI; the default `CMD` is `serve --host 0.0.0.0 --port 3000` — binding `0.0.0.0`, not `localhost`, is required so it's reachable from outside the container):

```bash
docker run --rm -p 3000:3000 redis-scanner
# open http://localhost:3000
```

Any extra arguments after the image name override the default `CMD`, so the same image runs one-shot scans too:

```bash
docker run --rm redis-scanner scan -c 10.0.0.0/24 -p 6379,6380
```

### The one thing that's genuinely different in a container: networking

Redis Scanner's core job is discovering what's on your network — and a container has its *own* network by default, not your machine's. This is the one place containerizing this specific tool needs extra thought, not just Docker boilerplate. Concretely, on this exact setup:

```
$ docker run --rm redis-scanner scan -c 127.0.0.1/32 -p 6379,6380
No Redis instances found.                     # the container's own loopback, not the host's

$ docker run --rm redis-scanner scan -p 6379  # no -c → auto-detects local subnets
Auto-detected CIDRs: 172.17.0.0/24            # Docker's internal bridge network, not your LAN

$ docker run --rm --network host redis-scanner scan -p 6379
Auto-detected CIDRs: 192.168.65.0/24, ...     # now it sees the real network
```

- **Scanning an explicit external target** (`-c <real-LAN-CIDR>`) generally works fine over the default bridge network — outbound connections are NAT'd through the host like any other container traffic.
- **Scanning `127.0.0.1` or letting it auto-detect local subnets** (omitting `-c`) reflects the *container's* loopback/network, not your machine's, unless you run with `--network host`. On Linux this shares the host's network namespace directly. On Docker Desktop (Mac/Windows) it's improved a lot in recent versions and worked correctly when tested above — but treat it as something to verify on your own Docker Desktop version rather than assumed.
- To reach a service on the host machine itself without `--network host`, use the special DNS name `host.docker.internal` — but resolve it to an IP first, since `-c` takes a literal CIDR, not a hostname:
  ```bash
  docker run --rm redis-scanner scan -c $(docker run --rm node:22-alpine node -e "require('dns').lookup('host.docker.internal',(e,a)=>console.log(a))")/32 -p 6379
  ```

If you're running the Web UI in a container and using its Dashboard with a blank CIDR field (auto-detect), the same caveat applies — you'll see the container's network, not your LAN, unless you add `--network host` to the `docker run` command that starts it.
