# Contributing and local development

This repository is yours to change. These notes cover running it locally, the tests,
and the conventions that keep both storage backends working.

## Layout

| Path | What |
|---|---|
| `app.py` | FastAPI entry point. |
| `server/` | Backend: routes, agents, readiness and value engines, storage. |
| `server/storage/` | `lakebase.py`, `delta.py`, `translate.py` (Postgres → Databricks SQL), `schema_meta.json` (generated). |
| `server/migrations/`, `server/migrations_delta/` | Schema for each backend (Postgres is the source of record). |
| `reference/catalog.json` | The shipped reference catalog. |
| `frontend/src/` | React + TypeScript source. `frontend/dist/` is the committed build the app serves. |
| `scripts/` | `setup.py` (the setup job), `restore.py`, maintainer tools, CI gates. |
| `tests/` | Unit suite (standard library only; see `tests/README.md`). `tests/integration/` needs a live app or warehouse. |
| `databricks.yml` | The bundle: app, setup job, targets. |

## Run locally

Requires Python 3.11+ and Node 20 (only if you change the frontend).

```bash
pip install -r requirements.txt psycopg2-binary

# Lakebase path against a local Postgres:
createdb app
export STORAGE_BACKEND=lakebase PGHOST=localhost PGPORT=5432 PGDATABASE=app \
       PGUSER=$USER PGPASSWORD=unused PGSSLMODE=disable APP_ADMINS=you@example.com
python scripts/setup.py --local --storage-backend lakebase --app-name local --warehouse-id unused
python -m uvicorn app:app --reload --port 8000
```

Locally, requests are attributed to `X-Forwarded-Email` if you send it, otherwise to
your CLI user. AI features need `DATABRICKS_PROFILE` pointing at a workspace that has
the serving endpoint. Without it they fall back to their deterministic results.

For the Delta path, point `DELTA_CATALOG`, `DELTA_SCHEMA`, `DATABRICKS_WAREHOUSE_ID`
and `DATABRICKS_PROFILE` at a scratch schema, and set it up first with
`python scripts/setup.py --storage-backend delta --profile <p> --app-name x --warehouse-id <id> --delta-catalog <c> --delta-schema <s>`.

Frontend: `cd frontend && npm ci && npm run dev` (Vite proxies `/api` to port 8000).
Run `npm run build` before committing; `frontend/dist` is what deploys.

## Tests

```bash
python scripts/check.py            # every CI gate: unit tests, import check, secrets, names, lint
python -m unittest discover -s tests
```

With an app running (either backend):

```bash
python tests/integration/smoke.py --base http://localhost:8000 --email you@example.com
python tests/integration/check_delta_sql.py --profile <p> --warehouse-id <id> \
    --catalog <c> --schema <seeded-delta-schema>
```

## Conventions that matter

- **Write SQL once, in Postgres dialect, through `server/db.py`** with `$n`
  parameters. Never build SQL from user input. If a Postgres feature doesn't
  translate, `check_delta_sql.py` will tell you. Fix it in `translate.py`, or write
  the query in the portable subset.
- **Avoid a query per row.** On the Delta backend each statement is a warehouse round
  trip. Batch writes with `db.executemany`, and read related rows in one query.
- **Schema changes:** add `NNN_name.sql` to `server/migrations/` *and* the matching
  Delta DDL to `server/migrations_delta/`. Apply the Postgres migrations to a scratch
  database, then run `python scripts/gen_delta_schema.py --dsn <postgres-url>`.
  Never edit an applied migration; see "Schema drift" in [OPERATIONS.md](OPERATIONS.md).
- **Agents propose, people confirm.** A model-driven write goes through a confirm
  token (`server/confirm.py`), and model output is validated against the catalog
  before anything is written.
- **No names.** `scripts/check_names.py` rejects real company and person names and
  internal hostnames in any tracked file. Use `Example Power & Light` in examples
  and tests.
