#!/usr/bin/env python3
"""Install / upgrade AI Value Realization's app state. Runs as the bundle's `setup` job.

`databricks bundle deploy` triggers this job (see databricks.yml); it is also safe
to run by hand (`databricks bundle run setup -t <target>`) or from a laptop
(`python scripts/setup.py --profile <cli-profile> …`). Every step is idempotent:

  1. Storage      lakebase: resolve the Lakebase endpoint the bundle created
                  delta:    CREATE SCHEMA IF NOT EXISTS <catalog>.<schema>
  2. Schema       apply pending migrations (server/migrations or migrations_delta)
  3. Catalog      seed the reference catalog (reference/catalog.json): use cases,
                  data assets, domains, data sources, dependencies, default value
                  assumptions. Missing rows only, unless --refresh-catalog.
                  Never touches business-unit data.
  4. Bootstrap    first business unit (--organization-name) and admins (--admins)
  5. Access       grant the app's service principal what it needs:
                  lakebase: DML on the app tables
                  delta:    USE CATALOG / USE SCHEMA / SELECT / MODIFY
                  both:     the discovery + Genie-mirror schemas (optional features)

It runs as whoever runs the job (the bundle deployer by default), so that identity
owns the schema; the app's service principal only ever gets DML.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

try:
    ROOT = Path(__file__).resolve().parent.parent
except NameError:
    # Serverless job compute runs the file without __file__; the bundle passes the
    # deployed file path explicitly.
    ROOT = Path(next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--repo-root=")),
                     os.getcwd()))
sys.path.insert(0, str(ROOT))


def run_async(coro):
    """asyncio.run, also on job compute where an event loop is already running
    (serverless Python tasks): then the coroutine runs on its own thread and loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def log(msg: str) -> None:
    print(f"[setup] {msg}", flush=True)


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--storage-backend", choices=["lakebase", "delta"], required=True)
    ap.add_argument("--app-name", required=True)
    ap.add_argument("--warehouse-id", required=True)
    # lakebase
    ap.add_argument("--lakebase-project", default="")
    ap.add_argument("--lakebase-branch", default="production")
    ap.add_argument("--pg-database", default="app")
    # delta
    ap.add_argument("--delta-catalog", default="")
    ap.add_argument("--delta-schema", default="")
    # optional features
    ap.add_argument("--discovery-catalog", default="")
    ap.add_argument("--discovery-schema", default="")
    ap.add_argument("--genie-catalog", default="")
    ap.add_argument("--genie-schema", default="")
    # bootstrap
    ap.add_argument("--organization-name", default="")
    ap.add_argument("--admins", default="", help="comma-separated emails")
    ap.add_argument("--refresh-catalog", default="false")
    ap.add_argument("--allow-drift", action="store_true",
                    help="apply pending migrations even if an applied file changed "
                         "(see OPERATIONS.md: schema drift)")
    ap.add_argument("--profile", default="", help="CLI profile when run from a laptop")
    ap.add_argument("--repo-root", default="", help="(set by the bundle) deployed source root")
    ap.add_argument("--local", action="store_true",
                    help="local development: use the PG*/DELTA_* settings already in the "
                         "environment; skip storage provisioning and grants")
    return ap.parse_args(argv)


def workspace(profile: str):
    from databricks.sdk import WorkspaceClient
    return WorkspaceClient(profile=profile) if profile else WorkspaceClient()


def app_service_principal(w, app_name: str) -> str | None:
    try:
        app = w.apps.get(app_name)
    except Exception as exc:  # noqa: BLE001
        log(f"WARNING: app {app_name!r} not found ({exc}); skipping the app grants")
        return None
    return app.service_principal_client_id


def sql_statement(w, warehouse_id: str, statement: str) -> tuple[bool, str]:
    from databricks.sdk.service.sql import StatementState
    try:
        res = w.statement_execution.execute_statement(
            warehouse_id=warehouse_id, statement=statement, wait_timeout="50s")
        state = res.status.state if res.status else None
        if state == StatementState.SUCCEEDED:
            return True, ""
        err = res.status.error.message if res.status and res.status.error else str(state)
        return False, err
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def configure_lakebase(w, args) -> None:
    branch = f"projects/{args.lakebase_project}/branches/{args.lakebase_branch}"
    endpoints = list(w.postgres.list_endpoints(parent=branch))
    if not endpoints:
        sys.exit(f"no Lakebase endpoint under {branch} — did the bundle create the project?")
    ep = endpoints[0]
    host = ep.status.hosts.host
    cred = w.postgres.generate_database_credential(endpoint=ep.name)
    me = w.current_user.me()
    os.environ.update({
        "STORAGE_BACKEND": "lakebase", "PGHOST": host, "PGPORT": "5432",
        "PGDATABASE": args.pg_database, "PGUSER": me.user_name, "PGPASSWORD": cred.token,
    })
    log(f"Lakebase {host} / {args.pg_database} as {me.user_name}")


def configure_delta(w, args) -> None:
    if not (args.delta_catalog and args.delta_schema):
        sys.exit("--delta-catalog and --delta-schema are required for the delta backend")
    ok, err = sql_statement(
        w, args.warehouse_id,
        f"CREATE SCHEMA IF NOT EXISTS `{args.delta_catalog}`.`{args.delta_schema}` "
        "COMMENT 'AI Value Realization app state'")
    if not ok:
        sys.exit(f"could not create schema {args.delta_catalog}.{args.delta_schema}: {err}")
    os.environ.update({
        "STORAGE_BACKEND": "delta", "DELTA_CATALOG": args.delta_catalog,
        "DELTA_SCHEMA": args.delta_schema, "DATABRICKS_WAREHOUSE_ID": args.warehouse_id,
    })
    if args.profile:
        os.environ["DATABRICKS_CONFIG_PROFILE"] = args.profile
    log(f"Delta {args.delta_catalog}.{args.delta_schema} via warehouse {args.warehouse_id}")


async def migrate_and_seed(args) -> None:
    from server import migrator, reference
    from server.db import db

    base = ROOT / "server" / "migrations"
    result = await migrator.apply(db, migrator.migrations_dir_for(db, base), actor="setup",
                                  allow_drift=bool(getattr(args, "allow_drift", False)))
    log(f"schema: {result['applied_count']} migration(s) applied, "
        f"{result['already_current']} already current")
    seeded = await reference.seed(
        db, refresh=str(args.refresh_catalog).lower() in ("1", "true", "yes"),
        org_name=args.organization_name,
        admins=[a for a in args.admins.split(",") if a.strip()])
    log(f"reference catalog {seeded['version']}: {seeded['counts']}")
    await db.close()


async def grant_lakebase(args, sp: str) -> None:
    from server.db import db
    statements = [
        f'GRANT CONNECT ON DATABASE "{args.pg_database}" TO "{sp}"',
        f'GRANT USAGE ON SCHEMA public TO "{sp}"',
        f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "{sp}"',
        f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "{sp}"',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "{sp}"',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "{sp}"',
    ]
    for s in statements:
        try:
            await db.execute(s)
        except Exception as exc:  # noqa: BLE001
            log(f"WARNING: {s[:70]}… failed: {exc}")
    await db.close()
    log(f"granted the app service principal DML on {args.pg_database}.public")


def grant_uc(w, args, sp: str) -> list[str]:
    statements = []
    if args.storage_backend == "delta":
        statements += [
            f"GRANT USE CATALOG ON CATALOG `{args.delta_catalog}` TO `{sp}`",
            f"GRANT USE SCHEMA, SELECT, MODIFY ON SCHEMA `{args.delta_catalog}`.`{args.delta_schema}` TO `{sp}`",
        ]
    for catalog, schema in ((args.discovery_catalog, args.discovery_schema),
                            (args.genie_catalog, args.genie_schema)):
        if catalog and schema and catalog.lower() != "none":
            statements += [
                f"CREATE SCHEMA IF NOT EXISTS `{catalog}`.`{schema}`",
                f"GRANT USE CATALOG ON CATALOG `{catalog}` TO `{sp}`",
                f"GRANT USE SCHEMA, SELECT, MODIFY, CREATE TABLE ON SCHEMA `{catalog}`.`{schema}` TO `{sp}`",
            ]
    failed = []
    for s in statements:
        ok, err = sql_statement(w, args.warehouse_id, s)
        log(("ok   " if ok else "FAIL ") + s)
        if not ok:
            failed.append(f"{s};  -- {err[:120]}")
    return failed


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.local:
        os.environ["STORAGE_BACKEND"] = args.storage_backend
        run_async(migrate_and_seed(args))
        log("done (local: no provisioning or grants)")
        return 0
    w = workspace(args.profile)
    if args.storage_backend == "lakebase":
        configure_lakebase(w, args)
    else:
        configure_delta(w, args)
    run_async(migrate_and_seed(args))

    sp = app_service_principal(w, args.app_name)
    failed: list[str] = []
    if sp:
        if args.storage_backend == "lakebase":
            run_async(grant_lakebase(args, sp))
        failed = grant_uc(w, args, sp)
    if failed:
        log("Some grants need a catalog owner or metastore admin. Ask one to run:")
        for f in failed:
            print("    " + f)
        if args.storage_backend == "delta" and any(args.delta_schema in f for f in failed):
            log("ERROR: the app cannot read its own tables until the grants above are applied.")
            return 1
    log("done")
    return 0


if __name__ == "__main__":
    # Exit only on failure: job compute reports even SystemExit(0) as an error.
    rc = main()
    if rc:
        sys.exit(rc)
