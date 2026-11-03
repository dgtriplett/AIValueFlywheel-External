"""The reference catalog shipped with the app (reference/catalog.json) and its seeder.

The bundle holds ONLY reference content — use cases, data assets, data domains,
data sources, the dependency edges between them, and default value assumptions.
Seeding never writes business-unit data (assessments, portfolios, statuses,
comments, value records); a new install starts with the full catalog and an empty
portfolio.

UPGRADE SEMANTICS
-----------------
`seed()` inserts reference rows that are missing and leaves existing rows alone,
so re-running setup never overwrites a catalog row an admin edited and never
touches business-unit data. `refresh=True` (setup's --refresh-catalog) also
updates existing reference rows to the shipped version.

Reference rows keep the small ids they ship with. Ids for rows created in the app
start at 1,000,000 (Lakebase sequence floor; Delta's generated ids are far larger),
so a future catalog version can add rows without colliding with yours.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

BUNDLE = Path(__file__).resolve().parent.parent / "reference" / "catalog.json"
CUSTOM_ID_FLOOR = 1_000_000

# Seed order respects foreign keys. Conflict keys come from each table's primary key.
TABLE_ORDER: list[str] = [
    "lobs", "data_domains", "data_assets", "data_asset_lobs", "asset_serves_domain",
    "use_cases", "uc_requires_asset", "uc_requires_domain", "uc_enables_uc",
    "data_sources", "data_source_rollup", "data_source_domains", "asset_feeds",
]

# Columns forced on the way in: every reference row starts at day-1 state.
DAY_ONE = {
    "use_cases": {"status": "not_started", "status_source": "manual", "in_portfolio": False,
                  "created_by": "reference"},
    "data_assets": {"ingestion_status": "not_started", "created_by": "reference"},
}


def _column_kinds(table: str) -> dict[str, str]:
    """column -> 'json' | 'array' | '' from the generated schema metadata."""
    from .storage.translate import table_meta
    out = {}
    for c in table_meta(table)["columns"]:
        out[c["name"]] = ("json" if c["pg_type"] in ("jsonb", "json")
                          else "array" if c["type"].startswith("ARRAY") else "")
    return out

FEATURE_FLAGS = [
    ("exp_strategic_roadmap", "Strategic Roadmap", "Phased 3/5-year roadmap with capacity model, investment dial, and accelerators on the results dashboard.", "Roadmap", "on", 10),
    ("exp_ai_exec_summary", "AI Executive Summary", "LLM-generated executive summary narrative on the results dashboard.", "AI", "on", 20),
    ("exp_ai_consistency_check", "AI Consistency Check", "Pre-submit LLM audit that flags contradictory assessment answers before saving.", "AI", "on", 30),
    ("exp_poc_scope_generator", "POC Scope Generator", "Generate a proof-of-concept statement of work for a use case.", "AI", "on", 50),
    ("exp_score_explainer", "Score Explainer", "Inline explanation of how each maturity dimension score was computed.", "Insights", "on", 60),
    ("exp_outcome_tracking", "Outcome Tracking", "Track realized outcomes/value against the roadmap over time.", "Operate", "on", 70),
    ("exp_external_anchors", "External Anchors", "Anchor recommendations to external references and benchmarks.", "Insights", "off", 80),
]

KB_FOLDERS = [
    ("Standards & Specifications", "/standards-specifications/", 10),
    ("Proposals & Business Cases", "/proposals-business-cases/", 20),
    ("Studies & Assessments", "/studies-assessments/", 30),
    ("Runbooks & Procedures", "/runbooks-procedures/", 40),
]


@lru_cache(maxsize=1)
def bundle() -> dict:
    return json.loads(BUNDLE.read_text())


def version() -> str:
    return bundle().get("version", "unknown")


def assessment_title_crosswalk() -> dict[str, str]:
    """Assessment-worksheet use-case id (e.g. p1_gen_demand_forecast) -> catalog title."""
    return dict(bundle().get("crosswalks", {}).get("assessment_use_case_title", {}))


def default_assumptions() -> list[dict]:
    return list(bundle()["tables"]["value_assumptions"])


def _row_values(kinds: dict[str, str], row: dict, cols: list[str]) -> tuple:
    out = []
    for c in cols:
        v = row.get(c)
        if kinds.get(c) == "json" and v is not None and not isinstance(v, str):
            v = json.dumps(v)
        if kinds.get(c) == "array" and v is None:
            v = []
        out.append(v)
    return tuple(out)


def _cast(kinds: dict[str, str], col: str, i: int) -> str:
    return {"json": f"${i}::jsonb", "array": f"${i}::text[]"}.get(kinds.get(col, ""), f"${i}")


async def seed(db, *, refresh: bool = False, org_name: str | None = None,
               admins: list[str] | None = None, actor: str = "setup") -> dict:
    """Load the reference catalog + install defaults. Idempotent."""
    tables = bundle()["tables"]
    counts: dict[str, int] = {}
    from .storage.translate import table_meta
    for table in TABLE_ORDER:
        keys = table_meta(table)["primary_key"]
        rows = tables.get(table) or []
        if not rows:
            continue
        forced = DAY_ONE.get(table, {})
        kinds = _column_kinds(table)
        cols = list(rows[0].keys()) + [c for c in forced if c not in rows[0]]
        placeholders = ", ".join(_cast(kinds, c, i + 1) for i, c in enumerate(cols))
        non_keys = [c for c in cols if c not in keys and c not in forced]
        action = ("DO UPDATE SET " + ", ".join(f"{c}=EXCLUDED.{c}" for c in non_keys)
                  if refresh and non_keys else "DO NOTHING")
        sql = (f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
               f"ON CONFLICT ({', '.join(keys)}) {action}")
        values = [_row_values(kinds, {**r, **forced}, cols) for r in rows]
        await db.executemany(sql, values)
        counts[table] = len(values)

    # Default value assumptions (account_id NULL = the product baseline).
    va = default_assumptions()
    existing = {r["key"] for r in await db.fetch(
        "SELECT key FROM value_assumptions WHERE account_id IS NULL")}
    new_rows = [(a["key"], a["label"], a["value"], a["unit"], a["category"], a.get("description"),
                 a.get("source") or "seed", a.get("source_note"), a.get("confidence"))
                for a in va if a["key"] not in existing]
    await db.executemany(
        "INSERT INTO value_assumptions (key, label, value, unit, category, description, source, "
        "source_note, confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", new_rows)
    counts["value_assumptions"] = len(new_rows)

    await db.executemany(
        "INSERT INTO feature_flags (key, label, description, category, state, sort_order) "
        "VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING", FEATURE_FLAGS)
    have_folders = {r["path"] for r in await db.fetch("SELECT path FROM kb_folders")}
    await db.executemany(
        "INSERT INTO kb_folders (name, path, sort_order, created_by) VALUES ($1,$2,$3,'seed')",
        [f for f in KB_FOLDERS if f[1] not in have_folders])

    # The first business unit. Named from setup's organization_name; renamed in-app later.
    if await db.fetchrow("SELECT id FROM accounts LIMIT 1") is None:
        name = (org_name or "").strip() or "My organization"
        await db.execute(
            "INSERT INTO accounts (slug, name, is_default, created_by) VALUES ($1,$2,true,$3)",
            _slug(name), name, actor)
        row = await db.fetchrow("SELECT id FROM accounts WHERE is_default")
        if row is not None:
            from .routes.accounts import _seed_assumptions_for_account
            await _seed_assumptions_for_account(row["id"], actor)

    for email in admins or []:
        if email.strip():
            await db.execute(
                "INSERT INTO admins (user_email, added_by) VALUES ($1,$2) "
                "ON CONFLICT (user_email) DO NOTHING", email.strip().lower(), actor)

    if getattr(db, "backend_name", "lakebase") == "lakebase":
        # Rows created in the app get ids above the reference range.
        for table, meta_serial in await _serial_tables(db):
            await db.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', '{meta_serial}'), "
                f"GREATEST((SELECT COALESCE(max({meta_serial}), 0) FROM {table}), {CUSTOM_ID_FLOOR - 1}))")

    from .phase import recompute_and_store
    await recompute_and_store()
    logger.info("reference catalog %s seeded: %s", version(), counts)
    return {"version": version(), "counts": counts}


async def _serial_tables(db) -> list[tuple[str, str]]:
    from .storage.translate import schema_meta
    return [(t, m["serial"]) for t, m in schema_meta().items() if m.get("serial")]


def _slug(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "default"
