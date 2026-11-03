"""What-if: land these sources, and see what changes.

    GET  /api/whatif/candidates            sources worth simulating, ranked
    POST /api/whatif/simulate              project landing a set of sources
    POST /api/whatif/simulate/compare      several options side by side

WHY THIS IS THE MOST USEFUL SCREEN IN THE APP
---------------------------------------------
Every other view answers "where are we". This one answers "what should we do next",
which is the question a funding conversation actually turns on. The portfolio already
knows which use cases each source unblocks and what they are worth; without this the
customer has to hold that join in their head.

WHY IT REUSES readiness_map()
-----------------------------
The projection runs the REAL readiness logic against a hypothetical status map rather
than reimplementing it. That matters more than it sounds: readiness has a dual path,
a requires_locked override, a domain-satisfaction rule with vendor substitution, and a
prerequisite condition. A second implementation would drift, and the failure mode is
the worst kind — a simulator that confidently predicts an outcome the app then does
not produce, which destroys trust in both numbers.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
It writes nothing. No confirm gate, no audit row, no status change. It is a
projection, and a read-only projection can be run freely during a workshop without
anyone worrying they have changed the portfolio.

It also does not model TIME. Landing a source takes months and the value ramps; that
is the roadmap's job. This answers the narrower, cleaner question: at full run-rate,
what does this unlock?
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..common import rows_to_list
from ..db import db
from .. import accounts, portfolio
from ..readiness import READY_STATUSES, readiness_map, ready_assets
from ..value_engine import EFFORT_COST, asset_cost, load_assumptions, use_case_value

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/whatif", tags=["whatif"])

# The status a simulated source is assumed to reach. 'governed' rather than 'curated'
# because a source you have deliberately invested in landing gets governed — and
# both count as ready, so the projection is the same either way.
SIMULATED_STATUS = "governed"

# Cap on how many sources one simulation may include. A large combination is a
# different question ("what if we did everything?") whose answer is just the
# portfolio total, and the response size grows with the unlocked set.
MAX_SOURCES = 12


class SimulateIn(BaseModel):
    data_asset_ids: list[int] = Field(..., min_length=1, max_length=MAX_SOURCES)


class CompareIn(BaseModel):
    # Each option is a set of sources to land together, so "OMS alone" can be
    # compared against "OMS + AMI".
    options: list[list[int]] = Field(..., min_length=2, max_length=6)


@router.get("/candidates")
async def candidates(limit: int = Query(default=20, ge=1, le=100)):
    """Unlanded sources ranked by what landing one would unblock.

    Ranked by value-per-dollar rather than raw value: a $60M unlock costing $2.5M is
    a better first move than an $80M unlock costing $12M, and a list sorted by value
    alone quietly recommends the expensive one.
    """
    account_id = await accounts.current()
    assets = rows_to_list(await db.fetch("""
        SELECT da.id, da.source_category, da.module, da.vendor, da.ingest_effort,
               da.ingest_cost_low, da.ingest_cost_high,
               COALESCE(s.ingestion_status, 'not_started') AS ingestion_status
        FROM data_assets da
        LEFT JOIN asset_status_by_account s
               ON s.data_asset_id = da.id
              AND s.account_id = $1
        ORDER BY da.id
    """, account_id))
    unlanded = [a for a in assets if a["ingestion_status"] not in READY_STATUSES]
    if not unlanded:
        return {"candidates": [], "note": "Every source is already landed."}

    baseline = await readiness_map()
    assumptions = await load_assumptions()
    condition, params = await portfolio.portfolio_condition("uc")
    use_cases = {u["id"]: dict(u) for u in await db.fetch(
        "SELECT uc.id, uc.title, uc.lob_id, uc.effort_tshirt, "
        f"uc.hypothesized_value_json, uc.status FROM use_cases uc WHERE {condition}",
        *params)}

    results = []
    for asset in unlanded:
        projected = await readiness_map({asset["id"]: SIMULATED_STATUS})
        flipped = _newly_ready(baseline, projected)
        value = sum(use_case_value(use_cases[uc_id], assumptions)
                    for uc_id in flipped if uc_id in use_cases)
        low, high = asset_cost(asset)
        mid_cost = (low + high) / 2
        results.append({
            "data_asset_id": asset["id"],
            "source": asset["source_category"],
            "module": asset["module"],
            "vendor": asset["vendor"],
            "status": asset["ingestion_status"],
            "effort": asset["ingest_effort"],
            "cost_low": low, "cost_high": high,
            "use_cases_unblocked": len(flipped),
            "value_unblocked_mm": round(value, 2),
            # $M of annual value per $M of one-time cost. The ranking key.
            "value_per_cost": round(value / (mid_cost / 1_000_000), 2)
                              if mid_cost > 0 else None,
        })

    # Sources that unblock nothing are dropped rather than listed with zeros: a list
    # of 76 rows where 60 are zeros hides the 16 that matter.
    results = [r for r in results if r["use_cases_unblocked"] > 0]
    results.sort(key=lambda r: (-(r["value_per_cost"] or 0),
                                -r["value_unblocked_mm"]))
    return {
        "candidates": results[:limit],
        "evaluated": len(unlanded),
        "with_impact": len(results),
        "note": ("Ranked by annual value unblocked per dollar of one-time cost. "
                 f"{len(unlanded) - len(results)} unlanded source(s) unblock nothing "
                 "on their own — they are prerequisites that need a second source "
                 "landed alongside." if len(results) < len(unlanded) else
                 "Ranked by annual value unblocked per dollar of one-time cost."),
    }


def _newly_ready(baseline: dict, projected: dict) -> list[int]:
    """Use case ids that become shovel_ready in the projection but were not before."""
    return [uc_id for uc_id, after in projected.items()
            if after.get("readiness") == "shovel_ready"
            and baseline.get(uc_id, {}).get("readiness") != "shovel_ready"]


def _newly_unblocked_data(baseline: dict, projected: dict) -> list[int]:
    """Use cases whose DATA completes, even if prerequisites still hold them back.

    Reported separately because it is a genuinely different outcome: the data gap is
    closed and the remaining blocker is sequencing, not ingestion. Folding these into
    "unblocked" would overstate what landing a source achieves; omitting them would
    understate it.
    """
    out = []
    for uc_id, after in projected.items():
        before = baseline.get(uc_id, {})
        if after.get("readiness") == "awaiting_prerequisites" \
                and before.get("readiness") not in ("awaiting_prerequisites",
                                                    "shovel_ready"):
            out.append(uc_id)
    return out


async def _simulate(asset_ids: list[int]) -> dict:
    """The projection for landing `asset_ids` together."""
    assets = rows_to_list(await db.fetch(
        "SELECT id, source_category, module, vendor, ingest_effort, "
        "ingest_cost_low, ingest_cost_high, ingestion_status "
        "FROM data_assets WHERE id = ANY($1::int[])", asset_ids))
    found = {a["id"] for a in assets}
    missing = [i for i in asset_ids if i not in found]
    if missing:
        raise HTTPException(404, f"No data source with id(s): {missing}")

    baseline = await readiness_map()
    projected = await readiness_map({i: SIMULATED_STATUS for i in asset_ids})
    assumptions = await load_assumptions()

    condition, params = await portfolio.portfolio_condition("u")
    use_cases = {u["id"]: dict(u) for u in await db.fetch(f"""
        SELECT u.id, u.title, u.lob_id, u.effort_tshirt, u.status,
               u.hypothesized_value_json, l.name AS lob
        FROM use_cases u LEFT JOIN lobs l ON l.id = u.lob_id
        WHERE {condition}
    """, *params)}

    flipped = _newly_ready(baseline, projected)
    data_only = _newly_unblocked_data(baseline, projected)

    def describe(uc_id: int) -> dict | None:
        uc = use_cases.get(uc_id)
        if uc is None:
            return None
        return {
            "id": uc_id, "title": uc["title"], "lob": uc.get("lob"),
            "effort": uc.get("effort_tshirt"),
            "value_mm": round(use_case_value(uc, assumptions), 2),
            "still_pending": [p["title"] for p in
                              projected.get(uc_id, {}).get("pending_prereqs", [])],
        }

    unlocked = [d for d in (describe(i) for i in flipped) if d]
    awaiting = [d for d in (describe(i) for i in data_only) if d]
    unlocked.sort(key=lambda d: -d["value_mm"])
    awaiting.sort(key=lambda d: -d["value_mm"])

    # Cost: the sources, plus the delivery effort of the use cases you would then
    # actually build. A source cost alone is not the investment — nobody lands data
    # and stops.
    source_low = source_high = 0.0
    for asset in assets:
        low, high = asset_cost(asset)
        source_low += low
        source_high += high
    delivery_mid = 0.0
    for item in unlocked:
        low, high = EFFORT_COST.get(item["effort"] or "M", EFFORT_COST["M"])
        delivery_mid += (low + high) / 2

    annual_value = sum(d["value_mm"] for d in unlocked)
    source_mid = (source_low + source_high) / 2
    total_cost = source_mid + delivery_mid

    by_lob: dict[str, float] = {}
    for item in unlocked:
        key = item["lob"] or "Unassigned"
        by_lob[key] = round(by_lob.get(key, 0) + item["value_mm"], 2)

    return {
        "sources": [{"id": a["id"], "source": a["source_category"],
                     "module": a["module"], "vendor": a["vendor"],
                     "current_status": a["ingestion_status"],
                     "effort": a["ingest_effort"]} for a in assets],
        "unlocked": unlocked,
        "unlocked_count": len(unlocked),
        "annual_value_mm": round(annual_value, 2),
        "value_by_lob": dict(sorted(by_lob.items(), key=lambda kv: -kv[1])),
        # The honest second number: data done, sequencing outstanding.
        "data_complete_awaiting_prerequisites": awaiting,
        "awaiting_count": len(awaiting),
        "awaiting_value_mm": round(sum(d["value_mm"] for d in awaiting), 2),
        "cost": {
            "sources_low": round(source_low), "sources_high": round(source_high),
            "delivery_mid": round(delivery_mid),
            "total_mid": round(total_cost),
        },
        # Simple payback on the mid figures. Deliberately not a ramped NPV: this is a
        # directional comparison between options, and a discounted model here would
        # imply a precision the inputs do not support.
        "payback_months": round(total_cost / (annual_value * 1_000_000 / 12), 1)
                          if annual_value > 0 and total_cost > 0 else None,
        "baseline": {
            "shovel_ready": sum(1 for v in baseline.values()
                                if v.get("readiness") == "shovel_ready"),
        },
        "projected": {
            "shovel_ready": sum(1 for v in projected.values()
                                if v.get("readiness") == "shovel_ready"),
        },
    }


@router.post("/simulate")
async def simulate(body: SimulateIn):
    """Project landing one or more sources. Writes nothing."""
    unique = list(dict.fromkeys(body.data_asset_ids))
    result = await _simulate(unique)
    return {**result, "note": "Projection only — nothing was changed."}


@router.post("/simulate/compare")
async def compare(body: CompareIn):
    """Several landing options side by side, ranked by value per dollar.

    This is the shape of the actual decision: not "is landing the OMS good" but
    "is the OMS a better first move than the AMI head-end".
    """
    options = []
    for index, ids in enumerate(body.options):
        unique = list(dict.fromkeys(ids))
        if not unique or len(unique) > MAX_SOURCES:
            raise HTTPException(
                422, f"Option {index + 1} must contain between 1 and "
                     f"{MAX_SOURCES} source ids.")
        result = await _simulate(unique)
        cost = result["cost"]["total_mid"]
        options.append({
            "option": index + 1,
            "sources": [s["module"] for s in result["sources"]],
            "unlocked_count": result["unlocked_count"],
            "annual_value_mm": result["annual_value_mm"],
            "total_cost": cost,
            "payback_months": result["payback_months"],
            "value_per_cost": round(
                result["annual_value_mm"] / (cost / 1_000_000), 2)
                if cost > 0 else None,
            "top_unlocked": [u["title"] for u in result["unlocked"][:5]],
        })
    options.sort(key=lambda o: -(o["value_per_cost"] or 0))
    return {"options": options,
            "note": "Ranked by annual value unblocked per dollar of total cost "
                    "(sources plus the delivery effort of what they unlock)."}


# ---------------------------------------------------------------------------
# Graph — the layered dependency tree behind the visual What-If + roadmap timelapse
# ---------------------------------------------------------------------------
@router.get("/graph")
async def whatif_graph():
    """Account-scoped dependency graph for the visual What-If + Execute-Roadmap views:
    raw datasets → curated data products → use cases, with per-account status/readiness.

    Nodes are the account's portfolio use cases, the assets they require (raw + product),
    and any raw datasets that feed those products. Edges: feeds (raw→product), requires
    (asset→use case, tier + criticality), enables (use case→use case). Reuses
    readiness_map() + ready_assets() so the colours match every other screen."""
    account_id = await accounts.current()
    if account_id is None:
        return {"account_id": None, "nodes": {"raw": [], "product": [], "use_case": []},
                "edges": {"feeds": [], "requires": [], "enables": []}}

    assumptions = await load_assumptions()
    rmap = await readiness_map()
    ready_ids = set(await ready_assets())

    # Catalog-inclusive: return EVERY use case (with an in_portfolio flag) so the
    # What-If can show the full opportunity, not just the shortlist. The frontend
    # defaults to portfolio + top-value unlocked and offers "show all catalog".
    pcond, pparams = await portfolio.portfolio_condition("uc")
    ucs = [dict(u) for u in await db.fetch(
        f"SELECT uc.id, uc.title, uc.phase, uc.hypothesized_value_json, "
        f"({pcond}) AS in_portfolio FROM use_cases uc ORDER BY uc.phase, uc.id", *pparams)]
    uc_ids = [u["id"] for u in ucs]
    if not uc_ids:
        return {"account_id": account_id, "nodes": {"raw": [], "product": [], "use_case": []},
                "edges": {"feeds": [], "requires": [], "enables": []}}

    # required assets for these use cases
    req_rows = await db.fetch(
        """SELECT ura.use_case_id, ura.data_asset_id, ura.criticality,
                  da.module, da.source_category, da.tier, da.curate_effort
           FROM uc_requires_asset ura JOIN data_assets da ON da.id = ura.data_asset_id
           WHERE ura.use_case_id = ANY($1::int[])""", uc_ids)
    asset_ids = {r["data_asset_id"] for r in req_rows}

    # raw datasets that feed any required product (extend the node set upstream)
    feed_rows = await db.fetch(
        """SELECT product_asset_id, raw_asset_id FROM asset_feeds
           WHERE product_asset_id = ANY($1::int[]) OR raw_asset_id = ANY($1::int[])""",
        list(asset_ids))
    for fr in feed_rows:
        asset_ids.add(fr["product_asset_id"])
        asset_ids.add(fr["raw_asset_id"])

    # per-account status for all involved assets
    stat_rows = await db.fetch(
        "SELECT data_asset_id, ingestion_status FROM asset_status_by_account "
        "WHERE account_id = $1 AND data_asset_id = ANY($2::int[])",
        account_id, list(asset_ids))
    status_by_id = {r["data_asset_id"]: r["ingestion_status"] for r in stat_rows}
    meta = {r["data_asset_id"]: r for r in req_rows}
    # assets pulled in only via feeds need their metadata too
    missing = [aid for aid in asset_ids if aid not in meta]
    if missing:
        for r in await db.fetch(
            "SELECT id AS data_asset_id, module, source_category, tier, curate_effort "
            "FROM data_assets WHERE id = ANY($1::int[])", missing):
            meta.setdefault(r["data_asset_id"], r)

    raw_nodes, product_nodes = [], []
    for aid in asset_ids:
        m = meta.get(aid)
        if not m:
            continue
        status = status_by_id.get(aid, "not_started")
        node = {"id": aid, "module": m["module"], "source_category": m["source_category"],
                "status": status, "ready": aid in ready_ids}
        if m["tier"] == "product":
            node["curate_effort"] = m["curate_effort"]
            product_nodes.append(node)
        else:
            raw_nodes.append(node)

    uc_nodes = []
    for u in ucs:
        mid = use_case_value(u, assumptions) or 0  # returns the mid $M as a float
        uc_nodes.append({"id": u["id"], "title": u["title"], "phase": u.get("phase"),
                         "readiness": (rmap.get(u["id"]) or {}).get("readiness"),
                         "value_mm": round(mid, 2), "in_portfolio": bool(u.get("in_portfolio"))})

    enables = [{"from_use_case_id": r["from_use_case_id"], "to_use_case_id": r["to_use_case_id"]}
               for r in await db.fetch(
                   "SELECT from_use_case_id, to_use_case_id FROM uc_enables_uc "
                   "WHERE from_use_case_id = ANY($1::int[]) AND to_use_case_id = ANY($1::int[])",
                   uc_ids)]
    return {
        "account_id": account_id,
        "nodes": {"raw": raw_nodes, "product": product_nodes, "use_case": uc_nodes},
        "edges": {
            "feeds": [{"raw_id": fr["raw_asset_id"], "product_id": fr["product_asset_id"]}
                      for fr in feed_rows],
            "requires": [{"use_case_id": r["use_case_id"], "asset_id": r["data_asset_id"],
                          "tier": r["tier"], "criticality": r["criticality"]} for r in req_rows],
            "enables": enables,
        },
    }


# ---------------------------------------------------------------------------
# Project — live per-use-case readiness under a hypothetical set of landed assets
# ---------------------------------------------------------------------------
@router.post("/project")
async def whatif_project(body: SimulateIn):
    """Given a set of datasets/products the user is toggling to 'land/curate', return
    the PROJECTED readiness of every use case (so the graph can recolour live as they
    select) plus the use cases that become shovel-ready — flagged in_portfolio or not,
    sorted by value — so the user sees the FULL opportunity, not just their shortlist.

    Tier-aware override: a selected raw dataset is projected 'landed'; a selected data
    product is projected 'curated' (its own gate — that a product needs its feeders
    landed — is enforced in the UI)."""
    ids = body.data_asset_ids
    tier_rows = await db.fetch(
        "SELECT id, tier FROM data_assets WHERE id = ANY($1::int[])", ids)
    tiers = {r["id"]: r["tier"] for r in tier_rows}
    override = {aid: ("curated" if tiers.get(aid) == "product" else "landed") for aid in ids}

    before = await readiness_map()
    after = await readiness_map(override)

    assumptions = await load_assumptions()
    pcond, pparams = await portfolio.portfolio_condition("uc")
    ucs = [dict(u) for u in await db.fetch(
        f"SELECT uc.id, uc.title, uc.phase, uc.hypothesized_value_json, "
        f"({pcond}) AS in_portfolio FROM use_cases uc", *pparams)]

    projected: dict[str, str] = {}
    unlocked = []
    for u in ucs:
        uid = u["id"]
        aft = (after.get(uid) or {}).get("readiness")
        bef = (before.get(uid) or {}).get("readiness")
        if aft:
            projected[str(uid)] = aft
        if aft == "shovel_ready" and bef != "shovel_ready":
            val = use_case_value(u, assumptions) or 0
            unlocked.append({"id": uid, "title": u["title"], "phase": u.get("phase"),
                             "value_mm": round(val, 2), "in_portfolio": bool(u["in_portfolio"]),
                             "readiness": aft})
    unlocked.sort(key=lambda x: -x["value_mm"])
    return {"projected_readiness": projected, "unlocked": unlocked,
            "unlocked_count": len(unlocked),
            "unlocked_in_portfolio": sum(1 for u in unlocked if u["in_portfolio"]),
            "unlocked_new": sum(1 for u in unlocked if not u["in_portfolio"])}
