"""Feature flags — beta-rollout control for the Assess experience.

    GET  /api/feature-flags                 resolved {key: bool} for the current user
    GET  /api/admin/feature-flags           full registry with tri-state (admins only)
    PUT  /api/admin/feature-flags/{key}      set a flag's state (admins only)

Tri-state per flag: 'off' | 'admin' | 'on'. The resolver turns that into a boolean for
the caller: 'on' → true, 'admin' → true iff the user is an admin, 'off' → false. This is
what lets an admin actually turn a beta feature ON — the gap where betas rendered blank
with no toggle.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import accounts as acct
from ..common import current_user
from ..db import db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["feature-flags"])

_VALID_STATES = ("off", "admin", "on")


@router.get("/feature-flags")
async def my_feature_flags(request: Request):
    """Resolved boolean flag map for the current user. Never errors — a missing table
    or DB just yields an empty map so the app still renders (betas simply stay off)."""
    email = current_user(request)
    try:
        is_admin = await acct.is_admin(email)
        rows = await db.fetch("SELECT key, state FROM feature_flags")
    except Exception as exc:  # noqa: BLE001
        logger.info("feature flags unavailable (%s)", type(exc).__name__)
        return {}
    out: dict[str, bool] = {}
    for r in rows:
        state = r["state"]
        out[r["key"]] = state == "on" or (state == "admin" and is_admin)
    return out


@router.get("/admin/feature-flags")
async def list_feature_flags(request: Request):
    """Full registry (admins only) — the admin toggle UI reads this."""
    email = current_user(request)
    if not await acct.is_admin(email):
        raise HTTPException(403, "Admin only.")
    rows = await db.fetch("""
        SELECT key, label, description, category, state, sort_order, updated_at, updated_by
        FROM feature_flags ORDER BY sort_order, key
    """)
    # Shape to the frontend FeatureFlagAdminRow (name/category/updatedAt/updatedBy).
    return [{
        "key": r["key"], "name": r["label"], "description": r["description"],
        "category": r["category"], "state": r["state"],
        "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
        "updatedBy": r["updated_by"],
    } for r in rows]


class FlagUpdate(BaseModel):
    state: str = Field(..., min_length=1)


@router.put("/admin/feature-flags/{key}")
async def set_feature_flag(key: str, body: FlagUpdate, request: Request):
    email = current_user(request)
    if not await acct.is_admin(email):
        raise HTTPException(403, "Admin only.")
    if body.state not in _VALID_STATES:
        raise HTTPException(422, f"state must be one of {_VALID_STATES}")
    row = await db.fetchrow(
        """UPDATE feature_flags SET state=$1, updated_at=now(), updated_by=$2
           WHERE key=$3 RETURNING key""",
        body.state, email, key)
    if row is None:
        raise HTTPException(404, "Unknown feature flag")
    return {"ok": True, "key": key, "state": body.state}
