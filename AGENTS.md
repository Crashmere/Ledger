# Ledger Maintenance Entry Point

This project is for personal use: a change may be released after validating the functionality changed in this task locally. There is no full-regression gate, and permanent tests are not added or retained by default. For UI changes, check the computer and phone scenarios actually used. Validate data migrations, bulk writes/deletions, and backup restoration specifically on an isolated copy first.

GitHub backs up only source code and configuration; pushing does not trigger tests or deployment. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for local entry points and rollback. Shared workflows are maintained by `server-operations`.

Read [docs/README.md](docs/README.md) first, then use it to navigate to architecture, API, operations, and release documentation for the task. Treat current code and documentation as authoritative; do not infer the current state from old conversations or historical implementations.

## Server Context

- Before deployment, server troubleshooting, coexistence with a new application, or shared-architecture changes, use the `server-operations` skill. Its source is `Crashmere/agent-config/skills/server-operations/SKILL.md`, usually available locally under `~/agent-config`.
- Explicitly read `ssh nas 'cat /opt/AGENTS.md'` for the application host; read the same entry point on `vps` or temporary gateway `ali` before operating that host. Follow shared current-state for activation. SSH does not load remote instructions automatically.
- When a common issue may affect other applications (the host, network, shared release/backup patterns, and so on), document the solution in agent-config's `references/common-issues.md` for every affected application. Keep only project-specific parameters and links here.
- Shared entry points and host conventions belong to agent-config. This project maintains only Ledger's program, location, unit, data, and release materials. Cross-project changes must assess every application in the shared inventory.
- Use only the authorization table in `server-operations` `SKILL.md` to decide what to complete and report afterward versus what to confirm first. Documentation maintenance and synchronization, cleanup of known junk, and applying an existing `common-issues` solution do not require advance confirmation.

## Implementation and Validation

- Keep the design readable, direct, and suitable for one person. Put heavier statistics and validation in the backend. Paginate transactions, and make APIs support general filters rather than bind them to particular page names. Avoid unneeded ORM/repository layers or queues.
- User-confirmed product boundaries are listed in the docs entry point. Do not reintroduce an offline ledger, GitHub data synchronization, a SQL console, browser-based backup restoration, or a settings page unless requested.
- UI changes require real checks on a narrow screen such as 375×667 and on desktop. Production acceptance must remain read-only; do not insert test ledger entries.
- Databases, backups, and maintenance materials containing real ledger entries must not enter Git. When a database is missing or a write result is unclear, investigate first; do not create an empty production database or automatically retry the write.

## Documentation Is a Completion Requirement

- Agent instructions, maintenance documentation, technical plans, handoffs, and similar agent-authored operational documents default to English unless the user explicitly requests another language. User-facing product content and output may use the language the user requests.
- After every implementation or maintenance task, proactively check and update this project's docs and relevant deployment sources. Changes to architecture, APIs, interactions, directories, configuration, permissions, backups, or releases require corresponding current documentation.
- When shared state changes, also update agent-config's server context and every other affected project; do not document the change only in Ledger.
- Replace outdated information and remove redundant old plans. Do not retain operational logs in current documentation; Git preserves history. Do not mechanically change dates in unaffected documents.
- After pushing managed documentation, run `SYNC_HOST=nas ~/agent-config/skills/server-operations/scripts/sync-docs.sh Ledger` to synchronize `/opt/ledger/docs` and this entry point. Synchronize shared gateway context to its own hosts. Local program release does not synchronize documentation; server copies must not evolve independently.

## Portal Resource Synchronization

- When changing website icons or authentication, also check the iPhone `apple-touch-icon`, built paths, and anonymous GET/HEAD behavior. Only explicitly identified brand icons and public manifests may be exceptions; pages, APIs, and user media must remain authenticated. See `server-operations` `common-issues` for unified troubleshooting and acceptance. Treat `current-state` as authoritative for whether the integration is actually enabled.

- This project's `deploy/portal.json` is the maintained source for ServerPortal resource declarations. It records directory purposes, databases, the runtime user, port, unit, access paths, APIs, and backup types. When adding, migrating, or removing a data root, interface, or runtime material, update the declaration, corresponding docs, and shared application inventory together.
- The declaration is deployed to root-managed `/opt/ledger/config/portal.json`. Local release uses the shared `server-operations` validator: it runs a preflight before release, then automatically synchronizes the declaration through restricted SSH and verifies the hash loaded by the portal afterward. `registry.d/ledger.json` registers the link automatically; updates do not require a portal restart.
- Shared Nginx and the portal provide unified authentication. Do not store another device allowlist in this project. Retain the shared conventions for local calls and release health checks. Device authentication is enabled in production; after changes, synchronize `server-operations` `current-state`.
- The portal's read-only display does not replace this project's native consistent backups. When backup formats or media lifecycles change, validate the affected backup and restoration contracts on an isolated copy. Real business data, credentials, and backups still must not enter Git.

Local release automatically preflights and synchronizes the committed `deploy/portal.json`. To update only the declaration, run `make portal`; this preserves the business-program version.

Web pages block Tab / Shift+Tab from moving between controls by default and remove focus highlights; retain only exceptions explicitly requested by the user. Maintain and validate this behavior according to the [server-operations web keyboard and focus conventions](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/conventions.md#网页键盘与焦点).
Ledger's current shortcuts, three-field cycle, and panel focus behavior have been approved by the user. Preserve them unless the user requests otherwise.
