# Configuration

Everything is configured through the bundle (`databricks.yml`). Set a variable by
editing its `default:`, with `--var name=value` on the command line, or with an
environment variable `BUNDLE_VAR_<name>`. The bundle turns these into the app's
settings (environment variables) and the setup job's arguments, so you never edit
an app config file by hand.

## Bundle variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `warehouse_id` | **yes** | — | SQL warehouse ID. Used for discovery, `ai_query()` enrichment and, on the `delta` target, all app-state reads and writes. |
| `admin_emails` | **yes** | — | Comma-separated emails of the first administrators. More can be added in **Admin → Admins**. |
| `app_name` | | `ai-value-flywheel` | Databricks App name. Also names the setup job (`<app_name>-setup`). |
| `organization_name` | | `My organization` | Name of the first business unit created on install. Rename it in the app. |
| `serving_endpoint` | | `databricks-claude-sonnet-4-5` | Chat model endpoint for the agents (use-case mapping, value models, briefs, PoC documents, AI insights). |
| `ai_query_endpoint` | | `databricks-claude-sonnet-4-5` | Endpoint used by SQL `ai_query()` for discovery enrichment. |
| `lakebase_project` | | `ai-value-flywheel` | `lakebase` target: the Lakebase project the bundle creates for app state. |
| `delta_catalog` | | `main` | `delta` target: catalog for the app-state schema. The deployer needs `USE CATALOG` and `CREATE SCHEMA`. |
| `delta_schema` | | `ai_value_flywheel` | `delta` target: schema the setup job creates for app-state tables. |
| `discovery_catalog` | | *(empty)* | Optional. Catalog for the workspace-discovery inventory (Operate → Discovery / Reconciliation). Empty disables it. |
| `discovery_schema` | | `ai_value_flywheel_discovery` | Schema for the discovery inventory. |
| `genie_mirror_catalog` | | *(empty)* | Optional. Catalog for the Genie mirror of the portfolio ("Ask" in natural language). |
| `genie_mirror_schema` | | `ai_value_flywheel_genie` | Schema for the Genie mirror tables. |
| `genie_space_id` | | *(empty)* | Set after creating the Genie space from **Admin → Setup**, then redeploy. |
| `refresh_catalog` | | `"false"` | `"true"` updates reference-catalog rows to this release's version on the next deploy (rows you created are never touched). See [OPERATIONS.md](OPERATIONS.md#upgrading). |
| `app_env` | | `PROD` | Environment label shown in the app's corner. |

## Storage backends

Pick one with the deploy target. Both run the same app.

### `lakebase` (recommended)

`databricks bundle deploy -t lakebase` creates a **Lakebase project**
(`lakebase_project`) and binds its default database to the app with
`CAN_CONNECT_AND_CREATE`. That binding creates the app service principal's Postgres
role and gives the app `PGHOST`, `PGPORT`, `PGDATABASE`, and `PGUSER`. The app logs
in with its own OAuth token, so no password is stored anywhere. The setup job applies
`server/migrations/` as the deployer, so the deployer owns the tables, and grants the
app's service principal DML only.

### `delta`

`databricks bundle deploy -t delta` keeps app state in Delta tables in
`<delta_catalog>.<delta_schema>`. The app reads and writes them through the SQL
warehouse, and every statement is translated from the app's Postgres SQL
(`server/storage/translate.py`). Use it where Lakebase is not available.

Trade-offs:

- **Latency.** Every statement is a warehouse round trip: about 0.2–0.5 s inside
  Databricks Apps, and several seconds right after a serverless warehouse auto-stops.
  Reads are cached in the app for `DELTA_CACHE_TTL_S` seconds and invalidated when
  the app writes to the tables they read. Pages that write a lot (saving an
  assessment, promoting it, creating a business unit) take a few seconds.
- **The warehouse must be running** while people use the app. Serverless with a short
  auto-stop is the cost-effective choice.
- **Concurrency.** Delta uses optimistic concurrency. The app retries conflicting
  concurrent writes, which is fine for one team's planning workload but is not a
  high-write transactional system.
- **Integrity is enforced by the app, not the table.** Delta does not enforce primary
  keys, unique constraints, or foreign keys. Upserts are `MERGE`s on the keys,
  `ON DELETE CASCADE` / `SET NULL` are emulated from `server/storage/schema_meta.json`,
  and the app checks for duplicates before inserting. Don't write to these tables
  outside the app.
- **Knowledge-base search** uses plain text matching (title, summary, body) instead
  of Postgres full-text ranking.
- **Single app instance.** The read cache is per process. Keep the app at one compute
  instance, which is the default.

The app's service principal gets `USE CATALOG`, `USE SCHEMA`, `SELECT`, and `MODIFY`.
The setup job creates the schema as the deployer, who can therefore grant these.

## App settings (environment variables)

The bundle sets these. They're listed so an operator can recognize them in the app's
**Environment** tab and logs, or override one in `databricks.yml` under
`resources.apps.ai_value_flywheel.config.env`.

| Setting | Set from | Purpose |
|---|---|---|
| `STORAGE_BACKEND` | target | `lakebase` or `delta`. |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | Lakebase app resource | Lakebase connection (lakebase target). |
| `PGPASSWORD` | — | Local development only. In Apps the app uses its OAuth token. |
| `PGSSLMODE` | — | Local development only (`disable` for a local Postgres). |
| `DELTA_CATALOG`, `DELTA_SCHEMA` | `delta_catalog`, `delta_schema` | App-state schema (delta target). |
| `DELTA_CACHE_TTL_S` | — | Delta read-cache lifetime in seconds (default `30`). |
| `DELTA_POOL_SIZE` | — | Concurrent warehouse connections (default `4`). |
| `DATABRICKS_WAREHOUSE_ID` | `warehouse_id` (app resource) | SQL warehouse. |
| `SERVING_ENDPOINT` | `serving_endpoint` (app resource) | Agents' chat model. |
| `AI_QUERY_ENDPOINT` | `ai_query_endpoint` (app resource) | `ai_query()` model. |
| `APP_ADMINS` | `admin_emails` | Bootstrap administrators (always admins). |
| `ATLAS_CATALOG`, `ATLAS_SCHEMA` | `discovery_catalog`, `discovery_schema` | Discovery inventory. |
| `GENIE_MIRROR_CATALOG`, `GENIE_MIRROR_SCHEMA` | `genie_mirror_*` | Genie mirror tables. |
| `GENIE_SPACE_ID` | `genie_space_id` | Genie space for "Ask". |
| `APP_ENV` | `app_env` | Environment label. |
| `LOG_LEVEL` | databricks.yml | `INFO` by default; `DEBUG` for detail (on Delta, also logs translated SQL). |
| `RATE_LIMITS` | databricks.yml | Per-user limits on AI and warehouse-heavy endpoints. `on` by default; `off` disables them. |
| `DATABRICKS_PROFILE` | — | Local development: the CLI profile used for workspace calls. |

## Permissions summary

| Who | Needs |
|---|---|
| Deployer | Create Apps and Jobs. On `lakebase`, create a Lakebase project. On `delta`, `USE CATALOG` and `CREATE SCHEMA` on `delta_catalog`. `CAN_USE` on the warehouse. For the optional discovery and Genie schemas, the same on those catalogs. |
| App service principal | Granted automatically: warehouse `CAN_USE` and endpoint `CAN_QUERY` (app resources), and DML on app-state storage (setup job). Optional: `SELECT` on `system.access` lets discovery detect landed sources from lineage, which a metastore admin grants. |
| App users | `CAN_USE` on the app (**Compute → Apps → Permissions**). What they see inside is governed by business-unit membership and the admin list. |
