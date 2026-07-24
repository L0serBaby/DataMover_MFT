# DataMover

A self-hosted Managed File Transfer (MFT) server for Windows — a lightweight, no-database alternative to commercial MFT tools like GlobalScape EFT for internal file movement and SFTP automation.

DataMover runs as a Windows Service on portable Node.js, stores all state in JSON flat files, and serves a browser-based admin UI over HTTPS. No installer, no SQL Server, no Docker — just xcopy-deploy a folder and go.

## Features

- **Transfer rules** — copy, move, or delete-on-schedule between local paths, UNC shares, and SFTP servers, with glob filters, date filters, and fan-out to multiple destinations
- **Scheduling** — cron expressions or a built-in visual schedule builder (daily/weekly/monthly/yearly), with explicit IANA timezone support so "8am" always means the timezone you configured, not the server's OS clock
- **PGP** — encrypt, decrypt, and sign files in-line as part of a transfer, plus key generation/import/export
- **Zip/unzip** — per-file compression, multi-file bundling, or unzip-on-receipt
- **SSH key management** — generate or import RSA 4096 / Ed25519 keypairs for SFTP key-based auth
- **Rule chaining** — trigger follow-on rules or standalone PGP steps on success/failure
- **Tagging** — organize rules and groups with predefined-key, freeform-value tags and combinable filters
- **Full job history** — per-file, per-destination results with searchable/filterable run history
- **Local auth** — session-based login, bcrypt-hashed passwords, no external identity provider required

## Requirements

- Windows Server 2019 (or compatible Windows host)
- A portable Node.js build placed in `runtime\` (download separately — not committed to this repo)
- NSSM placed in `nssm\` if you want to install DataMover as a Windows Service (download separately — not committed to this repo)
- No database, no Docker, no IIS required (though DataMover can run behind an IIS reverse proxy for TLS termination if preferred)

## Setup

1. Clone this repo
2. Download a portable Node.js Windows build (node.exe + npm) and place it in `runtime\`
3. Run `runtime\npm.cmd install` from the project root to install dependencies
4. Run `first-run.bat` to start the server directly (useful for testing before installing as a service)
5. Open `https://localhost:<port>` in a browser (default port is set in `data\config.json`, falls back to HTTP if no TLS cert/PFX is configured)
6. Log in with the default admin account — **username `admin`, password `changeme123`** — and change the password immediately under Settings

## Installing as a Windows Service

Download [NSSM](https://nssm.cc/) and place `nssm.exe` in `nssm\`, then run:

```
install-service.bat
```

This registers DataMover as a Windows Service named `DataMover` using NSSM, configured to run under the designated service account with automatic restart on failure. Edit `install-service.bat` first to set your own service account.

Service management:
```
net start DataMover
net stop DataMover
```

## Configuration

All configuration lives in `data\config.json`, editable via the Settings page in the UI or by hand:

- `PORT` — listening port (default 3000)
- `SSL_PFX` / `SSL_PFX_PASS` — PKCS#12 certificate (takes priority over PEM)
- `SSL_CERT` / `SSL_KEY` — PEM certificate + key (defaults to `certs\server.crt` / `certs\server.key`)
- `SESSION_TIMEOUT_MINUTES` — UI session length (takes effect after a service restart)
- `LOG_RETENTION_DAYS` — how long rotated logs are kept
- `SCHEDULE_TIMEZONE` — IANA timezone (e.g. `America/Phoenix`) used to interpret rule schedules; defaults to the server OS's local timezone if unset

If no TLS certificate is configured, DataMover falls back to plain HTTP.

## Data & Logs

- `data\` — all application state: profiles, rules, schedules, job history, encrypted credentials, users. Not committed to this repo — persists locally and across deployments.
- `logs\` — daily rotating log files. Not committed to this repo.

Back up the `data\` folder before any upgrade.

## Upgrading

Deployments are xcopy-style: pull the latest code over the existing installation, excluding `data\` and `logs\` so operational state and credentials persist. Stop the service first, update, then restart:

```
net stop DataMover
:: pull latest code, skipping data\ and logs\
net start DataMover
```

## License

MIT — see [LICENSE](LICENSE).
