"""Assess admin — custom assumption-field CRUD + cross-account trends.

Completes the Assess admin console beyond the accounts/assessments/features/admins
tabs. Assumption fields are the value-model inputs (the `value_assumptions` catalog);
admins can add customer-specific ones, edit, or remove. Trends aggregate every
account's assessments so an admin can see program progress. Both are admin-only —
the cross-account surface, never blended with a user's own account view.

    GET    /api/assumption-fields                (catalog, any signed-in user)
    GET    /api/admin/assumption-fields          (admins)
    POST   /api/admin/assumption-fields          (admins) — add a custom field
    PUT    /api/admin/assumption-fields/{key}    (admins) — edit metadata/value
    DELETE /api/admin/assumption-fields/{key}    (admins)
    GET    /api/admin/trends                      (admins) — cross-account rollup
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import accounts as acct
from ..common import current_user, rows_to_list
from ..db import db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["admin-assess"])


async def _require_admin(request: Request) -> str:
    email = current_user(request)
    if not await acct.is_admin(email):
        raise HTTPException(403, "Admin only.")
    return email


# ---------------------------------------------------------------------------
# Assumption fields (the value-model inputs catalog)
# ---------------------------------------------------------------------------
@router.get("/assumption-fields")
async def list_assumption_fields():
    """The value-model input catalog (key/label/unit/category/value). Any signed-in
    user — the wizard/results dashboard reads it to render the assumptions."""
    try:
        return rows_to_list(await db.fetch("""
            SELECT key, label, value, unit, category, description
            FROM value_assumptions WHERE account_id IS NULL
            ORDER BY category NULLS LAST, label
        """))
    except Exception as exc:  # noqa: BLE001
        logger.info("assumption fields unavailable (%s)", type(exc).__name__)
        return []


@router.get("/admin/assumption-fields")
async def admin_list_assumption_fields(request: Request):
    await _require_admin(request)
    # The admin manages the GLOBAL catalog (account_id IS NULL). Per-account overrides
    # live as separate rows and are tuned in the Operate → Value calibration panel.
    return rows_to_list(await db.fetch("""
        SELECT key, label, value, unit, category, description
        FROM value_assumptions WHERE account_id IS NULL
        ORDER BY category NULLS LAST, label
    """))


class AssumptionFieldIn(BaseModel):
    key: str | None = Field(default=None, max_length=80)
    label: str = Field(..., min_length=1, max_length=200)
    value: float = 0
    unit: str | None = None
    category: str | None = None
    description: str | None = None


@router.post("/admin/assumption-fields")
async def create_assumption_field(body: AssumptionFieldIn, request: Request):
    await _require_admin(request)
    key = (body.key or body.label).strip().lower().replace(" ", "_")[:80]
    if not key:
        raise HTTPException(422, "key/label required")
    exists = await db.fetchrow(
        "SELECT 1 FROM value_assumptions WHERE key=$1 AND account_id IS NULL", key)
    if exists:
        raise HTTPException(409, f"assumption '{key}' already exists")
    await db.execute("""
        INSERT INTO value_assumptions (key, label, value, unit, category, description, account_id)
        VALUES ($1,$2,$3,$4,$5,$6, NULL)
    """, key, body.label, body.value, body.unit, body.category, body.description)
    return {"ok": True, "key": key}


@router.put("/admin/assumption-fields/{key}")
async def update_assumption_field(key: str, body: AssumptionFieldIn, request: Request):
    await _require_admin(request)
    row = await db.fetchrow("""
        UPDATE value_assumptions
        SET label=$2, value=$3, unit=$4, category=$5, description=$6
        WHERE key=$1 AND account_id IS NULL RETURNING key
    """, key, body.label, body.value, body.unit, body.category, body.description)
    if row is None:
        raise HTTPException(404, "Unknown assumption field")
    return {"ok": True, "key": key}


@router.delete("/admin/assumption-fields/{key}")
async def delete_assumption_field(key: str, request: Request):
    await _require_admin(request)
    row = await db.fetchrow(
        "DELETE FROM value_assumptions WHERE key=$1 AND account_id IS NULL RETURNING key", key)
    if row is None:
        raise HTTPException(404, "Unknown assumption field")
    return {"ok": True, "key": key}


# ---------------------------------------------------------------------------
# Cross-account trends
# ---------------------------------------------------------------------------
@router.get("/admin/trends")
async def admin_trends(request: Request):
    """Program-level rollup across every account's assessments (admins only)."""
    await _require_admin(request)
    rows = await db.fetch("""
        SELECT x.account_id, a.name AS account_name, x.status, x.overall_score,
               x.current_phase, x.submitted_at, x.created_at, x.results_json
        FROM account_assessments x JOIN accounts a ON a.id = x.account_id
    """)
    submitted = [r for r in rows if r["status"] == "submitted"]
    scores = [r["overall_score"] for r in submitted if r["overall_score"] is not None]
    phase_dist: dict[str, int] = {}
    for r in submitted:
        p = str(r["current_phase"]) if r["current_phase"] is not None else "?"
        phase_dist[p] = phase_dist.get(p, 0) + 1
    buckets = {"0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0}
    for s in scores:
        b = ("0-20" if s <= 20 else "21-40" if s <= 40 else "41-60" if s <= 60
             else "61-80" if s <= 80 else "81-100")
        buckets[b] += 1
    by_month: dict[str, int] = {}
    for r in submitted:
        ts = r["submitted_at"] or r["created_at"]
        if ts:
            m = ts.strftime("%Y-%m")
            by_month[m] = by_month.get(m, 0) + 1
    # Most-recommended use cases across submitted assessments.
    uc_counts: dict[str, int] = {}
    import json as _json
    for r in submitted:
        rj = r["results_json"]
        if isinstance(rj, str):
            try:
                rj = _json.loads(rj)
            except Exception:  # noqa: BLE001
                rj = {}
        for rec in (rj or {}).get("recommendations", [])[:5]:
            uc = rec.get("useCase") or rec
            title = uc.get("title") or uc.get("name")
            if title:
                uc_counts[title] = uc_counts.get(title, 0) + 1
    top_use_cases = sorted(uc_counts.items(), key=lambda kv: -kv[1])[:10]
    return {
        "total_assessments": len(rows),
        "submitted": len(submitted),
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "phase_distribution": phase_dist,
        "score_buckets": buckets,
        "submissions_by_month": dict(sorted(by_month.items())),
        "top_recommended_use_cases": [{"title": t, "count": c} for t, c in top_use_cases],
    }


# ---------------------------------------------------------------------------
# Full backup (admins only)
# ---------------------------------------------------------------------------
@router.get("/admin/backup")
async def admin_backup(request: Request):
    """Every row of every app table as one JSON file. Restore it with
    scripts/restore.py — into the same install, a new one, or the other backend."""
    import json
    from datetime import datetime, timezone
    from pathlib import Path

    from fastapi.responses import Response

    from .. import backup
    from ..common import write_audit

    actor = await _require_admin(request)
    version = (Path(__file__).resolve().parents[2] / "VERSION").read_text().strip()
    data = await backup.export_all(db, app_version=version)
    await write_audit("admin", None, "backup", actor,
                      {"tables": {t: len(r) for t, r in data["tables"].items()}})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        json.dumps(data, default=str), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="ai-value-flywheel-backup-{stamp}.json"'})
