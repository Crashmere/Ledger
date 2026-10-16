# Ledger Deployment and Maintenance

The public entry point uses HTTPS with a trusted IP certificate and retains the existing `/ledger/` path. Public HTTP returns 308; API clients use HTTPS directly. Nginx overwrites `X-Forwarded-Proto`. Write-origin validation trusts the proxy header only from loopback addresses and still rejects cross-site origins. See [Shared HTTPS Operations](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/https.md) (server copy: `/opt/server-context/references/https.md`) for certificates, renewal, rollback, and whole-server acceptance. This project's backend and release checks retain local HTTP; the proxy inspection entry point at `127.0.0.1:80` is not publicly reachable. Public access uses shared ServerPortal device authentication: enter the passphrase at `/portal/login` to authorize a device, then use the same-origin Secure/HttpOnly Cookie. Unauthorized APIs return 401. Local release checks and service-to-service calls remain available.

This document covers Ledger itself. Read the [documentation entry point](README.md) first. For shared host, Nginx server, and cross-project rules, see `/opt/server-context/SKILL.md` or the [server-operations source](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/SKILL.md). Do not use this project's configuration to overwrite shared entry points for other applications.

Contents: [Current Deployment](#current-deployment) · [Read-Only Inspection](#read-only-inspection) · [Building and First-Time Installation](#building-and-first-time-installation) · [Backups](#backups) · [Restoration](#restoration) · [Program and Configuration Updates](#program-and-configuration-updates) · [Database Upgrade](#database-upgrade) · [Documentation Synchronization](#documentation-synchronization) · [Troubleshooting](#troubleshooting)

Request size: both the Nginx and JSON limits are 2 MiB. The shared authentication subrequest does not impose another body limit. If a request larger than 1 MiB returns 500, troubleshoot it according to [shared authentication mistakenly blocking large requests](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证误拦大请求). This application remains responsible for business-field and size validation.

<a id="当前部署"></a>

## Current Deployment

Live environment last checked: 2026-09-27. Use the commands below to inspect the version, PID, disk usage, and latest backup filename rather than hard-coding volatile values in this document.

```text
Browser /ledger/ → shared Nginx HTTPS :443 → Go 127.0.0.1:18080 → SQLite file
```

Administrators use the SSH alias `ali`; the real address is maintained in local SSH configuration. The service uses an IP certificate and shared device authentication, with no domain. Authorized devices may read and write. The Go binary embeds the Vue pages, so the server does not need a frontend process, Go compiler, Docker, or database service. Consult the shared inventory for software present for other purposes.

```text
/opt/ledger/
  AGENTS.md                  Project maintenance entry point
  bin/ledger                 Running program with embedded Vue
  bin/backup.sh              Daily consistent backup and rotation
  bin/deploy-ssh.sh          Restricted SSH release entry point
  bin/deploy-release.sh      Fixed root-managed release script
  config/ledger.env          Listener, database, program, and backup paths
  config/nginx-location.conf Reverse proxy for /ledger/
  config/ledger.service      Persistent program
  config/ledger-backup.service
  config/ledger-backup.timer
  data/ledger.sqlite         Only authoritative ledger; may have -wal and -shm companions
  backups/                   Daily, manual, and pre-release backups
  current-commit             Git commit corresponding to the current program
  releases/                  Program, previous version, and result for each local release
  docs/                      Current project docs and SOURCE origin marker
  deploy-user/.ssh/          Dedicated local release public key and forced-command configuration
```

| Object | Owner and responsibility |
| --- | --- |
| `bin`, `config`, `docs`, `AGENTS`, release directories | Managed by root; the application cannot arbitrarily rewrite programs or configuration |
| `data`, `backups` | `ledger:ledger`, directories mode 0700; real data must not enter Git |
| `ledger.service` | `User/Group=ledger`, `ExecStart=/opt/ledger/bin/ledger serve`, automatically restarts after abnormal exit; systemd allows writes only to `data` |
| `ledger-backup.service` | Runs backup as `ledger`, may write `data`/`backups`, and exits after completion |
| `ledger-deploy` | Dedicated release identity, not an administrator interactive shell; see `DEPLOYMENT` for permissions |

Actual env (currently contains no secrets):

```text
LEDGER_ADDR=127.0.0.1:18080
LEDGER_DB=/opt/ledger/data/ledger.sqlite
LEDGER_BINARY=/opt/ledger/bin/ledger
LEDGER_BACKUP_DIR=/opt/ledger/backups
LEDGER_FABRICWORLD_URL=http://127.0.0.1:18082
```

systemd units are linked from `/etc/systemd/system/ledger*` to `config`. Nginx's `/etc/nginx/app-locations/ledger.conf` links to this project's location. `/ledger` returns 308 to `/ledger/`; the trailing `/` in the proxy address strips the prefix and preserves `Host`. The maintained source for the global server is not in the Ledger repository. Different paths on the same IP still share a browser origin and are not security isolation.

<a id="只读查看"></a>

## Read-Only Inspection

Run `ssh ali` locally first. The current administrator is root, so the following inspection commands omit sudo; an ordinary account may need permission to read logs and private directories.

```sh
systemctl status ledger nginx --no-pager
systemctl cat ledger
cat /opt/ledger/config/ledger.env
ps -u ledger -o pid,ppid,%cpu,%mem,etime,args
journalctl -u ledger -n 50 --no-pager
curl --fail http://127.0.0.1:18080/healthz
curl --fail http://127.0.0.1/ledger/healthz
ls -lh /opt/ledger/data/
du -sh /opt/ledger/data/ /opt/ledger/backups/ /opt/ledger/releases/
cat /opt/ledger/current-commit
cat /opt/ledger/docs/SOURCE
```

Both health interfaces should return `{"status":"ok"}`. Use `journalctl -u ledger -f` for live journal follow; Ctrl+C exits only the viewer, and q exits `less`. Inspect Nginx requests in `/var/log/nginx/access.log` and `error.log`, not only the Nginx journal.

SQLite has no separate process or service. The current host does not have the `sqlite3` CLI installed, so do not assume it is available. Do not `cat` the database, delete WAL/SHM files, or back up only the main file of an active database. The application's integrity check does not modify ledger entries but may access SQLite auxiliary files:

```sh
runuser -u ledger -- /opt/ledger/bin/ledger check --db /opt/ledger/data/ledger.sqlite
```

A successful check produces no output and exits 0; do not mistake no output for non-execution.

<a id="构建与首次安装"></a>

## Building and First-Time Installation

This applies only to a new, empty application directory. For an existing Ledger update, use the release process below. Do not rerun first-time installation or overwrite production data with another snapshot.

On a development computer with the relevant toolchains, prepare dependencies according to `go.mod` and `web/package-lock.json`, then build:

```sh
make linux BASE_PATH=/ledger/
```

The output `bin/ledger-linux-amd64` is a single Linux amd64 file. SQLite is pure Go and does not require CGO. `BASE_PATH` sets static assets, Vue Router, and the API prefix together; internal Go routes do not change. A local root-path build defaults to `/`.

Upload the binary, source `deploy/`, and initial data to a separate staging directory, then verify provenance and hashes. Choose one initial-data path:

- To preserve existing data, use a consistent backup verified with Ledger maintenance tools.
- For a new instance explicitly intended to have no history, run `./ledger-linux-amd64 init --db ./initial.sqlite` in the staging directory. Never handle a missing database this way inside an existing production directory.

Run in the server staging directory (the following includes write operations):

```sh
sudo bash deploy/install.sh ./ledger-linux-amd64 ./initial.sqlite
sudo systemctl status ledger --no-pager
sudo systemctl list-timers ledger-backup.timer --no-pager
curl --fail http://127.0.0.1:18080/healthz
```

Adjust the initial filename to the actual file. The installation script exits if `/opt/ledger`, an old data location, a Ledger unit, or occupied port 18080 already exists. It creates users, directories, and configuration; uses `restore` to create the authoritative consistent copy; enables the service and timer; and performs the first backup. It does not install Nginx or modify the shared entry point.

First establish the apps server according to the shared rebuilding guide, then enable this application. If the link already exists, inspect it rather than overwriting it forcibly:

```sh
sudo install -d -m 0755 /etc/nginx/app-locations
sudo ln -s /opt/ledger/config/nginx-location.conf /etc/nginx/app-locations/ledger.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail http://127.0.0.1/ledger/healthz
curl --fail http://127.0.0.1/ledger/search
```

Check the resource prefix and public access; port 18080 must not be publicly open. Verify cloud-side permissions according to the shared guide. Then configure [local release](DEPLOYMENT.md), update the shared application inventory, and run `sync-docs.sh Ledger` to synchronize documentation. The first-time installation script does not automatically configure the release identity or synchronize documentation.

<a id="备份"></a>

## Backups

`ledger-backup.timer` runs every day at 03:00 Beijing time with up to five minutes of randomized delay and catches up after missed runs. The script uses `VACUUM INTO` to create a consistent snapshot containing committed WAL content. After integrity and foreign-key checks pass, it retains the latest 14 `daily-*.sqlite` files. Pre-release backups rotate under the shared release-retention policy; manual backups are not cleaned automatically.

Inspect schedule and results:

```sh
systemctl list-timers ledger-backup.timer --no-pager
systemctl cat ledger-backup.timer ledger-backup.service
journalctl -u ledger-backup.service -n 30 --no-pager
ls -lht /opt/ledger/backups/
```

It is normal for the backup service to show inactive after it completes; inspect the journal and `Result` for failure. Backup filenames use UTC and may be one date earlier than Beijing time. The following command immediately creates one daily backup and rotates the oldest one according to the policy:

```sh
sudo systemctl start ledger-backup.service
```

For an individual manual backup, run `ledger backup --db <production-path> --out <nonexistent-unique-backup-path>` as user `ledger`; the destination cannot overwrite an existing file. Automatic backups reside on the same disk. On 2026-09-27, a separate all-application data archive was downloaded to the maintenance computer and verified; see the [shared backup note](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/current-state.md#手工数据归档). This application's scripts do not proactively synchronize off-host. The server also has Alibaba Cloud file backup; see [host cloud backup](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/current-state.md#云备份) for scope, 30-day retention, and restoration limits. Transfer only completed backup files when needed; never upload them to the source repository or a publicly served web directory.

<a id="恢复"></a>

## Restoration

Restoration discards ledger entries created after the selected backup. Confirm the source, recovery point, and downtime scope first. Do not overwrite the live database in place or treat automatic program rollback as database restoration.

1. Confirm that no release is active and coordinate the GitHub release and maintenance window. Prepare unique destination names that do not already exist.
2. Validate the selected backup with the application's `check --db <selected-backup>`, then run `restore --from <backup> --db /opt/ledger/data/<unique-restoration-file>.sqlite` as user `ledger` and validate the new file.
3. Stop `ledger-backup.timer`, `ledger-backup.service`, and `ledger.service` to prevent writes during maintenance.
4. Use the old program to create a consistent `before-restore-<unique-identifier>.sqlite` backup from the live database. If database damage prevents backup, stop and preserve the main file and its WAL/SHM before doing anything else; do not continue discarding the evidence.
5. Preserve the current database and all companion files together in an explicitly identified, brand-new archive directory. Move the validated restoration file to the authoritative `ledger.sqlite` path and verify `ledger` ownership and mode 0600. Do not leave old WAL/SHM files beside the new main database.
6. Start the application and timer, verify direct/proxied health, then reload the browser and inspect ledger entries read-only. If results are unexpected, stop writes first; do not repeatedly overwrite data.

Prepare and review commands using the actual paths for this restoration. Investigate before continuing after any failed step. Retain the archive and pre-restoration backup temporarily for rollback; cleanup requires an exact file scope and confirmation. This document intentionally provides no fixed-date deletion/replacement commands that could be copied accidentally.

<a id="程序和配置更新"></a>

## Program and Configuration Updates

### FabricWorld Integration

Ledger calls FabricWorld through environment variable `LEDGER_FABRICWORLD_URL`, defaulting to `http://127.0.0.1:18082` when unset; `deploy/ledger.env` records the same default. Explicitly setting an empty value and restarting Ledger pauses server-side synchronization (the dialog reports that it is unconfigured, while ledger entries can still be saved). The target is the Go API root without the `/fabricworld` prefix. The two services operate independently and require no shared database permissions, extra port, or Nginx change. Page navigation always uses same-origin `/fabricworld/fabrics/:id/edit`.

On first enablement, release the FabricWorld version supporting `/api/integrations/ledger` before releasing Ledger. There is no schema change. FabricWorld reuses its existing `operations` table to retain source records indefinitely and prevent duplicates. If FabricWorld is unavailable, only synchronization fails; ledger entry succeeds. Before a long-term rollback of FabricWorld, stop the integration because the old version's daily cleanup deletes integration-operation records older than 7 days. Immediate program rollback after an ordinary health failure does not roll back data. Restoring FabricWorld to an older backup may lose later fabrics and synchronization sources; coordinate and verify before restoration.

Pass synthetic tests before writing to production. Server release history is cleaned automatically under the shared release-retention policy.

Use [local release](DEPLOYMENT.md) for routine updates. An administrator may alternatively provide a verified program on standard input to the original fixed release script, preserving backup, validation, and failure rollback.

Configuration changes do not ship with a binary release:

- For unit/env/location/backup or release-script changes, update this repository's `deploy` source first, then have an administrator review it, compare it with the live environment, and install it to the exact path.
- Unit changes require `systemctl daemon-reload`; env or program-start-argument changes require a controlled Ledger restart.
- For an Nginx location change, run `nginx -t` before reload and check every existing application. Do not rewrite the shared server. If the global template is involved, update agent-config too.
- Current source code runs schema 2; schema 1 must be upgraded explicitly as described below. `serve`, `check`, and `backup` accept only version 2. When an ordinary release encounters an old database, candidate validation fails and the old program restarts.
- Manual rollback still requires a backup and confirmation that the old program is compatible with current schema. Database restoration always uses its separate confirmation process.

<a id="数据库升级"></a>

## Database Upgrade

Version 2 completely removes tags: the authoritative database no longer contains `tag`, `txn_tag`, or their indexes. Every account, category, and transaction field and deletion state is preserved, as are amounts, dates, and balances. New databases use `schema.sql` directly. Old structures remain only in the upgrade tool and synthetic tests.

The upgrade tool creates only a new file; it does not modify the source or replace the authoritative database:

```sh
./ledger-candidate migrate --from /path/to/version-1-backup.sqlite --db /path/to/new-version-2.sqlite
./ledger-candidate check --db /path/to/new-version-2.sqlite
```

The source must be a complete version 1 database, and the destination must not exist. The tool copies a consistent snapshot, deletes both tag tables and updates `user_version` within a transaction, then runs `VACUUM`, integrity checking, and foreign-key checking. On failure, the source remains. The destination may be absent or may remain as a copy requiring inspection; do not automatically retry with the same path. `restore` accepts versions 1 and 2 and preserves the source version exactly. The new `check` does not accept old backups, preventing release from mistaking an old database for one that can run. Validate old backups with the retained old program or use `migrate` to create a copy that the new program can check.

The first switch from version 1 is a coordinated database-and-program change and requires confirmation of tag-information removal and brief Ledger downtime. Historical backups are not cleaned as part of the upgrade. Ordinary local release does not perform the upgrade; do not push and expect it to succeed automatically. First prepare a fully tested source commit, Linux artifact, and hashes, then rehearse the upgrade in an isolated directory.

An administrator prepares switch commands using actual unique filenames, verifies and holds the same `/run/lock/ledger-deploy.lock` used by `deploy-release.sh`, and blocks concurrent releases. Do not create ledger entries during maintenance. The scope is Ledger only:

1. Stop `ledger-backup.timer`, `ledger-backup.service`, and `ledger.service`. As user `ledger`, use the current old program to create a consistent `before-schema-upgrade` backup and preserve the old program and its `current-commit`.
2. As user `ledger`, use the candidate program to create a new version 2 file from that backup and run `check`. Verify every account, category, and transaction field, plus balances and income/expense statistics, without writing test transactions to the authoritative ledger. If any step fails, preserve the evidence, start the original service and timer, and do not switch.
3. Archive the old authoritative database and all companion WAL/SHM files together in a new private directory. Move the checked version 2 file to the authoritative path and retain `ledger:ledger` ownership and mode 0600; never mix old WAL/SHM with the new database. Install the hash-verified candidate through a separate `bin/ledger.next`, then atomically rename it over the binary. This is a controlled schema switch; do not invoke the ordinary release script and make the old program back up version 2 again.
4. Start Ledger and verify direct/proxied health, `/ledger/search`, and ledger entries read-only in the browser. On success, record the candidate program's source commit in `current-commit`, restore the backup timer, create the first version 2 snapshot with the new backup tool, and synchronize this project's documentation and `SOURCE`. Normal local release resumes afterward.
5. If acceptance fails and no new write has occurred, stop Ledger, preserve the failed version 2 file and its companion files separately, then restore the paired archived old database, old program, and commit marker, and start the original service and timer. If a new write already occurred, back up and confirm the recovery point first; do not automatically discard new entries. A version 1 program cannot run a version 2 database directly.

The upgrade does not change shared Nginx, ports, the permission model, or FeeTable. The shared server application inventory does not need an update for this schema change.

<a id="文档同步"></a>

## Documentation Synchronization

This repository is the source for project documentation; server `/opt/ledger/AGENTS.md` and `/opt/ledger/docs` are copies. After committing and pushing, run the shared synchronization script. It checks drift, installs and verifies files individually, writes `docs/SOURCE`, and cleans managed leftovers. See [maintenance.md documentation synchronization](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/maintenance.md#文档同步):

```sh
~/agent-config/skills/server-operations/scripts/sync-docs.sh Ledger
```

Ordinary local program release does not synchronize documentation. It automatically applies only the validated `portal.json`; an administrator still installs other runtime configuration.

<a id="排查"></a>

## Troubleshooting

| Symptom | Check first |
| --- | --- |
| Direct port 18080 health fails | Ledger unit/journal, env, paths/permissions; do not create an empty database |
| Direct health succeeds but `/ledger/` fails | Nginx location/link, syntax, port 80, and security group; a 404 at root `/` is normal |
| Page opens but resources/APIs fail | Build `BASE_PATH`, Vue/API prefixes, proxy prefix stripping, and `Host`; test a deep link |
| Release fails | Local command output, `last-deployment.json`, `releases/result`, and the service journal; see rollback and troubleshooting in `DEPLOYMENT` |
| Backup service is inactive | Inspect `Result`, the journal, and files first; a completed oneshot normally exits |
| Disk usage grows | `data`/`backups`/`releases`; inspect protection/skip reasons from shared retention and do not arbitrarily delete WAL |
| Write-request outcome is unknown | Verify read-only whether the entry was saved before doing anything else; do not automatically retry the write |

### Save Delays and Unknown Outcomes

First put browser feedback, the journal, Nginx, and database timestamps on Beijing time and widen the feedback time window appropriately. Save interfaces are `POST /ledger/api/transactions` (create), `PUT /ledger/api/transactions/{id}` (edit), and `POST /ledger/api/transactions/batch` (batch). `POST /ledger/api/transactions/query` and `/statistics/*` are reads; a 200 from them does not prove that a transaction saved. Nginx `access.log` timestamps record request completion, not necessarily the click or request start time.

Ordinary application request durations are written through `slog.Debug` and do not enter the journal at the default Info level. An empty journal does not mean no request occurred. Current default Nginx access logs contain neither request duration nor upstream duration, and there is no browser-side error log, so server logs alone cannot reconstruct every wait. A 499 means the client closed the request before the response completed; page navigation, explicit cancellation, and network interruption can all cause it, so it does not by itself establish server overload. Historical host samples may help identify resource pressure but cannot rule out brief anomalies between samples.

To verify persisted results, use actual write timestamps `txn.created_at` / `updated_at` (epoch milliseconds), not only the user-selectable ledger date `time`. Include soft-deleted records and, when necessary, match the amount or title supplied by the user. The server's Python standard-library `sqlite3` can query as user `ledger` through `file:/opt/ledger/data/ledger.sqlite?mode=ro` with `PRAGMA query_only=ON`, avoiding unrelated ledger output or writing production results into the repository. The frontend timeout is 30 seconds. When a connection is already marked unavailable, the client rejects the write before sending the save request. If there is neither a save-request log nor a corresponding write, continue investigating the contemporaneous page message and client network evidence; do not submit a replacement transaction automatically.

Use the server inventory and `common-issues` as the entry points for other failed host units, external tools, and shared problems. Do not duplicate their procedures in Ledger documentation.

## ServerPortal Integration Materials

`deploy/portal.json` is the maintained source for this application's resource description. Local release validates it with the `server-operations` validator and stores the same declaration beside the binary in the same local version directory. It runs `portal-check` before release and `portal` afterward, installs the declaration to `/opt/ledger/config/portal.json` through existing restricted SSH, and verifies the SHA-256 actually loaded by the collector. `config/portal-source.json` records the declaration's source commit; it and the program's `current-commit` represent versions of different materials.

The portal discovers this application through the controlled `/opt/serverportal/registry.d/ledger.json` link. It reloads the declaration automatically after a successful update, with no restart. The first ordinary local release also creates the link, so the portal's central application list does not need editing. Ordinary release can update this application's declaration; an administrator still installs other units, env, Nginx, and release scripts.

Do not use this option instead of a program release for source-code or database-behavior changes.

When data roots, media, backup formats, units, ports, or access paths change, maintain the declaration and corresponding docs in the same commit, update the shared inventory, and verify resource coverage. The portal reads files, media, database tables, and systemd state automatically. A maintenance agent must explicitly maintain directory purposes, API descriptions, and permission boundaries. See [Portal Maintenance](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/portal.md) for the common protocol, failure handling, and new-application integration.

The portal at `/portal/` uniformly protects public access. The release script checks application health through loopback, while the local release's public check expects unauthorized access to return 401. Device authorization remains valid until explicitly revoked, and shared Nginx renews the Cookie on valid requests. If this application adds `add_header`, preserve shared `Set-Cookie` forwarding; see the shared portal-maintenance document for rules and acceptance. Portal backups use this application's native consistent snapshot. At the user's request, real end-to-end restoration acceptance remains deferred; do not automatically resume package download or restoration during this maintenance.

## Phone Home-Screen Icons

The existing `apple-touch-icon.png` is 180×180; `manifest.webmanifest` also declares 192/512px icons. Nginx permits anonymous GET/HEAD only for these specific public files and preserves original version query parameters. Pages, APIs, and user media continue to require device authentication. See the [shared troubleshooting record](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证后-iphone-桌面图标缺失) for the common cause, deployment status, and phone acceptance.

## Current Release Entry Point

This project is for personal use: a change may be released after validating the functionality changed in this task locally. There is no full-regression gate, and permanent tests are not added or retained by default. For UI changes, check the computer and phone scenarios actually used. Validate data migrations, bulk writes/deletions, and backup restoration specifically on an isolated copy first.

See [Local Release and Rollback](DEPLOYMENT.md) for the complete process. GitHub stores only source code; local `make release` builds and `make deploy` updates production, while documentation is synchronized separately.

## Automatic Cleanup of Release Materials

Every day at 05:00 Beijing time, the server follows [Automatic Retention of Release Materials](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/retention.md) to retain the latest 3 successful releases and latest 5 complete pre-release backups while protecting the current version, its corresponding backup, and failed batches awaiting review. `server-operations` maintains the shared implementation, locks, receipts, previews, and disable command. This project's `deploy` retains the release script's `recovery` marker and the daily backup's `flock` entry point. During first-time installation, create `/run/lock/ali-release-retention.lock` according to the shared documentation before enabling the backup timer. Daily and manual backups, business data, portal exports, and maintenance-computer build materials are outside this automatic cleanup scope.
