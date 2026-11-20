# AI Value Realization (AIVR)

Turn your Data & AI roadmap into delivered, measured value — in your own Databricks
workspace.

AIVR is a Databricks App your team deploys and owns. Bring in the roadmap your
organization agreed, and AIVR becomes the place you build it out: what is ready to
start, what is blocked and by which data, what each use case unlocks, and the value
realized against the value planned. It ships with a curated reference catalog of 240
Power & Utilities data/AI use cases, 164 data assets and 31 data sources, the
dependencies between them, and parameterized value models.

- **Operate** — the roadmap, per business unit. Import it (an AI Transformation
  Roadmap deck `.html`, or a [roadmap package](ROADMAP_PACKAGE.md) `.json` from any
  planning tool) and every use case lands with its strategic pillar, priority, value
  estimate and first-version plan. Then track delivery: readiness (which use cases are
  data-blocked and by what), coverage, data-source status, value (planned vs
  realized), what-if ("what does landing this source unlock?"), and reconciliation
  against what is actually in your Unity Catalog. Import the next version and AIVR
  shows what changed instead of overwriting your progress.
- **Explore** — the catalog as a dependency map. Pick any use case to see its blast
  radius: what it needs first, what it unlocks, and what shares its data. Add use cases
  to your portfolio from here.
- **Extend** — add your own use cases. Describe one in a few sentences and an agent
  maps it to your data assets, data domains, prerequisite and downstream use cases,
  and a value model; you review every mapping before it is saved.

All data stays in your workspace. AI features use your own model serving endpoints.

> **Not a Databricks product.** This is an open reference application provided under
> the [Databricks License](LICENSE), as-is, without support. Once deployed, your team
> owns and maintains it — see [SUPPORT.md](SUPPORT.md).

## Deploy

### Prerequisites

- A Databricks workspace with **Databricks Apps** and **serverless** compute enabled.
- **Databricks CLI ≥ 0.280** (`databricks --version`), authenticated to the workspace
  (`databricks auth login --host https://<your-workspace>`).
- A **SQL warehouse** (Serverless recommended) — you need its ID.
- A **Foundation Model serving endpoint** for the agents (defaults to
  `databricks-claude-sonnet-4-5`; any chat-completions endpoint works).
- Permission to create Apps and Jobs, and for app-state storage, **one** of:
  - **Lakebase** (recommended) — permission to create a Lakebase project, or
  - **Delta** — `USE CATALOG` + `CREATE SCHEMA` on a Unity Catalog catalog.

### Choose where app state lives

| | `lakebase` target (recommended) | `delta` target |
|---|---|---|
| Storage | Lakebase (managed Postgres) project created by the bundle | Delta tables in `<delta_catalog>.<delta_schema>` |
| Speed | Fast (milliseconds per query) | Each query is a warehouse round trip (~0.2–0.5 s); reads are cached |
| Concurrency | Transactional | Optimistic; conflicting writes are retried — sized for one team |
| Needs | Lakebase available in your workspace | Only Unity Catalog + the SQL warehouse (which must be running while the app is used) |

Both run the same app with the same features. See [CONFIGURATION.md](CONFIGURATION.md#storage-backends)
for details and the trade-offs.

### Deploy in three commands

```bash
git clone <this repository> && cd ai-value-realization

# 1. Set the two required variables (or edit the defaults in databricks.yml):
export BUNDLE_VAR_warehouse_id=<your-warehouse-id>
export BUNDLE_VAR_admin_emails=you@yourcompany.com

# 2. Deploy — pick one target:
databricks bundle deploy -t lakebase      # or: -t delta  (also set BUNDLE_VAR_delta_catalog)

# 3. Open the app:
databricks bundle summary -t lakebase     # prints the app URL
```

`bundle deploy` creates the app, its storage, and a **setup** job, then runs the job
(schema migrations, the reference catalog, your first business unit and admins, and
the app service principal's grants) and starts the app. The first deploy takes a few
minutes; re-deploying is safe and only applies what changed. Every variable is
described in [CONFIGURATION.md](CONFIGURATION.md).

If the setup job prints GRANT statements it could not run (for example the
discovery schema needs a catalog owner), hand them to a metastore admin — the app's
**Admin → Setup** page shows the same list and re-checks on demand.

## Use

1. **Create a business unit** (top bar) for each part of the organization that owns a
   roadmap, and share it with the people who deliver it (owners and editors change it,
   viewers only look).
2. **Import the roadmap** — *Operate → Roadmap → Import roadmap*. Upload the roadmap
   deck (`.html`) or package (`.json`). Review how each use case lines up with the
   catalog: map it to a catalog use case, create it new, or skip it (*Suggest matches
   with AI* helps with the rest). Nothing is saved until you click *Import*.
3. **Operate** — move use cases through *Scoping → In progress → Live → Value realized*,
   record realized value, land the data that blocks the next ones, and use *What-if* to
   choose which source to land first. When the roadmap is revised, import the new
   version: AIVR shows what was added, changed and dropped.
4. **Explore** — browse the catalog, see each use case's blast radius, and add more to
   the portfolio.
5. **Admin** — manage business units, administrators, the use-case and data catalog,
   value assumptions, and feature flags.

## Operate and maintain

- [OPERATIONS.md](OPERATIONS.md) — backups and export, upgrades, catalog refresh,
  schema drift, rotating the model endpoint, troubleshooting.
- [CONFIGURATION.md](CONFIGURATION.md) — every bundle variable and app setting.
- [ROADMAP_PACKAGE.md](ROADMAP_PACKAGE.md) — what a roadmap import reads, and the
  package format for producing one from any planning tool.
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the app is built, the data model, and the
  two storage backends.
- [CONTRIBUTING.md](CONTRIBUTING.md) — local development and tests.
- [SECURITY.md](SECURITY.md) — what the app can access and how to report issues.

Behaviour you may want to tune without a code change: `LOG_LEVEL` (default `INFO`)
and `RATE_LIMITS` (per-user limits on AI and warehouse-heavy endpoints, default `on`)
are set in `databricks.yml`; see [CONFIGURATION.md](CONFIGURATION.md).

## License

[Databricks License](LICENSE). See [NOTICE](NOTICE) for third-party components.
The reference catalog's value estimates are directional; validate them against your
own data before using them in a financial or investment decision.
