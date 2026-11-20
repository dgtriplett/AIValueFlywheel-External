"""Explore: the use-case catalog map, joined to the current business unit's portfolio.

    GET  /api/me                        current user + the business units they belong to
    GET  /api/explore/portfolio         catalog id -> {use_case_id, in_portfolio, status}
    POST /api/explore/portfolio         add catalog use cases (by catalog id) to the portfolio
    POST /api/poc-scope/generate        a proof-of-concept statement of work (.docx)

The Explore map draws from the shipped catalog (frontend/src/data/useCases.generated.ts),
whose ids (e.g. `p1_gen_demand_forecast`) differ from the database's integer ids. The
reference bundle's title crosswalk joins the two, the same way for both directions.
"""
from __future__ import annotations

import io
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import accounts as acct
from .. import llm
from .. import portfolio
from ..common import current_user, rows_to_list, write_audit
from ..db import db
from ..limits import limiter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["explore"])


# ---------------------------------------------------------------------------
# Identity + business units
# ---------------------------------------------------------------------------
@router.get("/me")
async def me(request: Request):
    """Who is signed in (Databricks Apps forwarded identity) and which business units
    they belong to, so the UI can render the switcher and land on the active one."""
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
# Catalog id <-> portfolio
# ---------------------------------------------------------------------------
def _catalog_titles() -> dict[str, str]:
    """Shipped-catalog id (p1_* ...) -> use_cases.title."""
    from .. import reference
    return reference.catalog_title_crosswalk()


async def _resolve(catalog_ids: list[str] | None = None) -> dict[str, int]:
    """Shipped-catalog id -> use_cases.id, for the ids that exist in this workspace."""
    titles = _catalog_titles()
    wanted = catalog_ids if catalog_ids is not None else list(titles)
    rows = await db.fetch("SELECT id, title FROM use_cases")
    by_title = {r["title"]: r["id"] for r in rows}
    out = {}
    for cid in wanted:
        title = titles.get(cid)
        if not title:
            continue
        # Seeding disambiguates duplicate titles as "Title (catalog id)".
        uc_id = by_title.get(title) or by_title.get(f"{title} ({cid})")
        if uc_id is not None:
            out[cid] = int(uc_id)
    return out


@router.get("/explore/portfolio")
async def explore_portfolio():
    """For every shipped-catalog use case: its database id, whether it is on this
    business unit's portfolio, and its delivery status."""
    resolved = await _resolve()
    membership, params = await portfolio.select_membership_expression("uc")
    rows = await db.fetch(
        f"SELECT uc.id, uc.status, {membership} AS in_portfolio FROM use_cases uc", *params)
    state = {r["id"]: r for r in rows}
    out = {}
    for cid, uc_id in resolved.items():
        r = state.get(uc_id)
        if r is None:
            continue
        out[cid] = {"use_case_id": uc_id, "in_portfolio": bool(r["in_portfolio"]),
                    "status": r["status"]}
    return {"account_id": await acct.current(), "use_cases": out}


class ExploreAddIn(BaseModel):
    catalog_ids: list[str] = Field(..., min_length=1, max_length=200)


@router.post("/explore/portfolio", dependencies=[Depends(limiter("write"))])
async def explore_add(body: ExploreAddIn, request: Request):
    """Add shipped-catalog use cases to the current business unit's portfolio."""
    actor, _ = await acct.require_editor(request)
    resolved = await _resolve(body.catalog_ids)
    unresolved = [c for c in body.catalog_ids if c not in resolved]
    added = await portfolio.add_many(list(resolved.values()), actor=actor, source="explore")
    await write_audit("portfolio", None, "explore_add", actor,
                      {"catalog_ids": body.catalog_ids, "added": added, "unresolved": unresolved})
    return {"added": added, "use_case_ids": resolved, "unresolved": unresolved}


# ---------------------------------------------------------------------------
# Proof-of-concept statement of work
# ---------------------------------------------------------------------------
@router.post("/poc-scope/generate", dependencies=[Depends(limiter("research"))])
async def poc_scope_generate(request: Request):
    """Generate a proof-of-concept statement of work as a .docx.
    Body: {useCase: {title, description, ...}, customerName?}."""
    try:
        import docx  # python-docx
    except Exception:  # noqa: BLE001
        raise HTTPException(503, "Document export isn't available (python-docx not installed).")
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        payload = {}
    uc = payload.get("useCase") or payload.get("use_case") or {}
    customer = payload.get("customerName") or payload.get("customer") or "the customer"
    title = uc.get("title") or uc.get("name") or "Use Case"
    body_md = ""
    try:
        body_md = await llm.chat_completion([
            {"role": "system", "content":
                "You write a concise proof-of-concept statement of work for a Data & AI "
                "use case built on Databricks. Sections: Objective, Scope, Success Criteria, "
                "Data Requirements, Milestones (4-6 weeks), Roles, Out of Scope. Plain prose, "
                "no markdown symbols."},
            {"role": "user", "content":
                f"Organization: {customer}. Use case: {title}. Details: {json.dumps(uc)[:3000]}"},
        ]) or ""
    except Exception as exc:  # noqa: BLE001
        logger.info("POC scope model call failed (%s)", type(exc).__name__)
    doc = docx.Document()
    doc.add_heading(f"Proof of Concept — {title}", level=0)
    doc.add_paragraph(f"Organization: {customer}")
    for para in (body_md or "Objective: Deliver a working proof of concept.").split("\n"):
        para = para.strip()
        if not para:
            continue
        if len(para) < 60 and para.endswith(":"):
            doc.add_heading(para.rstrip(":"), level=1)
        else:
            doc.add_paragraph(para)
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    fname = f"poc-scope-{title.lower().replace(' ', '-')[:40]}.docx"
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})
