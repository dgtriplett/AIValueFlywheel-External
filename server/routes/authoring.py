"""Add a use case by hand — the agent maps it into the catalog.

FLOW
----
    POST /api/use-cases/author/propose   -> agent proposal (writes nothing)
    POST /api/use-cases/author/commit    -> re-validates the (possibly edited)
                                            proposal, issues a confirm token
    POST /api/confirm/{token}            -> performs the write (routes/generate.py)

`propose` also accepts `use_case_id` to RE-MAP an existing custom use case; the
commit then replaces that use case's agent/manual mappings with the reviewed set.

The proposal carries its own readiness preview for the active business unit
(how many of the required data assets are already ready), so the reviewer sees
the consequence of the mapping before accepting it.
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import authoring as au
from .. import confirm as cf
from .. import portfolio
from ..common import current_user, write_audit
from ..config import SERVING_ENDPOINT
from ..db import db
from ..limits import limiter
from ..readiness import ready_assets

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/use-cases/author", tags=["authoring"])


class DraftIn(BaseModel):
    title: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=4000)
    lob_id: int | None = None
    notes: str = Field(default="", max_length=2000)
    # Set to re-map an existing custom use case instead of creating a new one.
    use_case_id: int | None = None


class CommitIn(BaseModel):
    proposal: dict
    use_case_id: int | None = None
    in_portfolio: bool = True


async def _catalog() -> dict:
    lobs = [dict(r) for r in await db.fetch("SELECT id, name FROM lobs ORDER BY id")]
    domains = [dict(r) for r in await db.fetch(
        "SELECT name, label, category, description FROM data_domains "
        "WHERE is_active ORDER BY category, name")]
    assets = [dict(r) for r in await db.fetch(
        "SELECT id, source_category, source_system, module, description "
        "FROM data_assets ORDER BY id")]
    use_cases = [dict(r) for r in await db.fetch(
        "SELECT id, title, phase FROM use_cases ORDER BY id")]
    return {"lobs": lobs, "domains": domains, "assets": assets, "use_cases": use_cases}


def _validate(raw: dict | None, draft: dict, cat: dict) -> tuple[dict, list[str]]:
    return au.validate_proposal(
        raw, draft,
        lob_ids={lob["id"] for lob in cat["lobs"]},
        domain_names={d["name"] for d in cat["domains"]},
        asset_ids={a["id"] for a in cat["assets"]},
        use_case_ids={u["id"] for u in cat["use_cases"]})


async def _edges() -> list[tuple[int, int]]:
    return [(r["from_use_case_id"], r["to_use_case_id"])
            for r in await db.fetch("SELECT from_use_case_id, to_use_case_id FROM uc_enables_uc")]


async def _decorate(proposal: dict, cat: dict) -> dict:
    """Labels + readiness preview for the review card (display only)."""
    asset_label = {a["id"]: f"{a.get('source_category') or a.get('source_system')} · {a['module']}"
                   for a in cat["assets"]}
    uc_title = {u["id"]: u["title"] for u in cat["use_cases"]}
    domain_label = {d["name"]: d.get("label") or d["name"] for d in cat["domains"]}
    lob_name = {lob["id"]: lob["name"] for lob in cat["lobs"]}
    ready = set(await ready_assets())
    for a in proposal["data_assets"]:
        a["label"] = asset_label.get(a["id"], str(a["id"]))
        a["ready"] = a["id"] in ready
    for key in ("prerequisites", "enables"):
        for e in proposal[key]:
            e["label"] = uc_title.get(e["id"], str(e["id"]))
    for d in proposal["domains"]:
        d["label"] = domain_label.get(d["name"], d["name"])
    required = [a for a in proposal["data_assets"] if a["criticality"] == "required"]
    return {
        "lob_name": lob_name.get(proposal.get("lob_id")),
        "readiness_preview": {
            "required_total": len(required),
            "required_ready": sum(1 for a in required if a["ready"]),
        },
    }


@router.post("/propose", dependencies=[Depends(limiter("generate"))])
async def propose(body: DraftIn):
    draft = body.model_dump()
    if body.use_case_id is not None:
        row = await db.fetchrow(
            "SELECT title, description, lob_id, origin FROM use_cases WHERE id=$1", body.use_case_id)
        if row is None:
            raise HTTPException(404, "Use case not found")
        draft["title"] = draft["title"] or row["title"]
        draft["description"] = draft["description"] or (row["description"] or "")
        draft["lob_id"] = draft["lob_id"] or row["lob_id"]
    if not draft["title"].strip():
        raise HTTPException(422, "A title is required")

    cat = await _catalog()
    from .agents import _llm_json, build_value_model
    prompt = au.build_prompt(draft, **cat)
    (raw, used_llm, note), vm = await asyncio.gather(
        _llm_json(prompt, max_tokens=4000, response_schema=au.RESPONSE_SCHEMA,
                  accept=lambda o: bool(o.get("title"))),
        build_value_model(draft["title"], draft["description"]),
    )
    if not raw:
        raw = au.heuristic_proposal(draft, domains=cat["domains"], assets=cat["assets"])
    proposal, warnings = _validate(raw, draft, cat)
    warnings += au.drop_cycle_edges(proposal, await _edges(), node_id=body.use_case_id or -1)
    proposal["value_model"] = vm.get("value_model")
    meta = await _decorate(proposal, cat)
    return {
        "proposal": proposal,
        "warnings": warnings,
        "used_llm": bool(used_llm),
        "model": SERVING_ENDPOINT if used_llm else "heuristic",
        "note": note,
        **meta,
    }


@router.post("/commit", dependencies=[Depends(limiter("write"))])
async def commit(body: CommitIn, request: Request):
    """Re-validate the reviewed proposal and return a confirm card. Writes nothing."""
    actor = current_user(request)
    cat = await _catalog()
    draft = {"use_case_id": body.use_case_id, "title": body.proposal.get("title"),
             "description": body.proposal.get("description"), "lob_id": body.proposal.get("lob_id")}
    proposal, warnings = _validate(body.proposal, draft, cat)
    if not proposal["title"]:
        raise HTTPException(422, "A title is required")
    warnings += au.drop_cycle_edges(proposal, await _edges(), node_id=body.use_case_id or -1)
    if body.use_case_id is None:
        clash = await db.fetchrow(
            "SELECT id FROM use_cases WHERE lower(title) = lower($1)", proposal["title"])
        if clash is not None:
            raise HTTPException(409, f"A use case named '{proposal['title']}' already exists.")
    verb = "Update" if body.use_case_id else "Create"
    token = await cf.issue_token(
        cf.INTENT_AUTHOR_USE_CASE,
        {"proposal": proposal, "use_case_id": body.use_case_id,
         "in_portfolio": body.in_portfolio},
        actor=actor,
        summary=f"{verb} use case '{proposal['title']}' with {au.summarize(proposal)}",
    )
    return {**token, "proposal": proposal, "warnings": warnings}


async def execute_author_use_case(payload: dict, actor: str) -> dict:
    """Confirm executor: write the use case and every reviewed mapping."""
    p = payload["proposal"]
    uc_id = payload.get("use_case_id")
    vm = json.dumps(p["value_model"]) if p.get("value_model") else None
    if uc_id is None:
        clash = await db.fetchrow(
            "SELECT id FROM use_cases WHERE lower(title) = lower($1)", p["title"])
        if clash is not None:
            return {"created": None, "skipped": "duplicate title"}
        row = await db.fetchrow(
            """INSERT INTO use_cases
               (title, description, lob_id, sub_vertical, status, category, effort_tshirt,
                hypothesized_value_json, origin, in_portfolio, created_by, phase)
               VALUES ($1,$2,$3,$4,'not_started',$5,$6,$7::jsonb,'custom',$8,$9,1)
               RETURNING id""",
            p["title"], p["description"], p.get("lob_id"), p["sub_vertical"],
            p.get("category"), p["effort_tshirt"], vm,
            bool(payload.get("in_portfolio", True)), actor)
        uc_id = row["id"]
        action = "author"
    else:
        await db.execute(
            """UPDATE use_cases SET title=$1, description=$2, lob_id=$3, sub_vertical=$4,
                   category=$5, effort_tshirt=$6,
                   hypothesized_value_json=COALESCE($7::jsonb, hypothesized_value_json),
                   updated_at=now()
               WHERE id=$8""",
            p["title"], p["description"], p.get("lob_id"), p["sub_vertical"],
            p.get("category"), p["effort_tshirt"], vm, uc_id)
        # The reviewed set REPLACES the previous mappings for this use case.
        await db.execute("DELETE FROM uc_requires_asset WHERE use_case_id=$1", uc_id)
        await db.execute("DELETE FROM uc_requires_domain WHERE use_case_id=$1", uc_id)
        await db.execute(
            "DELETE FROM uc_enables_uc WHERE from_use_case_id=$1 OR to_use_case_id=$1", uc_id)
        action = "remap"

    # The reviewer accepted these, so they are recorded as manual (locked against
    # later automatic re-detection). Batched: one statement per relationship type.
    await db.executemany(
        """INSERT INTO uc_requires_asset (use_case_id, data_asset_id, criticality, manual)
           VALUES ($1,$2,$3,true)
           ON CONFLICT (use_case_id, data_asset_id) DO UPDATE SET criticality=EXCLUDED.criticality""",
        [(uc_id, a["id"], a["criticality"]) for a in p["data_assets"]])
    domain_ids = {r["name"]: r["id"] for r in await db.fetch("SELECT id, name FROM data_domains")}
    await db.executemany(
        """INSERT INTO uc_requires_domain
           (use_case_id, domain_id, necessity, rationale, mapped_by, manual)
           VALUES ($1,$2,$3,$4,'manual',true)
           ON CONFLICT (use_case_id, domain_id) DO NOTHING""",
        [(uc_id, domain_ids[d["name"]], d["necessity"], d.get("rationale") or None)
         for d in p["domains"] if d["name"] in domain_ids])
    edges = ([(e["id"], uc_id, e.get("rationale") or None) for e in p["prerequisites"]]
             + [(uc_id, e["id"], e.get("rationale") or None) for e in p["enables"]])
    await db.executemany(
        """INSERT INTO uc_enables_uc (from_use_case_id, to_use_case_id, detected_by_agent, rationale)
           VALUES ($1,$2,true,$3) ON CONFLICT (from_use_case_id, to_use_case_id) DO NOTHING""",
        edges)
    await db.execute(
        "UPDATE use_cases SET requires_locked=true, domains_locked=true WHERE id=$1", uc_id)

    if payload.get("in_portfolio", True):
        await portfolio.set_membership(uc_id, True, actor=actor, source="authored_use_case")
    try:
        from ..phase import recompute_and_store
        await recompute_and_store()
    except Exception:  # noqa: BLE001 - phase is derived; a failure must not undo the write
        logger.warning("phase recompute after authoring failed")
    await write_audit("use_case", uc_id, action, actor, {"summary": au.summarize(p)})
    return {"use_case_id": uc_id, "action": action, "summary": au.summarize(p)}
