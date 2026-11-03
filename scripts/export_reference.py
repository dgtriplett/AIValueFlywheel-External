"""MAINTAINER TOOL — export the curated reference catalog to reference/catalog.json.

Reads ONLY the reference tables (use cases, data assets, domains, data sources,
dependency edges, default value assumptions) from an existing instance and writes
the versioned bundle the setup job seeds every new install from. Nothing
account-scoped is read: no business units, assessments, portfolio membership,
statuses, comments, value records, or knowledge-base articles.

Every row is normalized to day-1 state on the way out: use cases not_started with
realized value cleared, data assets not_started with discovery counters reset,
authorship set to 'reference'. Run scripts/check_reference.py afterwards — it
fails on any customer or person name in the bundle.

    python scripts/export_reference.py --profile <cli-profile> --project <lakebase-project> \
        [--branch production] [--endpoint primary] [--db app] --version 2026.11
"""
from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


def get_conn(profile, project, branch, endpoint, database):
    """psycopg2 connection to a Lakebase database as the CLI profile's user."""
    import subprocess

    import psycopg2

    def cli(*args):
        out = subprocess.run(["databricks", *args, "-p", profile, "-o", "json"],
                             capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    branch_path = f"projects/{project}/branches/{branch}"
    host = cli("postgres", "list-endpoints", branch_path)[0]["status"]["hosts"]["host"]
    token = cli("postgres", "generate-database-credential", f"{branch_path}/endpoints/{endpoint}")["token"]
    user = cli("current-user", "me")["userName"]
    return psycopg2.connect(host=host, port=5432, dbname=database, user=user,
                            password=token, sslmode="require")

OUT = Path(__file__).resolve().parent.parent / "reference" / "catalog.json"

# table -> (columns, WHERE, ORDER BY). Columns are explicit so a new
# account-scoped column can never leak into the bundle by accident.
TABLES = {
    "lobs": (["id", "name", "description"], "", "id"),
    "data_domains": (["id", "name", "label", "description", "category", "example_attributes",
                      "is_active", "origin"], "", "id"),
    "data_assets": (["id", "source_category", "vendor", "source_system", "module", "description",
                     "sub_vertical", "ingest_effort", "ingest_cost_low", "ingest_cost_high",
                     "owning_lob_id", "origin", "tier", "curate_effort"], "origin = 'catalog'", "id"),
    "data_asset_lobs": (["data_asset_id", "lob_id"], "", "data_asset_id, lob_id"),
    "asset_serves_domain": (["data_asset_id", "domain_id", "confidence", "mapped_by", "notes"], "",
                            "data_asset_id, domain_id"),
    "use_cases": (["id", "title", "description", "lob_id", "sub_vertical", "stage", "phase",
                   "category", "effort_tshirt", "priority_score", "risk_tags", "compliance_tags",
                   "hypothesized_value_json", "requires_locked", "origin", "domains_locked"],
                  "origin = 'catalog'", "id"),
    "uc_requires_asset": (["use_case_id", "data_asset_id", "criticality", "manual"], "",
                          "use_case_id, data_asset_id"),
    "uc_requires_domain": (["use_case_id", "domain_id", "necessity", "rationale", "mapped_by", "manual"],
                           "", "use_case_id, domain_id"),
    "uc_enables_uc": (["from_use_case_id", "to_use_case_id", "detected_by_agent", "rationale"], "",
                      "from_use_case_id, to_use_case_id"),
    "data_sources": (["id", "name", "category", "description", "utility_types", "match_terms",
                      "sort_order", "is_active", "origin"], "", "sort_order, id"),
    "data_source_rollup": (["data_asset_id", "data_source_id", "mapped_by"], "",
                           "data_source_id, data_asset_id"),
    "data_source_domains": (["data_source_id", "domain_id"], "", "data_source_id, domain_id"),
    "asset_feeds": (["product_asset_id", "raw_asset_id", "mapped_by"], "",
                    "product_asset_id, raw_asset_id"),
    "value_assumptions": (["key", "label", "value", "unit", "category", "description", "source",
                           "source_note", "confidence"], "account_id IS NULL", "category, key"),
}


def _jsonable(v):
    if isinstance(v, Decimal):
        return float(v) if v != v.to_integral_value() else int(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--branch", default="production")
    ap.add_argument("--endpoint", default="primary")
    ap.add_argument("--db", default="app")
    ap.add_argument("--version", required=True, help="reference version label, e.g. 2026.11")
    args = ap.parse_args()

    conn = get_conn(args.profile, args.project, args.branch, args.endpoint, args.db)
    conn.set_session(readonly=True)
    cur = conn.cursor()
    bundle: dict = {"version": args.version, "tables": {}}
    for table, (cols, where, order) in TABLES.items():
        cur.execute(f"SELECT {', '.join(cols)} FROM {table}"
                    + (f" WHERE {where}" if where else "") + f" ORDER BY {order}")
        rows = [dict(zip(cols, map(_jsonable, r))) for r in cur.fetchall()]
        bundle["tables"][table] = rows

    t = bundle["tables"]
    uc_ids = {u["id"] for u in t["use_cases"]}
    asset_ids = {a["id"] for a in t["data_assets"]}
    # Edges only between reference rows.
    t["uc_requires_asset"] = [r for r in t["uc_requires_asset"]
                              if r["use_case_id"] in uc_ids and r["data_asset_id"] in asset_ids]
    t["uc_requires_domain"] = [r for r in t["uc_requires_domain"] if r["use_case_id"] in uc_ids]
    t["uc_enables_uc"] = [r for r in t["uc_enables_uc"]
                          if r["from_use_case_id"] in uc_ids and r["to_use_case_id"] in uc_ids]
    for key in ("data_asset_lobs", "asset_serves_domain", "data_source_rollup"):
        t[key] = [r for r in t[key] if r["data_asset_id"] in asset_ids]
    t["asset_feeds"] = [r for r in t["asset_feeds"]
                        if r["product_asset_id"] in asset_ids and r["raw_asset_id"] in asset_ids]
    # hypothesized_value_json comes back as text from psycopg2 for jsonb? (it is
    # decoded to a dict) — store as an object either way.
    for u in t["use_cases"]:
        if isinstance(u["hypothesized_value_json"], str):
            u["hypothesized_value_json"] = json.loads(u["hypothesized_value_json"])

    # The assessment-worksheet crosswalk (worksheet use-case id -> catalog title) is
    # maintained in the bundle itself; carry it forward across re-exports.
    if OUT.exists():
        bundle["crosswalks"] = json.loads(OUT.read_text()).get("crosswalks", {})
    titles = {u["title"] for u in t["use_cases"]}
    stale = [k for k, v in bundle.get("crosswalks", {}).get("assessment_use_case_title", {}).items()
             if v not in titles]
    if stale:
        print(f"WARNING: {len(stale)} worksheet ids no longer match a catalog title: {stale[:5]}")

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(bundle, indent=1, sort_keys=False) + "\n")
    print(f"wrote {OUT} (version {args.version}): "
          + ", ".join(f"{k}={len(v)}" for k, v in t.items()))


if __name__ == "__main__":
    main()
