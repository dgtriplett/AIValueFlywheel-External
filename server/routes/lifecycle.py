"""Operate read models + Admin cross-account overview.

    GET    /api/operate/roadmap            the business unit's portfolio, with readiness,
                                           value and what the imported roadmap says
    GET    /api/operate/data-lineage       coarse source -> fine modules
    GET    /api/operate/reconciliation     self-reported vs discovered, per coarse source

    GET    /api/admin/overview             cross-account rollup (admins only)
    GET/POST/DELETE /api/admin/admins      the admins allow-list (admins only)

All per-account reads are account-scoped by the middleware and membership-gated. The
admin endpoints are the ONLY cross-account surface and require the admins allow-list —
they are a separate experience, never blended with a user's own-account view.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import accounts as acct
from ..common import current_user, rows_to_list
from ..db import db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["lifecycle"])


async def _require_account() -> int:
    account_id = await acct.current()
    if account_id is None:
        raise HTTPException(409, "No active account.")
    return account_id


async def _require_admin(request: Request) -> str:
    email = current_user(request)
    if not await acct.is_admin(email):
        raise HTTPException(403, "Admin only.")
    return email


# ---------------------------------------------------------------------------
# Assessments
# ---------------------------------------------------------------------------
class AssessmentIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    status: str = Field(default="draft")  # draft | submitted
    label: str | None = None
    answers_json: dict = Field(default_factory=dict)
    results_json: dict | None = None
    overall_score: int | None = None
    current_phase: int | None = None


# ---------------------------------------------------------------------------
# Operate — the operationalized roadmap (account portfolio + readiness + value)
# ---------------------------------------------------------------------------
@router.get("/operate/roadmap")
async def operate_roadmap():
    """The account's operationalized roadmap: its portfolio use cases (account-scoped
    via account_portfolio_use_cases), each with readiness + hypothesized/realized value,
    grouped for a phase-sequenced view. Authoritative + grounded — same helpers the
    analytics dashboard uses, so the numbers match."""
    from .. import portfolio
    from ..readiness import readiness_map
    from ..value_engine import compute_realized, compute_value_range, load_assumptions

    account_id = await acct.current()
    if account_id is None:
        return {"account_id": None, "use_cases": [], "summary": {}}
    assumptions = await load_assumptions()
    condition, params = await portfolio.portfolio_condition("uc")
    ucs = [dict(u) for u in await db.fetch(
        f"SELECT uc.* FROM use_cases uc WHERE {condition} ORDER BY uc.phase, uc.id", *params)]
    rmap = await readiness_map()
    # What the imported roadmap says about each use case (empty before any import).
    road = {r["use_case_id"]: r for r in await db.fetch("""
        SELECT use_case_id, pillar_ids, stage, workstream, priority_rank, priority_tier,
               value_base, dropped_at
        FROM account_roadmap_use_cases WHERE account_id = $1
    """, account_id)}

    out = []
    summary = {"total": len(ucs), "shovel_ready": 0, "awaiting_prerequisites": 0,
               "nearly_ready": 0, "blocked": 0, "hypothesized_mm": 0.0, "realized_mm": 0.0,
               "on_roadmap": 0, "roadmap_value_mm": 0.0, "planned_mm": 0.0}
    for u in ucs:
        rng = compute_value_range(u.get("hypothesized_value_json"), assumptions)
        hyp = rng["mid"] if rng else 0
        real = (compute_realized(u, assumptions) or {}).get("value") or 0
        readiness = (rmap.get(u["id"]) or {}).get("readiness")
        if readiness in summary:
            summary[readiness] += 1
        # compute_realized already returns $M (same as analytics/dashboard, which sums
        # it directly). Dividing by 1e6 here made roadmap realized value 1,000,000x too
        # small and disagree with the dashboard for the same account.
        summary["hypothesized_mm"] += hyp or 0
        summary["realized_mm"] += (real or 0)
        r = road.get(u["id"])
        roadmap = None
        model_mm = round(hyp or 0, 2)
        planned, source = model_mm, "model"
        if r is not None:
            dropped = r.get("dropped_at") is not None
            value_mm = round(float(r["value_base"]) / 1e6, 2) if r.get("value_base") is not None else None
            roadmap = {"pillar_ids": list(r.get("pillar_ids") or []), "stage": r.get("stage"),
                       "workstream": r.get("workstream"), "priority_rank": r.get("priority_rank"),
                       "priority_tier": r.get("priority_tier"), "value_base_mm": value_mm,
                       "dropped": dropped}
            if not dropped:
                summary["on_roadmap"] += 1
                summary["roadmap_value_mm"] += value_mm or 0
                # The roadmap's estimate was sized for THIS organization; the catalog
                # model is generic. Lead with the roadmap's, keep the model alongside.
                if value_mm is not None:
                    planned, source = value_mm, "roadmap"
        summary["planned_mm"] += planned
        out.append({"id": u["id"], "title": u["title"], "phase": u.get("phase"),
                    "status": u.get("status"), "readiness": readiness,
                    "hypothesized_mm": planned, "model_mm": model_mm,
                    "value_source": source,
                    "realized_mm": round(real or 0, 3), "roadmap": roadmap})
    summary["roadmap_value_mm"] = round(summary["roadmap_value_mm"], 2)
    summary["planned_mm"] = round(summary["planned_mm"], 2)
    summary["hypothesized_mm"] = round(summary["hypothesized_mm"], 2)
    summary["realized_mm"] = round(summary["realized_mm"], 3)
    return {"account_id": account_id, "use_cases": out, "summary": summary}


# ---------------------------------------------------------------------------
# Operate — data lineage: coarse (Assess) source -> fine (Operate) modules
# ---------------------------------------------------------------------------
@router.get("/operate/data-lineage")
async def data_lineage():
    """Makes the Assess->Operate granularity transition explicit: each coarse survey
    data source (what the assessment collects, e.g. 'AMI / smart meter reads') and the
    specific fine modules it rolls DOWN to in Operate (e.g. Head-End System, Interval
    Usage Collection, MDM Repository…), with this account's per-module ingestion status
    and where it came from (survey rolldown / discovered / manual correction). This is
    the higher->lower granularity mapping, per account."""
    account_id = await _require_account()
    rows = await db.fetch("""
        SELECT s.id AS source_id, s.name AS source_name, s.category,
               COALESCE(ss.available, false) AS self_reported,
               da.id AS data_asset_id, da.source_category, da.module, da.vendor,
               COALESCE(aas.ingestion_status, da.ingestion_status) AS ingestion_status,
               aas.source AS status_source, aas.is_user_edited
        FROM data_sources s
        JOIN data_source_rollup r ON r.data_source_id = s.id
        JOIN data_assets da ON da.id = r.data_asset_id
        LEFT JOIN account_source_status ss
               ON ss.data_source_id = s.id AND ss.account_id = $1
        LEFT JOIN account_asset_status aas
               ON aas.data_asset_id = da.id AND aas.account_id = $1
        WHERE s.is_active
        ORDER BY s.category, s.name, da.source_category, da.module
    """, account_id)
    _READY = ("landed", "curated", "governed")
    sources: dict = {}
    for r in rows:
        sid = r["source_id"]
        s = sources.setdefault(sid, {
            "source_id": sid, "source_name": r["source_name"], "category": r["category"],
            "self_reported": r["self_reported"], "modules": []})
        s["modules"].append({
            "data_asset_id": r["data_asset_id"], "module": r["module"],
            "source_category": r["source_category"], "vendor": r["vendor"],
            "ingestion_status": r["ingestion_status"],
            "status_source": r["status_source"], "is_user_edited": r["is_user_edited"],
            "ready": r["ingestion_status"] in _READY})
    out = []
    for s in sources.values():
        s["module_count"] = len(s["modules"])
        s["modules_ready"] = sum(1 for m in s["modules"] if m["ready"])
        out.append(s)
    return {"account_id": account_id, "sources": out}


# ---------------------------------------------------------------------------
# Operate — reconciliation (self-reported vs discovered)
# ---------------------------------------------------------------------------
@router.get("/operate/reconciliation")
async def reconciliation():
    """Per coarse source: what the survey SAID vs what discovery FOUND. Discovery is
    not blank-slate — this surfaces additional/unaccounted data and fringe gaps against
    the self-reported picture."""
    account_id = await _require_account()
    rows = await db.fetch("""
        SELECT s.id, s.name, s.category,
               COALESCE(ss.available, false) AS self_reported,
               EXISTS (
                 SELECT 1 FROM data_source_rollup r
                 JOIN account_asset_status a
                   ON a.data_asset_id = r.data_asset_id AND a.account_id = $1
                 WHERE r.data_source_id = s.id AND a.source = 'discovered'
                   AND a.ingestion_status IN ('landed','curated','governed')
               ) AS discovered,
               (SELECT count(*) FROM data_source_rollup r WHERE r.data_source_id = s.id) AS modules
        FROM data_sources s
        LEFT JOIN account_source_status ss
               ON ss.data_source_id = s.id AND ss.account_id = $1
        WHERE s.is_active
        ORDER BY s.category, s.name
    """, account_id)
    out, counts = [], {"confirmed": 0, "additional": 0, "gap": 0, "none": 0}
    for r in rows:
        sr, disc = r["self_reported"], r["discovered"]
        status = ("confirmed" if sr and disc else "additional" if disc and not sr
                  else "gap" if sr and not disc else "none")
        counts[status] += 1
        out.append({"id": r["id"], "name": r["name"], "category": r["category"],
                    "self_reported": sr, "discovered": disc, "modules": r["modules"],
                    "status": status})
    return {"account_id": account_id, "sources": out, "counts": counts}


# ---------------------------------------------------------------------------
# Admin — cross-account (admins only; a separate experience)
# ---------------------------------------------------------------------------
@router.get("/admin/overview")
async def admin_overview(request: Request):
    await _require_admin(request)
    accounts = rows_to_list(await db.fetch("""
        SELECT a.id, a.slug, a.name, a.utility_type, a.is_active, a.profile_complete,
               (SELECT count(*) FROM account_members m WHERE m.account_id = a.id) AS members,
               (SELECT count(*) FROM account_portfolio_use_cases p WHERE p.account_id = a.id) AS portfolio,
               (SELECT count(*) FROM roadmap_imports ri WHERE ri.account_id = a.id) AS roadmap_imports,
               (SELECT max(created_at) FROM roadmap_imports ri WHERE ri.account_id = a.id) AS last_imported
        FROM accounts a ORDER BY a.is_default DESC, lower(a.name)
    """))
    users = rows_to_list(await db.fetch("""
        SELECT lower(user_email) AS user_email, count(*) AS accounts,
               bool_or(role='owner') AS is_owner
        FROM account_members GROUP BY lower(user_email) ORDER BY 1
    """))
    admins = [r["user_email"] for r in await db.fetch("SELECT user_email FROM admins ORDER BY 1")]
    return {"accounts": accounts, "users": users, "admins": admins,
            "totals": {"accounts": len(accounts), "users": len(users)}}


class AdminIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)


@router.get("/admin/admins")
async def list_admins(request: Request):
    await _require_admin(request)
    rows = rows_to_list(await db.fetch(
        "SELECT user_email, added_at, added_by FROM admins ORDER BY user_email"))
    return {"admins": rows}


@router.post("/admin/admins")
async def add_admin(body: AdminIn, request: Request):
    actor = await _require_admin(request)
    email = body.email.strip().lower()
    await db.execute(
        "INSERT INTO admins (user_email, added_by) VALUES ($1,$2) "
        "ON CONFLICT (user_email) DO NOTHING", email, actor)
    return {"added": email}


@router.delete("/admin/admins/{email}")
async def remove_admin(email: str, request: Request):
    actor = await _require_admin(request)
    email = email.strip().lower()
    if email == actor.strip().lower():
        raise HTTPException(422, "You cannot remove yourself as an admin.")
    row = await db.fetchrow(
        "DELETE FROM admins WHERE lower(user_email)=lower($1) RETURNING user_email", email)
    if row is None:
        raise HTTPException(404, "Not an admin")
    return {"removed": email}
