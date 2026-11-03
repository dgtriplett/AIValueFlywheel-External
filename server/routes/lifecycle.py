"""Assess lifecycle + Operate reconciliation + Admin — the account/assessment journey.

    GET    /api/assessments                list this account's assessments (drafts + submitted)
    GET    /api/assessments/latest         the latest submitted (for pre-populating a new one)
    GET    /api/assessments/{id}           one assessment
    POST   /api/assessments                upsert (create/save draft or submit)
    DELETE /api/assessments/{id}           delete one

    GET    /api/operate/reconciliation     self-reported vs discovered, per coarse source

    GET    /api/admin/overview             cross-account rollup (admins only)
    GET    /api/admin/assessments          every assessment across accounts (admins only)

All per-account reads are account-scoped by the middleware and membership-gated. The
admin endpoints are the ONLY cross-account surface and require the admins allow-list —
they are a separate experience, never blended with a user's own-account view.
"""
from __future__ import annotations

import json
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


@router.get("/assessments")
async def list_assessments(status: str | None = None):
    account_id = await _require_account()
    clause = "AND status = $2" if status else ""
    args = [account_id] + ([status] if status else [])
    rows = rows_to_list(await db.fetch(f"""
        SELECT id, status, label, overall_score, current_phase,
               created_by, created_at, updated_at, submitted_at
        FROM account_assessments WHERE account_id = $1 {clause}
        ORDER BY updated_at DESC
    """, *args))
    return {"assessments": rows, "account_id": account_id}


@router.get("/assessments/latest")
async def latest_assessment():
    """The most recent SUBMITTED assessment — a new assessment prefills from this so the
    user doesn't re-enter everything they selected last time."""
    account_id = await _require_account()
    row = await db.fetchrow("""
        SELECT id, status, label, answers_json, results_json, overall_score, current_phase,
               submitted_at
        FROM account_assessments WHERE account_id = $1 AND status = 'submitted'
        ORDER BY submitted_at DESC NULLS LAST, updated_at DESC LIMIT 1
    """, account_id)
    return {"assessment": _decode(row)}


@router.get("/assessments/{aid}")
async def get_assessment(aid: str):
    account_id = await _require_account()
    row = await db.fetchrow("""
        SELECT id, status, label, answers_json, results_json, overall_score, current_phase,
               created_by, created_at, updated_at, submitted_at
        FROM account_assessments WHERE id = $1 AND account_id = $2
    """, aid, account_id)
    if row is None:
        raise HTTPException(404, "Assessment not found")
    return {"assessment": _decode(row)}


@router.post("/assessments")
async def upsert_assessment(body: AssessmentIn, request: Request):
    account_id = await _require_account()
    actor = current_user(request)
    if body.status not in ("draft", "submitted"):
        raise HTTPException(422, "status must be draft or submitted")
    await db.execute("""
        INSERT INTO account_assessments
            (id, account_id, status, label, answers_json, results_json,
             overall_score, current_phase, created_by, submitted_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,
                CASE WHEN $3='submitted' THEN now() ELSE NULL END)
        ON CONFLICT (id) DO UPDATE SET
            status=EXCLUDED.status, label=EXCLUDED.label,
            answers_json=EXCLUDED.answers_json, results_json=EXCLUDED.results_json,
            overall_score=EXCLUDED.overall_score, current_phase=EXCLUDED.current_phase,
            updated_at=now(),
            submitted_at=CASE WHEN EXCLUDED.status='submitted' AND account_assessments.submitted_at IS NULL
                              THEN now() ELSE account_assessments.submitted_at END
    """, body.id, account_id, body.status, body.label,
        json.dumps(body.answers_json), json.dumps(body.results_json) if body.results_json is not None else None,
        body.overall_score, body.current_phase, actor)
    return {"id": body.id, "status": body.status, "account_id": account_id}


@router.delete("/assessments/{aid}")
async def delete_assessment(aid: str):
    account_id = await _require_account()
    row = await db.fetchrow(
        "DELETE FROM account_assessments WHERE id=$1 AND account_id=$2 RETURNING id",
        aid, account_id)
    if row is None:
        raise HTTPException(404, "Assessment not found")
    return {"deleted": aid}


def _decode(row):
    if row is None:
        return None
    d = dict(row)
    for k in ("answers_json", "results_json"):
        if isinstance(d.get(k), str):
            try:
                d[k] = json.loads(d[k])
            except Exception:  # noqa: BLE001 - leave a malformed blob as text
                pass
    return d


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

    out = []
    summary = {"total": len(ucs), "shovel_ready": 0, "awaiting_prerequisites": 0,
               "nearly_ready": 0, "blocked": 0, "hypothesized_mm": 0.0, "realized_mm": 0.0}
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
        out.append({"id": u["id"], "title": u["title"], "phase": u.get("phase"),
                    "status": u.get("status"), "readiness": readiness,
                    "hypothesized_mm": round(hyp or 0, 2),
                    "realized_mm": round(real or 0, 3)})
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
               (SELECT count(*) FROM account_assessments x WHERE x.account_id = a.id) AS assessments,
               (SELECT count(*) FROM account_assessments x WHERE x.account_id = a.id AND x.status='submitted') AS submitted,
               (SELECT count(*) FROM account_portfolio_use_cases p WHERE p.account_id = a.id) AS portfolio,
               (SELECT count(*) FROM account_promotions pr WHERE pr.account_id = a.id) AS promotions,
               (SELECT max(created_at) FROM account_promotions pr WHERE pr.account_id = a.id) AS last_promoted
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


@router.get("/admin/assessments")
async def admin_assessments(request: Request):
    await _require_admin(request)
    rows = rows_to_list(await db.fetch("""
        SELECT x.id, x.account_id, a.name AS account_name, x.status, x.label,
               x.overall_score, x.current_phase, x.created_by, x.created_at, x.submitted_at
        FROM account_assessments x JOIN accounts a ON a.id = x.account_id
        ORDER BY x.updated_at DESC
    """))
    return {"assessments": rows}


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
