# Local Release and Rollback

This project is for personal use: a change may be released after validating the functionality changed in this task locally. There is no full-regression gate, and permanent tests are not added or retained by default. For UI changes, check the computer and phone scenarios actually used. Validate data migrations, bulk writes/deletions, and backup restoration specifically on an isolated copy first.

GitHub is used only to back up source code and configuration, and Actions is disabled. Committing and pushing do not update production. See [server-operations Local Deployment](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/release.md) for the shared implementation and environment setup. This project's parameters come from `deploy/release.json`.

## Routine Use

`make deploy` targets `nas` and its dedicated deployment key. `vps` provides the public HTTPS entrance on port 8443; the temporary `ali` entrance forwards to the same NAS application. Public-check overrides and host-specific keys are maintained in the shared release guide. Explicit legacy ALI deployment must not create a second writer after migration.

```sh
# Validate the changed functionality locally, then commit and push the source.
git add <files-changed-in-this-task>
git commit -m "describe the change"
git push origin main
make release   # Build from the committed snapshot; do not run the full test suite.
make deploy    # Reuse artifacts from the same commit and release over SSH.
```

Local materials are stored under `.local/releases/<full-commit>/` and include `program`, `manifest.json`, and the `portal.json` from the same commit. Deployment verifies hashes and confirms that the commit has been backed up to `origin/main`; it reuses artifacts when source code is unchanged. Untracked files are not included in the build. `make releases` lists local versions. These materials are not committed to Git.

Use `make portal` to update only portal information. It preflights and synchronizes the declaration from the same commit without building or restarting the business program. A failed declaration synchronization does not automatically roll back a program update that already succeeded; fix the problem and retry the declaration separately.

## Release Boundaries

Release uses the restricted `ledger-deploy` identity, whose private key exists only on the maintenance computer. To establish the account for the first time, run `deploy/setup-deploy.sh <local-release-public-key>`; do not initialize an existing account again. The forced command accepts only `deploy`, `portal-check`, and `portal`, and sudo permits only this application's fixed release script.

The switch begins only after upload and verification succeed. On `nas`, the shared helper cold-copies complete data/config/program state to root-private `/var/lib/server-upgrades/ledger/<release>/`, checks the candidate on an independent copy, and verifies runtime plus preserved SQLite rows and files. Only successful acceptance deletes that upgrade's local copy; failure or uncertainty retains it. `previous` remains the program rollback artifact. Normal releases do not transfer production data. An administrator installs units, Nginx, env, authorization, and release scripts from source; documentation uses `SYNC_HOST=nas` with the shared `sync-docs.sh`.

The current database is schema 2. A schema 1 program cannot be rolled back by replacing only the binary. Handle database upgrades and restoration separately according to `OPERATIONS`.

## Rollback and Troubleshooting

```sh
make releases
make rollback COMMIT=<explicitly-selected-full-old-commit>
```

Rollback reuses verified artifacts retained locally and still performs backup and health checks. First confirm that the old program is compatible with current data. Program rollback does not restore the database, photos, or device state. To restore data, first choose the recovery point and preserve the current state, then follow the restoration procedure in `OPERATIONS`.

NAS retains `program`, `previous`, `metadata`, `result`, `recovery`, and successful upgrade-acceptance evidence under `/opt/ledger/releases/`; `current-commit` records the source actually running. `.local/releases/<commit>/last-deployment.json` records the local result. Upload failure normally precedes downtime. After a failed switch, inspect `result`, the journal, and the retained private upgrade snapshot before deciding on recovery. NAS has no routine backup/failed-upgrade rotation; agent-operated cleanup requires an identified scope. [Legacy automatic retention](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/retention.md) belongs to `ali`, not the NAS upgrade snapshots.
