# Operations

Running AI Value Realization day to day: backups, upgrades, the reference catalog,
schema changes, and troubleshooting. Settings are in [CONFIGURATION.md](CONFIGURATION.md).

## Where things live

| What | Lakebase target | Delta target |
|---|---|---|
| App state (business units, imported roadmaps, portfolios, statuses, values, comments, knowledge base) | Lakebase project `lakebase_project`, database `databricks_postgres`, schema `public` | `<delta_catalog>.<delta_schema>` |
| Reference catalog (shipped use cases, data assets, domains, sources, dependencies) | Same tables, `origin = 'catalog'` | Same |
| App code | Workspace files under the bundle root | Same |
| Schema version | `schema_migrations` table | `schema_migrations` table |

## Backups

**From the app (both targets).** **Admin → Business units → Download backup** gives you
one JSON file with every row of every app table. Take one before every upgrade.
To restore it into this install, a new one, or the other storage backend:

```bash
python scripts/restore.py --file ai-value-realization-backup-<stamp>.json \
    --profile <cli-profile> --storage-backend lakebase --lakebase-project <project>
python scripts/restore.py --file ai-value-realization-backup-<stamp>.json \
    --profile <cli-profile> --storage-backend delta \
    --delta-catalog <catalog> --delta-schema <schema> --warehouse-id <id>
```

Restore keys every row on its primary key, so it is safe to re-run. Add `--replace` to
overwrite rows that already exist. Deploy the target first: the bundle's setup job
creates the schema. File attachments in the knowledge base are not included in the
JSON backup; back those up with the platform options below.

**Platform-level (recommended in addition).**
- Lakebase: point-in-time restore and branches. Create a branch from a timestamp to
  recover or inspect earlier state.
- Delta: time travel (`DESCRIBE HISTORY <catalog>.<schema>.use_cases`,
  `RESTORE TABLE … TO TIMESTAMP AS OF …`) or a scheduled `DEEP CLONE` of the schema.

## Upgrading

1. Download a backup (above).
2. Pull the new release: `git pull` (or merge it into your fork).
3. Read [CHANGELOG.md](CHANGELOG.md) for that release.
4. `databricks bundle deploy -t <target>`.

Read the plan before approving anything: `databricks bundle plan -t <target>` lists
what a deploy will create, update and delete. A deploy that would delete or replace
the app or its Lakebase project stops and asks; that is never part of a normal upgrade.

The setup job runs on every deploy. It applies only migrations not yet recorded in
`schema_migrations`, adds reference-catalog rows that are new in the release, and
never modifies business-unit data. Migrations are never applied at app startup: the
app's service principal has no DDL rights, and startup only reports pending
migrations (in the app log and on **Admin → Setup**).

### Refreshing the reference catalog

By default a deploy only **adds** catalog rows that are new in the release. Rows you
edited in **Admin → Use cases / Datasets** keep your version. To overwrite catalog
rows with the release's version (your own use cases and all business-unit data are
untouched):

```bash
databricks bundle deploy -t <target> --var refresh_catalog=true
```

Then set it back to `false`, or leave the default, for later deploys.

### Schema drift

If a migration file that was already applied has changed, the setup job stops with
**"Migration drift"** and applies nothing. That happens when someone edits an applied
migration instead of adding a new one. Neither automatic choice is safe: re-applying
can destroy data, and ignoring it leaves the schema wrong. So:

- **Preferred:** restore the original file and put the change in a **new** migration
  (`002_…sql` in `server/migrations/` *and* `server/migrations_delta/`, then
  `python scripts/gen_delta_schema.py` — see [CONTRIBUTING.md](CONTRIBUTING.md)).
- If you've confirmed the edit was cosmetic (comments, formatting), run setup once
  with drift allowed:
  `python scripts/setup.py --allow-drift --storage-backend <backend> --app-name <app> --warehouse-id <id> --profile <cli-profile> …`
  (same flags as the bundle's setup job).

## Changing configuration

Edit the variable in `databricks.yml` (or pass `--var`) and run
`databricks bundle deploy -t <target>`. The bundle updates the app and restarts it.

- **Model endpoint.** Set `serving_endpoint` / `ai_query_endpoint` and redeploy. The
  bundle grants the app `CAN_QUERY` on the new endpoint. AI features degrade to
  deterministic fallbacks if the endpoint is unavailable.
- **Admins.** `admin_emails` holds the bootstrap admins (always admins). Day-to-day
  admin changes are made in **Admin → Admins**.
- **App users.** Grant `CAN_USE` on the app in **Compute → Apps → \<app\> →
  Permissions**. Inside the app, business-unit owners share their unit from the
  header's business-unit menu.
- **Switching storage backend.** Download a backup, deploy the other target (it is a
  separate bundle root), restore the backup into it, and verify. Then remove the old
  deployment with `databricks bundle destroy -t <old target>`. Destroy keeps the
  Lakebase project unless `purge_on_delete` is set, and never drops the Delta schema.

## Troubleshooting

Start with **Admin → Setup**. It checks each dependency in order and shows the exact
fix (or GRANT statement) for the first failure.

| Symptom | Likely cause | Fix |
|---|---|---|
| App URL says "App has not been deployed yet" | The app was re-created after a failed first deploy | `databricks bundle run ai_value_realization -t <target>` deploys and starts the code. |
| App shows no use cases | Setup job didn't run or failed | `databricks bundle run setup -t <target>` and read its output. |
| "Not configured" / no storage (lakebase) | App's `lakebase` resource missing | Redeploy with `-t lakebase`. Check **Compute → Apps → \<app\> → Resources**. |
| Permission errors reading app tables (delta) | Grants not applied | The setup job prints any GRANT it couldn't run. A catalog owner runs them. |
| Pages slow (delta) | Warehouse cold start, or a small warehouse | Expect a few seconds on the first request after auto-stop. Use Serverless and raise the auto-stop timeout during workshops. |
| AI buttons return "AI unavailable" | Endpoint missing, or the app lacks `CAN_QUERY` | Check `serving_endpoint`. **Admin → Setup** probes it. |
| 429 Too Many Requests | Per-user rate limits | Expected under bursts. Set `RATE_LIMITS=off` in `databricks.yml` for a demo. |
| Discovery tab says "not configured" | `discovery_catalog` is `none` | Set it and redeploy. Then follow the Setup grants. |

Logs: **Compute → Apps → \<app\> → Logs**. Set `LOG_LEVEL=DEBUG` in `databricks.yml`
for more detail; on Delta this also logs every translated SQL statement.

Health endpoint: `GET /api/health` reports the version, reference-catalog version,
storage backend, connection state, and row counts.

## Removing the app

```bash
databricks bundle destroy -t <target>
```

This removes the app and the setup job. The Lakebase project is kept unless you set
`purge_on_delete: true` on it in `databricks.yml`. Delta tables are kept: drop the
schema yourself after you've taken a backup.
