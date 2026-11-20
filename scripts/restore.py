#!/usr/bin/env python3
"""Restore an AI Value Realization backup into an install (either storage backend).

Download a backup from the app (Admin → Business units → Download backup), then:

    python scripts/restore.py --file backup.json --profile <cli-profile> \
        --storage-backend lakebase --lakebase-project <project> --app-name <app>
    python scripts/restore.py --file backup.json --profile <cli-profile> \
        --storage-backend delta --delta-catalog <catalog> --delta-schema <schema> \
        --warehouse-id <id> --app-name <app>

The target must already be set up (deploy the bundle first; its setup job creates
the schema). Rows are keyed on their primary keys, so re-running is safe; pass
--replace to overwrite rows that already exist. Runs as you — the deployer.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import setup as setup_job  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--file", required=True)
    ap.add_argument("--replace", action="store_true", help="overwrite rows that already exist")
    ap.add_argument("--profile", default="")
    ap.add_argument("--storage-backend", choices=["lakebase", "delta"], required=True)
    ap.add_argument("--app-name", default="ai-value-realization")
    ap.add_argument("--warehouse-id", default="")
    ap.add_argument("--lakebase-project", default="ai-value-realization")
    ap.add_argument("--lakebase-branch", default="production")
    ap.add_argument("--pg-database", default="databricks_postgres")
    ap.add_argument("--delta-catalog", default="")
    ap.add_argument("--delta-schema", default="")
    args = ap.parse_args()

    data = json.loads(Path(args.file).read_text())
    w = setup_job.workspace(args.profile)
    if args.storage_backend == "lakebase":
        setup_job.configure_lakebase(w, args)
    else:
        setup_job.configure_delta(w, args)

    from server import backup
    from server.db import db

    async def run():
        counts = await backup.restore(db, data, replace=args.replace)
        from server.phase import recompute_and_store
        await recompute_and_store()
        await db.close()
        return counts

    counts = setup_job.run_async(run())
    print(f"[restore] restored {sum(counts.values())} rows into {len(counts)} tables "
          f"({args.storage_backend}); backup taken {data.get('created_at')} "
          f"from {data.get('storage_backend')} app {data.get('app_version')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
