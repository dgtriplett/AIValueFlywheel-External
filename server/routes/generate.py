"""The propose/confirm gate shared by every agent-proposed write, plus the
read-only "what does the catalog already have about X" research helper.

    POST /api/confirm/{token}    -> performs the write for a confirm card
    GET  /api/confirm/{token}    -> re-read a card after a page reload
    GET  /api/generate/research  -> catalog matches + data readiness for a topic
    POST /api/generate/cleanup   -> sweep expired confirm tokens

Agents never write directly: each propose endpoint issues a single-use token
(server/confirm.py) and the write happens only when a person confirms it here.
Adding a use case by hand is routes/authoring.py; its executor is registered below.
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException, Path, Request

from .. import confirm as cf
from .. import generation as gen
from .. import portfolio
from ..common import current_user, write_audit
from ..db import db
from ..readiness import ready_assets

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/generate", tags=["generation"])
confirm_router = APIRouter(prefix="/confirm", tags=["generation"])

# ---------------------------------------------------------------------------
# Domain context: what the utility has vs. lacks
# ---------------------------------------------------------------------------
async def _domain_context() -> tuple[list[dict], list[dict], dict[str, dict], set[str]]:
    """Return (satisfied, unsatisfied, index_by_name, satisfied_names).

    "Satisfied" uses exactly the readiness rule — ANY serving asset curated or
    governed — so a use case the model calls 'ready' is ready by the same
    definition the rest of the app uses.
    """
    rows = await db.fetch("""
        SELECT dd.name, dd.label, dd.description, dd.category,
               COUNT(asd.data_asset_id) FILTER (
                   WHERE asd.data_asset_id = ANY($1::int[])
               ) AS ready_assets
        FROM data_domains dd
        LEFT JOIN asset_serves_domain asd ON asd.domain_id = dd.id
        LEFT JOIN data_assets da ON da.id = asd.data_asset_id
        WHERE COALESCE(dd.is_active, true) = true
        GROUP BY dd.id, dd.name, dd.label, dd.description, dd.category
        ORDER BY dd.category NULLS LAST, dd.label
    """, await ready_assets())
    satisfied: list[dict] = []
    unsatisfied: list[dict] = []
    index: dict[str, dict] = {}
    for row in rows:
        entry = {"name": row["name"], "label": row["label"],
                 "description": row["description"], "category": row["category"]}
        index[row["name"]] = entry
        (satisfied if (row["ready_assets"] or 0) > 0 else unsatisfied).append(entry)
    return satisfied, unsatisfied, index, {d["name"] for d in satisfied}


# ---------------------------------------------------------------------------
# Confirm — the only place agent-proposed writes actually happen
# ---------------------------------------------------------------------------
async def _research_executor(payload: dict, actor: str) -> dict:
    """Apply calibrated value assumptions. Owned by routes/research.py.

    Imported lazily: research.py imports this module's confirm helpers, so a
    module-scope import would close a cycle.
    """
    from .research import execute_apply_research
    return await execute_apply_research(payload, actor)


async def _proposal_executor(payload: dict, actor: str) -> dict:
    """Write a generated use-case proposal into the knowledge base.

    Lazily imported for the same cycle reason as the research executor.
    """
    from .proposals import execute_create_proposal
    return await execute_create_proposal(payload, actor)


# Intent -> executor. Adding an intent means adding a row here; an intent with no
# executor is rejected at confirm time rather than silently succeeding.
async def _author_executor(payload: dict, actor: str) -> dict:
    """Write a hand-added (or re-mapped) use case. Owned by routes/authoring.py."""
    from .authoring import execute_author_use_case
    return await execute_author_use_case(payload, actor)


_EXECUTORS = {
    cf.INTENT_AUTHOR_USE_CASE: _author_executor,
    # Registered here rather than in their own modules because /api/confirm lives in
    # this module — every agent-proposed write shares that one gate.
    cf.INTENT_APPLY_RESEARCH: _research_executor,
    cf.INTENT_CREATE_PROPOSAL: _proposal_executor,
}


@confirm_router.get("/{token}")
async def read_confirm(token: str = Path(..., min_length=8)):
    """Re-read a pending confirm card without consuming it."""
    card = await cf.peek_token(token)
    if card is None:
        raise HTTPException(404, "Confirmation not found")
    return card


@confirm_router.post("/{token}")
async def apply_confirm(request: Request, token: str = Path(..., min_length=8)):
    """Consume a token and perform its write. Single-use."""
    actor = current_user(request)
    try:
        intent, payload = await cf.consume_token(token, actor)
    except cf.ConfirmError as exc:
        # 409: the token is real but no longer usable (already applied, expired).
        raise HTTPException(409, exc.reason)

    executor = _EXECUTORS.get(intent)
    if executor is None:
        raise HTTPException(500, f"No executor is registered for intent {intent!r}")

    started = time.monotonic()
    result = await executor(payload, actor)
    return {
        "ok": True,
        "intent": intent,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        **result,
    }


# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------
@router.post("/cleanup")
async def cleanup(request: Request):
    """Delete expired previews and consumed/expired tokens.

    Called by the UI occasionally rather than on a schedule — these tables are
    small and correctness never depends on the sweep (expiry is enforced at read
    time), so a cron would be more machinery than the problem warrants.
    """
    actor = current_user(request)
    tokens = await db.execute(
        "DELETE FROM confirm_tokens WHERE expires_at < now() - INTERVAL '7 days'")
    await write_audit("generation", None, "cleanup", actor,
                      {"tokens": tokens})
    return {"ok": True, "tokens_deleted": tokens}


# ---------------------------------------------------------------------------
# Research — chain compression for "draft a use case about X"
# ---------------------------------------------------------------------------
_STOPWORDS = {
    "the", "and", "for", "with", "from", "that", "this", "into", "using", "use",
    "case", "data", "analytics", "based", "management", "system", "our", "their",
}


def _tokenize(topic: str) -> list[str]:
    """Words worth scoring on. Deliberately simple — lowercase, split, drop short
    and generic terms. A real tokenizer would be over-engineering here; missing a
    synonym is cheaper than a flaky scoring function nobody can reason about."""
    words = [w.strip("-_/") for w in (topic or "").lower().replace("/", " ").split()]
    return [w for w in words if len(w) > 3 and w not in _STOPWORDS]


@router.get("/research")
async def research(topic: str, limit: int = 8):
    """One structured brief for a use-case topic, instead of 4-6 round trips.

    Without this, drafting a use case means separately fetching similar use cases
    (for style and collision-checking), the domain vocabulary, and which domains
    are satisfied — then aggregating by hand. Doing it server-side is faster, and
    more importantly it is consistent: the same brief every time, rather than
    depending on which lookups the caller remembered to make.

    Returns suggestions, not decisions. Nothing is written.
    """
    tokens = _tokenize(topic)
    if not tokens:
        raise HTTPException(
            422, "Give a more specific topic — at least one word longer than three "
                 "characters that isn't a generic term like 'data' or 'use case'.")

    # Score existing use cases: a token in the title is a much stronger signal
    # than one buried in a paragraph of description, hence 3x weighting.
    membership_expr, membership_params = await portfolio.select_membership_expression(
        "uc", param_index=3)
    rows = await db.fetch(f"""
        SELECT uc.id, uc.title, uc.description, uc.status, uc.effort_tshirt,
               uc.sub_vertical, {membership_expr} AS in_portfolio, l.name AS lob_name,
               (SELECT count(*) * 3 FROM unnest($1::text[]) t
                 WHERE position(t in lower(uc.title)) > 0)
               + (SELECT count(*) FROM unnest($1::text[]) t
                   WHERE position(t in lower(coalesce(uc.description,''))) > 0)
               AS score
        FROM use_cases uc
        LEFT JOIN lobs l ON l.id = uc.lob_id
        ORDER BY score DESC, uc.title
        LIMIT $2
    """, tokens, limit, *membership_params)
    similar = [dict(r) for r in rows if (r["score"] or 0) > 0]

    satisfied, unsatisfied, index, satisfied_names = await _domain_context()

    # Domains the closest existing use cases already depend on — the best
    # available prior for what a new use case on this topic will need.
    suggested_domains: list[dict] = []
    if similar:
        domain_rows = await db.fetch("""
            SELECT dd.name, dd.label, urd.necessity, count(*) AS uses
            FROM uc_requires_domain urd
            JOIN data_domains dd ON dd.id = urd.domain_id
            WHERE urd.use_case_id = ANY($1::int[])
            GROUP BY dd.name, dd.label, urd.necessity
            ORDER BY uses DESC, dd.label
            LIMIT 12
        """, [s["id"] for s in similar])
        suggested_domains = [
            {**dict(r), "satisfied": r["name"] in satisfied_names} for r in domain_rows]

    warnings = []
    exact = [s for s in similar if s["title"].lower() == topic.strip().lower()]
    if exact:
        warnings.append(
            f"A use case titled {exact[0]['title']!r} already exists (#{exact[0]['id']}).")
    if len(tokens) == 1:
        warnings.append("Single-word topic — matches may be broad.")

    return {
        "topic": topic,
        "tokens_used": tokens,
        "matched_count": len(similar),
        "similar_use_cases": similar,
        "suggestions": {
            "domains": suggested_domains,
            "lob_name": similar[0]["lob_name"] if similar else None,
            "effort_tshirt": similar[0]["effort_tshirt"] if similar else gen.DEFAULT_EFFORT,
            "sub_vertical": similar[0]["sub_vertical"] if similar else gen.DEFAULT_SUB_VERTICAL,
            # A topic whose prior domains are all satisfied is a 'ready' candidate.
            "likely_lens": ("ready" if suggested_domains and all(
                d["satisfied"] for d in suggested_domains
                if d["necessity"] == "required") else "gap"),
        },
        "domain_counts": {"satisfied": len(satisfied), "unsatisfied": len(unsatisfied),
                          "total": len(index)},
        "warnings": warnings,
    }
