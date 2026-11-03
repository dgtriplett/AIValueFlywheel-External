"""Assess — the strategic maturity-assessment half of the converged app.

The Operate half (portfolio, readiness, value) is grid-atlas's existing routes.
This module adds what the Assess experience needs on top of the SAME account-scoped
database, so an assessment promotes straight into the Operate portfolio with no
cross-app export:

    GET  /api/me                        current user + the accounts they belong to
    GET  /api/data-sources              the canonical 31 coarse sources (+ this
                                        account's availability), for the wizard
    GET  /api/preassessment/template    download the pre-assessment worksheet (xlsx)
    POST /api/preassessment/template    same, with the wizard's question spec (full worksheet)
    POST /api/preassessment/parse       parse a filled worksheet -> ids + warnings
    POST /api/assess/promote            write the assessment result into the current
                                        account: coarse source availability, rolled
                                        DOWN to module readiness, plus the in-production
                                        use cases into the account portfolio.

`promote` is the interactive twin of scripts/seed_cms_example.py; both share the exact
same taxonomy crosswalks (data_source_rollup), so the strategic (coarse) answers become
concrete operational (module) readiness the Operate side reasons over.
"""
from __future__ import annotations

import io
import logging

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import accounts as acct
from .. import preassessment_template as tmpl
from ..common import current_user, rows_to_list
from ..db import db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["assess"])

def _parent_title() -> dict[str, str]:
    """Assessment-worksheet use-case id (p1_* …) -> catalog title, used to resolve the
    worksheet's in-production ids to use_cases rows (which key on title)."""
    from .. import reference
    return reference.assessment_title_crosswalk()


# ---------------------------------------------------------------------------
# Identity + accounts
# ---------------------------------------------------------------------------
@router.get("/me")
async def me(request: Request):
    """Who is logged in (Databricks Apps forwarded identity) and which accounts they
    belong to, so the UI can render the account switcher and land on the active one."""
    email = current_user(request)
    accounts, active_id, admin = [], None, False
    try:
        accounts = rows_to_list(await db.fetch("""
            SELECT a.id, a.slug, a.name, a.utility_type, m.role,
                   a.geography, a.territory_size, a.strategic_priorities, a.profile_complete
            FROM account_members m JOIN accounts a ON a.id = m.account_id
            WHERE lower(m.user_email) = lower($1) AND a.is_active
            ORDER BY lower(a.name)
        """, email))
        row = await db.fetchrow(
            "SELECT account_id FROM user_active_account WHERE lower(user_email) = lower($1)",
            email)
        active_id = row["account_id"] if row else None
        admin = await acct.is_admin(email)
    except Exception as exc:  # noqa: BLE001
        logger.info("me() accounts unavailable (%s)", type(exc).__name__)
    if active_id is None and accounts:
        active_id = accounts[0]["id"]
    return {"email": email, "accounts": accounts, "active_account_id": active_id,
            "is_admin": admin}


# ---------------------------------------------------------------------------
# Canonical coarse data-source taxonomy (the 31)
# ---------------------------------------------------------------------------
@router.get("/data-sources")
async def data_sources():
    """The canonical 31 coarse sources, each with how many fine modules roll up into
    it and this account's current availability answer (for wizard prefill)."""
    account_id = await acct.current()
    rows = rows_to_list(await db.fetch("""
        SELECT s.id, s.name, s.category, s.description, s.sort_order,
               (SELECT count(*) FROM data_source_rollup r WHERE r.data_source_id = s.id) AS module_count,
               COALESCE((SELECT ss.available FROM account_source_status ss
                          WHERE ss.data_source_id = s.id AND ss.account_id = $1), false) AS available
        FROM data_sources s WHERE s.is_active
        ORDER BY s.category, s.sort_order, s.name
    """, account_id))
    return {"data_sources": rows, "account_id": account_id}


# ---------------------------------------------------------------------------
# Pre-assessment worksheet (download + upload)
# ---------------------------------------------------------------------------
class TemplateIn(BaseModel):
    utilityType: str | None = None
    customerName: str = ""
    # Profile / Infrastructure / Capabilities questions from the wizard
    # (frontend/src/data/preassessmentSpec.ts).
    questions: list[dict] = Field(default_factory=list)


@router.get("/preassessment/template")
async def preassessment_template(utilityType: str | None = None, customerName: str = ""):
    return _template_response(tmpl.build_template(utilityType, customerName), customerName)


@router.post("/preassessment/template")
async def preassessment_template_full(body: TemplateIn):
    return _template_response(
        tmpl.build_template(body.utilityType, body.customerName, body.questions), body.customerName)


def _template_response(data: bytes, customerName: str) -> StreamingResponse:
    fname = f"pre-assessment-{(customerName or 'worksheet').strip().replace(' ', '_')}.xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.post("/preassessment/parse")
async def preassessment_parse(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        result = tmpl.parse_completed(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Could not parse the worksheet: {exc}")
    return result


# ---------------------------------------------------------------------------
# Promote: assessment result -> account operate state
# ---------------------------------------------------------------------------
class PromoteIn(BaseModel):
    selected_data_source_ids: list[str] = Field(default_factory=list)
    in_production_use_case_ids: list[str] = Field(default_factory=list)
    # The prescriptive roadmap's recommended next use cases — promoted into the
    # portfolio too, so Operate shows the FULL roadmap to work, not just what's live.
    roadmap_use_case_ids: list[str] = Field(default_factory=list)
    available_status: str = Field(default="curated")  # not_started|landed|curated|governed
    assessment_id: str | None = None  # link the promotion to its source assessment


@router.post("/assess/promote")
async def promote(body: PromoteIn, request: Request):
    """Write the assessment result into the CURRENT account and roll coarse source
    availability DOWN into per-account module readiness (via data_source_rollup)."""
    account_id = await acct.current()
    if account_id is None:
        raise HTTPException(409, "No active account. Create or select one first.")
    actor = current_user(request)
    avail = set(body.selected_data_source_ids)

    all_src = [r["id"] for r in await db.fetch(
        "SELECT id FROM data_sources WHERE is_active")]
    # SAFETY GUARD: an empty selection must NOT wipe a prior survey. Promoting with no
    # data sources (e.g. a partially-filled or mis-wired assessment) would otherwise set
    # every source to unavailable and erase what the customer reported. Treat empty as
    # "nothing to promote on the data-source side" and leave existing answers intact.
    if avail:
        await db.executemany("""
            INSERT INTO account_source_status
                (account_id, data_source_id, available, source, updated_by)
            VALUES ($1,$2,$3,'survey',$4)
            ON CONFLICT (account_id, data_source_id) DO UPDATE SET
                available=EXCLUDED.available, source='survey', updated_at=now()
        """, [(account_id, sid, sid in avail, actor) for sid in all_src])

    n_modules = 0
    if avail:
        res = await db.execute("""
            INSERT INTO account_asset_status (account_id, data_asset_id, ingestion_status, source, updated_by)
            SELECT $1, r.data_asset_id, $2, 'survey', $3
            FROM data_source_rollup r WHERE r.data_source_id = ANY($4::text[])
            ON CONFLICT (account_id, data_asset_id) DO UPDATE SET
                ingestion_status=EXCLUDED.ingestion_status, source='survey', updated_at=now()
        """, account_id, body.available_status, actor, list(avail))
        # asyncpg returns e.g. "INSERT 0 34"
        try:
            n_modules = int(str(res).split()[-1])
        except (ValueError, IndexError):
            n_modules = 0

    p2t = _parent_title()

    title_to_id = {r["title"]: r["id"] for r in await db.fetch("SELECT id, title FROM use_cases")}

    async def _add_to_portfolio(wids: list[str], source: str) -> tuple[int, list[str]]:
        rows, unresolved = [], []
        for wid in wids:
            title = p2t.get(wid)
            uc_id = (title_to_id.get(title) or title_to_id.get(f"{title} ({wid})")) if title else None
            if uc_id is None:
                unresolved.append(wid)
                continue
            rows.append((account_id, uc_id, source, actor))
        await db.executemany("""
            INSERT INTO account_portfolio_use_cases (account_id, use_case_id, source, created_by)
            VALUES ($1,$2,$3,$4) ON CONFLICT (account_id, use_case_id) DO NOTHING
        """, rows)
        return len(rows), unresolved

    n_prod, unresolved = await _add_to_portfolio(body.in_production_use_case_ids, "survey")
    n_road, unresolved_r = await _add_to_portfolio(body.roadmap_use_case_ids, "roadmap")
    unresolved += unresolved_r

    summary = {"account_id": account_id,
               "sources_available": len(avail), "sources_total": len(all_src),
               "modules_set": n_modules,
               "use_cases_added": n_prod + n_road,
               "in_production_added": n_prod, "roadmap_added": n_road,
               "unresolved_use_cases": unresolved}

    # Log the promotion so promoting a new assessment never loses the prior state —
    # account_source_status/account_asset_status hold the CURRENT state; this is history.
    import json as _json
    import uuid
    await db.execute("""
        INSERT INTO account_promotions (id, account_id, assessment_id, summary_json, created_by)
        VALUES ($1,$2,$3,$4::jsonb,$5)
    """, str(uuid.uuid4()), account_id, body.assessment_id, _json.dumps(summary), actor)
    return summary


@router.get("/promotions")
async def promotions():
    """Promotion history for the current account (newest first)."""
    account_id = await acct.current()
    if account_id is None:
        return {"promotions": []}
    rows = rows_to_list(await db.fetch("""
        SELECT id, assessment_id, summary_json, created_by, created_at
        FROM account_promotions WHERE account_id = $1 ORDER BY created_at DESC
    """, account_id))
    return {"promotions": rows}
