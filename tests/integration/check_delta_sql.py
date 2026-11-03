"""MAINTAINER CHECK — every static SQL statement in the app, translated for Delta,
must compile on a real SQL warehouse.

Extracts the literal SQL passed to db.fetch/fetchrow/fetchval/execute/executemany
across server/, runs it through the Delta backend in dry-run mode (recording the
exact statements it would send, including the MERGE / RETURNING / cascade steps),
and asks the warehouse to EXPLAIN each one against a seeded Delta schema. EXPLAIN
resolves tables and columns without touching data.

    python tests/integration/check_delta_sql.py --profile <cli-profile> \
        --warehouse-id <id> --catalog <catalog> --schema <seeded-delta-schema>

f-string SQL (assembled at runtime) is skipped here; tests/integration/smoke.py
exercises it through the running app.
"""
from __future__ import annotations

import argparse
import ast
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def corpus() -> list[dict]:
    out = []
    for path in sorted(ROOT.glob("server/**/*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("fetch", "fetchrow", "fetchval", "execute", "executemany")
                    and node.args and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)):
                out.append({"where": f"{path.relative_to(ROOT)}:{node.lineno}",
                            "sql": node.args[0].value, "many": node.func.attr == "executemany"})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--warehouse-id", required=True)
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--schema", required=True)
    a = ap.parse_args()
    os.environ.update({"DATABRICKS_CONFIG_PROFILE": a.profile, "DELTA_CATALOG": a.catalog,
                       "DELTA_SCHEMA": a.schema, "DATABRICKS_WAREHOUSE_ID": a.warehouse_id})

    from server.storage.delta import DeltaBackend

    class DryRun(DeltaBackend):
        def __init__(self):
            super().__init__()
            self.sent: list[str] = []

        async def _run(self, sql):
            self.sent.append(sql)
            return [], [], []

    real = DeltaBackend()
    failures, checked, skipped = [], 0, 0
    import re
    for item in corpus():
        sql = item["sql"]
        if re.match(r"\s*(CREATE|ALTER|DROP|GRANT|TRUNCATE)\b", sql, re.I) or "schema_migrations" in sql:
            skipped += 1
            continue
        try:
            nargs = max([int(n) for n in re.findall(r"\$(\d+)", sql)] or [0])
            dry = DryRun()
            args = tuple([None] * nargs)
            if item["many"]:
                asyncio.run(dry.executemany(sql, [args]))
            else:
                asyncio.run(dry.fetch(sql, *args))
        except Exception as exc:  # noqa: BLE001
            failures.append((item["where"], "translate", str(exc).splitlines()[0][:200]))
            continue
        for stmt in dry.sent:
            checked += 1
            try:
                real._run_sync("EXPLAIN " + stmt)
            except Exception as exc:  # noqa: BLE001
                msg = " ".join(str(exc).split())
                failures.append((item["where"], "explain", msg[:260] + " :: " + stmt[:300]))
    for where, kind, msg in failures:
        print(f"FAIL {kind:9} {where}\n     {msg}")
    print(f"\n{checked} statements explained, {skipped} DDL/ledger skipped, {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
