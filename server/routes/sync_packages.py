"""Catalog export for companion tools.

This app is the system of record for use cases, data needs, dependencies, roadmap
status and value assumptions. `GET /api/sync/catalog` exports that as one package, so
a planning tool can align its roadmap to the catalog (e.g. fill each roadmap use
case's `catalog_match`) before producing a roadmap package for import
(server/routes/roadmap_import.py, ROADMAP_PACKAGE.md).

`_lookup_asset` resolves a free-text data-need label to a catalog data asset; the
roadmap import uses it for the use cases it creates.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import accounts
from ..common import row_to_dict, rows_to_list
from ..db import db
from .. import portfolio
from ..roadmap_asset_resolution import canonical_asset_target
from ..readiness import readiness_map
from ..value_engine import compute_value_range, load_assumptions

router = APIRouter(prefix="/sync", tags=["sync"])


def _hash_payload(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _clean_label(value: Any) -> str:
    return " ".join(str(value or "").replace("\n", " ").split()).strip()


async def _optional_rows(sql: str, *args) -> list[dict]:
    try:
        return rows_to_list(await db.fetch(sql, *args))
    except Exception:
        return []


@router.get("/catalog")
@router.get("/value-flywheel-catalog", include_in_schema=False)  # 1.x path, kept for old clients
async def export_catalog(scope: str = "all"):
    """The catalog (and this business unit's portfolio) as one package.

    `scope=all` exports the shared library plus the active portfolio. A receiving
    tool should keep this app's use-case id as the external id, so later runs line
    up with the same records.
    """
    if scope not in {"all", "portfolio", "catalog"}:
        raise HTTPException(422, "scope must be all|portfolio|catalog")

    where = ""
    params = []
    if scope == "portfolio":
        condition, params = await portfolio.portfolio_condition("uc")
        where = f"WHERE {condition}"
    elif scope == "catalog":
        where = "WHERE uc.origin = 'catalog'"

    rows = await db.fetch(f"""
        SELECT uc.*, l.name AS lob_name
        FROM use_cases uc
        LEFT JOIN lobs l ON l.id = uc.lob_id
        {where}
        ORDER BY uc.id
    """, *params)
    use_cases = rows_to_list(rows)
    assumptions = await load_assumptions()
    rmap = await readiness_map()

    req_assets = await _optional_rows("""
        SELECT ura.use_case_id, ura.data_asset_id, ura.criticality,
               da.source_category, da.vendor, da.source_system, da.module,
               da.description, da.sub_vertical, da.uc_catalog, da.uc_schema
        FROM uc_requires_asset ura
        JOIN data_assets da ON da.id = ura.data_asset_id
        ORDER BY ura.use_case_id, da.module
    """)
    req_domains = await _optional_rows("""
        SELECT urd.use_case_id, urd.domain_id, urd.necessity, urd.rationale,
               dd.name, dd.label, dd.description, dd.category
        FROM uc_requires_domain urd
        JOIN data_domains dd ON dd.id = urd.domain_id
        ORDER BY urd.use_case_id, dd.label
    """)
    enables = await _optional_rows("""
        SELECT from_use_case_id, to_use_case_id, detected_by_agent, rationale
        FROM uc_enables_uc
        ORDER BY from_use_case_id, to_use_case_id
    """)

    assets_by_uc: dict[int, list[dict]] = {}
    for row in req_assets:
        assets_by_uc.setdefault(row["use_case_id"], []).append(row)
    domains_by_uc: dict[int, list[dict]] = {}
    for row in req_domains:
        domains_by_uc.setdefault(row["use_case_id"], []).append(row)
    deps_by_uc: dict[int, list[int]] = {}
    for edge in enables:
        deps_by_uc.setdefault(edge["to_use_case_id"], []).append(edge["from_use_case_id"])

    for uc in use_cases:
        uc_id = uc["id"]
        rng = compute_value_range(uc.get("hypothesized_value_json"), assumptions)
        uc["computedValueMM"] = rng["mid"] if rng else None
        uc["valueRangeMM"] = rng
        uc["readiness"] = rmap.get(uc_id)
        uc["requiredDataAssets"] = assets_by_uc.get(uc_id, [])
        uc["requiredDataDomains"] = domains_by_uc.get(uc_id, [])
        uc["prerequisiteUseCaseIds"] = deps_by_uc.get(uc_id, [])

    account_id = await accounts.current()
    account_row = None
    if account_id is not None:
        account_row = row_to_dict(await db.fetchrow(
            "SELECT id, slug, name, utility_type FROM accounts WHERE id=$1",
            account_id,
        ))

    roadmap_where = ""
    roadmap_args: tuple = ()
    if account_id is not None:
        roadmap_where = "WHERE ri.account_id=$1"
        roadmap_args = (account_id,)
    roadmap = rows_to_list(await db.fetch(f"""
        SELECT ri.*, uc.title AS use_case_title
        FROM roadmap_items ri
        JOIN use_cases uc ON uc.id = ri.use_case_id
        {roadmap_where}
        ORDER BY ri.wave NULLS LAST, ri.id
    """, *roadmap_args))

    return {
        "schemaVersion": "aivr.catalog.v1",
        "packageType": "catalog",
        "sourceApp": "ai-value-realization",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "account": account_row,
        "scope": scope,
        "useCases": use_cases,
        "dataAssets": rows_to_list(await db.fetch("SELECT * FROM data_assets ORDER BY id")),
        "dataDomains": await _optional_rows("SELECT * FROM data_domains ORDER BY id"),
        "requires": req_assets,
        "requiresDomains": req_domains,
        "enables": enables,
        "roadmapItems": roadmap,
        "valueAssumptions": rows_to_list(await db.fetch("""
            SELECT DISTINCT ON (key) *
            FROM value_assumptions
            WHERE account_id = $1 OR account_id IS NULL
            ORDER BY key, (account_id IS NULL)
        """, account_id)) if account_id is not None else rows_to_list(await db.fetch(
            "SELECT * FROM value_assumptions ORDER BY category, key"
        )),
    }


async def _lookup_asset(label: str) -> int | None:
    clean = _clean_label(label)
    target = canonical_asset_target(clean)
    if target:
        existing = await db.fetchrow("""
            SELECT id FROM data_assets
            WHERE lower(source_category) = lower($1)
              AND lower(module) = lower($2)
            LIMIT 1
        """, target[0], target[1])
        if existing:
            return int(existing["id"])

    existing = await db.fetchrow("""
        SELECT id FROM data_assets
        WHERE lower(module) = lower($1)
           OR lower(source_system || ' ' || module) = lower($1)
           OR lower(source_category || ' ' || module) = lower($1)
        LIMIT 1
    """, clean)
    if existing:
        return int(existing["id"])
    return None
