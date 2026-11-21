"""Roadmap import: seed and refresh a business unit's portfolio from a roadmap package.

    POST /api/roadmap-import/preview    validate a package; suggest a catalog match for
                                        every use case; diff against the last version
    POST /api/roadmap-import/suggest    ask the model to suggest matches for the use
                                        cases word overlap could not place (optional)
    POST /api/roadmap-import/apply      write the reviewed decisions
    POST /api/roadmap-import/package    the package as it would be imported (download)
    GET  /api/roadmap-import/history    this account's imports, newest first

    GET  /api/roadmap/summary           pillars, stages and per-pillar progress for Operate
    GET  /api/roadmap/use-cases/{id}    what the roadmap said about one portfolio use case

People confirm, the app writes: preview never writes, and apply writes exactly the
decisions the reviewer saw (map to a catalog use case, create a new one, or skip).
Every endpoint takes either a roadmap package (`package`, ROADMAP_PACKAGE.md) or an AI
Transformation Roadmap deck (`deck_html` + `file_name`), which server/aitr_deck.py turns
into a package in memory; the HTML is never stored. Pure logic: server/roadmap_package.py.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import accounts as acct
from .. import llm
from .. import portfolio
from .. import aitr_deck
from .. import roadmap_package as rp
from ..common import rows_to_list, write_audit
from ..db import db
from ..limits import limiter
from .sync_packages import _lookup_asset

logger = logging.getLogger(__name__)
router = APIRouter(tags=["roadmap-import"])

# The app's own catalog is Power & Utilities; a roadmap for another industry still
# imports, but its use cases will mostly be created new rather than mapped.
CATALOG_INDUSTRIES = {"power_utilities", "power-utilities", "power & utilities",
                      "power and utilities", "utilities", "energy", "p&u", "pu"}

MAX_PACKAGE_BYTES = 5_000_000
MAX_DECK_BYTES = 15_000_000


class PackageIn(BaseModel):
    """A roadmap package, or the AITR deck it is extracted from."""
    package: dict[str, Any] | None = None
    deck_html: str | None = Field(default=None, max_length=MAX_DECK_BYTES)
    file_name: str | None = Field(default=None, max_length=300)


class Decision(BaseModel):
    external_id: str = Field(..., max_length=200)
    action: Literal["map", "create", "skip"]
    use_case_id: int | None = None


class ApplyIn(PackageIn):
    decisions: list[Decision] = Field(default_factory=list)


class SuggestIn(PackageIn):
    external_ids: list[str] = Field(default_factory=list, max_length=40)


def _source_app(norm: rp.Normalized) -> str:
    return f"roadmap:{norm.roadmap['id']}"


def _load(body: PackageIn) -> tuple[rp.Normalized, list[str]]:
    if body.deck_html:
        if not aitr_deck.looks_like_deck(body.deck_html):
            raise HTTPException(422, {"message": "This HTML file is not an AI Transformation Roadmap deck.",
                                      "errors": ["No roadmap data found in the page. Upload the deck as "
                                                 "published, or its roadmap package (.json)."],
                                      "warnings": []})
        try:
            package = aitr_deck.deck_to_package(body.deck_html, file_name=body.file_name)
        except aitr_deck.UnsafeContent:
            raise HTTPException(422, {"message": "This deck could not be imported safely.",
                                      "errors": ["Some of its content could not be separated from internal-only "
                                                 "sizing notes. Ask the roadmap's author for its roadmap package (.json)."],
                                      "warnings": []})
        except ValueError as exc:
            raise HTTPException(422, {"message": "This deck could not be read.", "errors": [str(exc)], "warnings": []})
    elif body.package is not None:
        package = body.package
    else:
        raise HTTPException(422, "Send a roadmap package or an AITR deck.")
    if len(json.dumps(package, default=str)) > MAX_PACKAGE_BYTES:
        raise HTTPException(413, "The roadmap package is larger than 5 MB.")
    norm, errors, warnings = rp.normalize(package)
    if norm is None:
        raise HTTPException(422, {"message": "This is not a valid roadmap package.",
                                  "errors": errors[:50], "warnings": warnings[:50]})
    return norm, warnings


async def _catalog() -> list[dict]:
    """Match candidates: the shipped catalog only. A custom use case belongs to the
    business unit that created it; offering it to another unit's roadmap would quietly
    share one record (status, value) between two units."""
    return rows_to_list(await db.fetch(
        "SELECT id, title, description, origin FROM use_cases WHERE origin = 'catalog' ORDER BY id"))


async def _prior_mappings(account_id: int | None, source_app: str) -> dict[str, int]:
    rows = await db.fetch("""
        SELECT source_object_id, local_object_id FROM external_object_map
        WHERE account_id = $1 AND source_app = $2
          AND source_object_type = 'use_case' AND local_object_type = 'use_case'
    """, account_id or 0, source_app)
    out = {}
    for r in rows:
        try:
            out[r["source_object_id"]] = int(r["local_object_id"])
        except (TypeError, ValueError):
            continue
    return out


async def _latest_import(account_id: int | None) -> dict | None:
    if account_id is None:
        return None
    row = await db.fetchrow("""
        SELECT id, roadmap_id, roadmap_version, title, package_json, created_at, created_by
        FROM roadmap_imports WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1
    """, account_id)
    if not row:
        return None
    d = dict(row)
    pj = d.get("package_json")
    d["package_json"] = json.loads(pj) if isinstance(pj, str) else (pj or {})
    return d


def _industry_note(norm: rp.Normalized) -> str | None:
    ind = (norm.roadmap.get("industry") or "").strip().lower()
    if not ind or ind in CATALOG_INDUSTRIES:
        return None
    return (f"This roadmap is for '{norm.roadmap['industry']}'. The built-in catalog covers "
            "Power & Utilities, so most of its use cases will be created as new use cases "
            "rather than mapped to the catalog.")


# ---------------------------------------------------------------------------
# preview
# ---------------------------------------------------------------------------
@router.post("/roadmap-import/preview")
async def preview(body: PackageIn):
    norm, warnings = _load(body)
    account_id = await acct.current()
    catalog = await _catalog()
    by_id = {c["id"]: c for c in catalog}
    matches = rp.match(norm.use_cases, catalog)

    # A use case this roadmap already brought in keeps its mapping, whatever the
    # word overlap now says: a re-import must never quietly re-point a use case.
    prior = await _prior_mappings(account_id, _source_app(norm))
    if prior:
        missing = [i for i in prior.values() if i not in by_id]
        if missing:
            for r in await db.fetch("SELECT id, title FROM use_cases WHERE id = ANY($1::int[])", missing):
                by_id[r["id"]] = {"id": r["id"], "title": r["title"]}
    for m in matches:
        pid = prior.get(m["external_id"])
        if pid and pid in by_id:
            m["candidates"] = [{"use_case_id": pid, "title": by_id[pid]["title"], "score": 1.0,
                                "reason": "imported before"}] + \
                              [c for c in m["candidates"] if c["use_case_id"] != pid][:2]
            m["suggestion"] = {"action": "map", "use_case_id": pid}
            m["previously_imported"] = True

    latest = await _latest_import(account_id)
    same_roadmap = latest and latest.get("roadmap_id") == norm.roadmap["id"]
    changes = rp.diff(latest["package_json"] if same_roadmap else None, norm.as_dict())
    replaces = None
    if latest and not same_roadmap:
        replaces = {"roadmap_id": latest["roadmap_id"], "title": latest.get("title"),
                    "imported_at": latest.get("created_at")}

    ucs = {u["id"]: u for u in norm.use_cases}
    for m in matches:
        u = ucs[m["external_id"]]
        m.update({"summary": u.get("summary"), "pillar_ids": u["pillar_ids"],
                  "priority_tier": u.get("priority_tier"),
                  "value_base": (u.get("value") or {}).get("annual_base")})
    total_value = sum((u.get("value") or {}).get("annual_base") or 0 for u in norm.use_cases)
    return {
        "ok": True,
        "source": "deck" if body.deck_html else "package",
        "warnings": warnings[:100],
        "roadmap": norm.roadmap,
        "generator": norm.generator,
        "pillars": norm.pillars,
        "counts": {"use_cases": len(norm.use_cases), "pillars": len(norm.pillars),
                   "suggest_map": sum(m["suggestion"]["action"] == "map" for m in matches),
                   "suggest_create": sum(m["suggestion"]["action"] == "create" for m in matches),
                   "total_value": round(total_value, 2)},
        "matches": matches,
        "diff": changes,
        "replaces": replaces,
        "industry_note": _industry_note(norm),
    }


@router.post("/roadmap-import/package")
async def as_package(body: PackageIn):
    """The roadmap package exactly as it would be imported (e.g. what was taken from an
    uploaded deck), for download and review."""
    norm, warnings = _load(body)
    return {"package": norm.as_dict(), "warnings": warnings}


# ---------------------------------------------------------------------------
# AI-assisted matching (optional; the deterministic preview always works without it)
# ---------------------------------------------------------------------------
@router.post("/roadmap-import/suggest", dependencies=[Depends(limiter("generate"))])
async def suggest(body: SuggestIn):
    norm, _ = _load(body)
    wanted = set(body.external_ids) or {u["id"] for u in norm.use_cases}
    ucs = [u for u in norm.use_cases if u["id"] in wanted][:40]
    catalog = await _catalog()
    if not ucs or not catalog:
        return {"suggestions": [], "model_used": False}
    by_id = {c["id"]: c for c in catalog}
    # Give the model a short list per use case (looser than the preview's floor) so
    # the prompt stays small and the answer can only be a real catalog id.
    shortlist: dict[str, list[dict]] = {}
    for u in ucs:
        ut = rp.tokens(u["name"] + " " + (u.get("summary") or ""))
        scored = sorted(((len(ut & rp.tokens(c["title"] + " " + (c.get("description") or "")[:300])), c)
                         for c in catalog), key=lambda x: -x[0])
        shortlist[u["id"]] = [c for s, c in scored[:12] if s > 0]
    prompt = [{"id": u["id"], "name": u["name"], "summary": (u.get("summary") or "")[:400],
               "candidates": [{"id": c["id"], "title": c["title"]} for c in shortlist[u["id"]]]}
              for u in ucs]
    system = ("You match a company's roadmap use cases to a catalog of use cases. For each "
              "roadmap use case pick the ONE candidate that describes the same business outcome "
              "and mechanism, or null when none does. Same topic is not enough. Answer only JSON: "
              '{"matches":[{"id":"<roadmap id>","catalog_id":<int or null>,"why":"<12 words>"}]}')
    try:
        raw = await llm.chat_completion([{"role": "system", "content": system},
                                         {"role": "user", "content": json.dumps(prompt)}],
                                        max_tokens=3000)
        parsed = llm.extract_json(raw) or {}
    except Exception as exc:  # noqa: BLE001
        logger.info("roadmap match suggestion unavailable (%s)", type(exc).__name__)
        return {"suggestions": [], "model_used": False,
                "message": "The model endpoint is unavailable; match these by hand."}
    out = []
    for m in (parsed.get("matches") or []) if isinstance(parsed, dict) else []:
        if not isinstance(m, dict) or m.get("id") not in wanted:
            continue
        cid = m.get("catalog_id")
        allowed = {c["id"] for c in shortlist.get(m["id"], [])}
        if isinstance(cid, int) and cid in allowed and cid in by_id:
            out.append({"external_id": m["id"], "use_case_id": cid, "title": by_id[cid]["title"],
                        "why": str(m.get("why") or "")[:200]})
        else:
            out.append({"external_id": m["id"], "use_case_id": None, "title": None,
                        "why": str(m.get("why") or "no catalog use case describes the same outcome")[:200]})
    return {"suggestions": out, "model_used": True}


# ---------------------------------------------------------------------------
# apply
# ---------------------------------------------------------------------------
@router.post("/roadmap-import/apply", dependencies=[Depends(limiter("write"))])
async def apply(body: ApplyIn, request: Request):
    actor, account_id = await acct.require_editor(request)
    if account_id is None:
        raise HTTPException(409, "No active business unit. Create or select one first.")
    norm, warnings = _load(body)
    source_app = _source_app(norm)
    ucs = {u["id"]: u for u in norm.use_cases}
    catalog_ids = {c["id"] for c in await _catalog()}
    prior = await _prior_mappings(account_id, source_app)
    # A use case this roadmap brought in before (incl. ones it created) stays mappable.
    if prior:
        rows = await db.fetch("SELECT id FROM use_cases WHERE id = ANY($1::int[])", list(prior.values()))
        catalog_ids |= {r["id"] for r in rows}

    decisions = {d.external_id: d for d in body.decisions}
    unknown = sorted(set(decisions) - set(ucs))
    if unknown:
        raise HTTPException(422, f"Decisions name use cases that are not in the package: {', '.join(unknown[:10])}")
    missing = sorted(set(ucs) - set(decisions))
    if missing:
        raise HTTPException(422, f"Every use case needs a decision (map, create or skip). Missing: {', '.join(missing[:10])}")
    for d in decisions.values():
        if d.action == "map" and d.use_case_id not in catalog_ids:
            raise HTTPException(422, f"{d.external_id}: use case {d.use_case_id} does not exist.")
    mapped_targets: dict[int, str] = {}
    for d in decisions.values():
        if d.action == "map":
            if d.use_case_id in mapped_targets:
                raise HTTPException(422, f"{mapped_targets[d.use_case_id]} and {d.external_id} are both "
                                         f"mapped to use case {d.use_case_id}. Map each roadmap use case "
                                         "to a different one, or create one of them new.")
            mapped_targets[d.use_case_id] = d.external_id

    stages = {s["id"]: s["name"] for s in norm.stages}
    workstreams = {w["id"]: w["name"] for w in norm.workstreams}
    datasets = {d["id"]: d["name"] for d in norm.datasets}

    latest = await _latest_import(account_id)
    same_roadmap = latest and latest.get("roadmap_id") == norm.roadmap["id"]
    changes = rp.diff(latest["package_json"] if same_roadmap else None, norm.as_dict())

    # Settle everything that can fail BEFORE the first write (Delta has no
    # multi-statement transactions): new use cases need titles unique app-wide, and
    # another business unit may already have created one with the same name.
    to_create = [e for e, d in decisions.items()
                 if d.action == "create" and prior.get(e) not in catalog_ids]
    titles = await _unique_titles([ucs[e]["name"] for e in to_create], account_id)
    new_title = dict(zip(to_create, titles))

    import_id = str(uuid.uuid4())
    summary = {"mapped": 0, "created": 0, "reused": 0, "skipped": 0, "value_updated": 0,
               "data_needs_linked": 0, "data_needs_unresolved": 0, "dropped": 0}
    local_ids: dict[str, int] = {}

    for ext_id, uc in ucs.items():
        d = decisions[ext_id]
        if d.action == "skip":
            summary["skipped"] += 1
            continue
        formula = rp.value_formula(uc.get("value"), norm.roadmap["currency"])
        reuse = prior.get(ext_id) if prior.get(ext_id) in catalog_ids else None
        if d.action == "map" or (d.action == "create" and reuse is not None):
            # "create" for a use case an earlier import of this roadmap already created
            # reuses it rather than making a duplicate.
            lid = int(d.use_case_id) if d.action == "map" else reuse
            local_ids[ext_id] = lid
            summary["reused" if lid == reuse else "mapped"] += 1
            if formula and await _refresh_roadmap_value(lid, formula):
                summary["value_updated"] += 1
        else:
            row = await db.fetchrow("""
                INSERT INTO use_cases
                  (title, description, category, status, effort_tshirt, hypothesized_value_json,
                   origin, in_portfolio, created_by)
                VALUES ($1, $2, $3, 'not_started', $4, $5::jsonb, 'custom', true, $6)
                RETURNING id
            """, new_title[ext_id], uc.get("description") or uc.get("summary"),
                stages.get(uc.get("stage_id")) or "Roadmap", uc.get("effort"),
                json.dumps(formula) if formula else None, actor)
            local_ids[ext_id] = int(row["id"])
            summary["created"] += 1
            linked, unresolved = await _link_data_needs(local_ids[ext_id], uc, datasets)
            summary["data_needs_linked"] += linked
            summary["data_needs_unresolved"] += unresolved

    if local_ids:
        await portfolio.add_many(list(local_ids.values()), actor=actor, source="roadmap")
        await db.executemany("""
            INSERT INTO external_object_map
              (account_id, source_app, source_object_type, source_object_id,
               local_object_type, local_object_id, source_hash, imported_by, imported_at)
            VALUES ($1, $2, 'use_case', $3, 'use_case', $4, $5, $6, now())
            ON CONFLICT (account_id, source_app, source_object_type, source_object_id, local_object_type)
            DO UPDATE SET local_object_id = EXCLUDED.local_object_id,
                          source_hash = EXCLUDED.source_hash,
                          imported_by = EXCLUDED.imported_by, imported_at = now()
        """, [(account_id, source_app, ext, str(lid), import_id[:16], actor) for ext, lid in local_ids.items()])

    # Roadmap context: replace the rows this import covers, then mark the rest dropped
    # (kept, not deleted: the use case may be half-built, and the portfolio is the
    # team's to prune, not the importer's).
    ext_ids, uc_ids = list(local_ids), list(local_ids.values())
    if ext_ids:
        await db.execute("""
            DELETE FROM account_roadmap_use_cases
            WHERE account_id = $1 AND (external_id = ANY($2::text[]) OR use_case_id = ANY($3::int[]))
        """, account_id, ext_ids, uc_ids)
        rows = []
        for ext, lid in local_ids.items():
            uc = ucs[ext]
            v = uc.get("value") or {}
            rows.append((
                account_id, lid, ext, import_id, uc["name"], uc.get("summary"),
                uc.get("business_problem"), uc.get("kpi"), uc["pillar_ids"],
                stages.get(uc.get("stage_id")), workstreams.get(uc.get("workstream_id")),
                uc.get("priority_rank"), uc.get("priority_tier"), uc.get("effort"),
                uc.get("effort_quadrant"), norm.roadmap["currency"],
                v.get("annual_low"), v.get("annual_base"), v.get("annual_high"),
                json.dumps(v) if v else None,
                json.dumps(uc["plan"]) if uc.get("plan") else None,
                json.dumps({"datasets": [datasets[i] for i in uc["dataset_ids"] if i in datasets],
                            **uc["data_requirements"]}),
            ))
        await db.executemany("""
            INSERT INTO account_roadmap_use_cases
              (account_id, use_case_id, external_id, roadmap_import_id, name, summary,
               business_problem, kpi, pillar_ids, stage, workstream, priority_rank,
               priority_tier, effort, effort_quadrant, value_currency, value_low, value_base,
               value_high, value_json, plan_json, data_needs_json, dropped_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                    $20::jsonb,$21::jsonb,$22::jsonb,NULL,now())
        """, rows)
    res = await db.execute("""
        UPDATE account_roadmap_use_cases SET dropped_at = now()
        WHERE account_id = $1 AND dropped_at IS NULL AND NOT (external_id = ANY($2::text[]))
    """, account_id, ext_ids or ["\x00"])
    try:
        summary["dropped"] = int(str(res).split()[-1])
    except (ValueError, IndexError):
        summary["dropped"] = 0

    await db.execute("DELETE FROM account_pillars WHERE account_id = $1 AND source = 'roadmap'", account_id)
    if norm.pillars:
        await db.executemany("""
            INSERT INTO account_pillars (account_id, pillar_id, name, description, sort_order, source)
            VALUES ($1, $2, $3, $4, $5, 'roadmap')
        """, [(account_id, p["id"], p["name"], p.get("description"), i) for i, p in enumerate(norm.pillars)])

    summary["diff"] = {k: (len(v) if isinstance(v, list) else v) for k, v in changes.items()}
    summary["warnings"] = len(warnings)
    await db.execute("""
        INSERT INTO roadmap_imports
          (id, account_id, source_app, roadmap_id, roadmap_version, title, package_json,
           summary_json, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
    """, import_id, account_id, norm.generator["name"], norm.roadmap["id"], norm.roadmap.get("version"),
        norm.roadmap.get("title"), json.dumps(norm.as_dict()), json.dumps(summary), actor)
    await write_audit("roadmap_import", None, "apply", actor,
                      {"import_id": import_id, "roadmap_id": norm.roadmap["id"],
                       "version": norm.roadmap.get("version"), "summary": summary})
    try:
        from .. import snapshots
        await snapshots.capture_quietly("roadmap_import")
    except Exception:  # noqa: BLE001 - the trend is best-effort; the import succeeded
        pass
    return {"ok": True, "import_id": import_id, "summary": summary,
            "use_case_ids": local_ids}


async def _unique_titles(names: list[str], account_id: int) -> list[str]:
    """Titles for new use cases that collide with nothing (use_cases.title is unique,
    case-insensitively, across the app). A clash gets the business unit's name, then
    a number: 'Storm crew staging (North)', 'Storm crew staging (North) 2'."""
    if not names:
        return []
    taken = {str(r["t"]) for r in await db.fetch("SELECT lower(title) AS t FROM use_cases")}
    row = await db.fetchrow("SELECT name FROM accounts WHERE id = $1", account_id)
    unit = (row["name"] if row else None) or "roadmap"
    out = []
    for name in names:
        title, n = name, 1
        if title.lower() in taken:
            title = f"{name} ({unit})"
        while title.lower() in taken:
            n += 1
            title = f"{name} ({unit}) {n}"
        taken.add(title.lower())
        out.append(title[:300])
    return out


async def _refresh_roadmap_value(use_case_id: int, formula: dict) -> bool:
    """Update a use case's value to the roadmap's new estimate, but only a use case this
    app did not ship (catalog models are curated) and only while its value is still the
    roadmap's own estimate: once someone replaces it with a real model, a re-import
    must never overwrite their work."""
    row = await db.fetchrow(
        "SELECT origin, hypothesized_value_json FROM use_cases WHERE id = $1", use_case_id)
    if row is None or row["origin"] == "catalog":
        return False
    cur = row["hypothesized_value_json"]
    if isinstance(cur, str):
        try:
            cur = json.loads(cur)
        except ValueError:
            cur = None
    if cur and (not isinstance(cur, dict) or cur.get("source") != "roadmap"):
        return False
    if isinstance(cur, dict) and {k: cur.get(k) for k in ("low_mm", "mid_mm", "high_mm")} == \
            {k: formula.get(k) for k in ("low_mm", "mid_mm", "high_mm")}:
        return False
    await db.execute("UPDATE use_cases SET hypothesized_value_json = $2::jsonb, updated_at = now() WHERE id = $1",
                     use_case_id, json.dumps(formula))
    return True


async def _link_data_needs(use_case_id: int, uc: dict, datasets: dict[str, str]) -> tuple[int, int]:
    """Connect a newly created use case to the catalog's data assets its roadmap names.

    Only for use cases this import created: a catalog use case's requirements are
    curated, and a roadmap's free-text labels must not rewrite them."""
    labels: list[str] = []
    labels += [datasets[i] for i in uc.get("dataset_ids", []) if i in datasets]
    labels += uc.get("data_requirements", {}).get("assets", [])
    labels += uc.get("data_requirements", {}).get("sources", [])
    seen, linked, unresolved = set(), 0, 0
    for label in labels:
        key = label.lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        asset_id = await _lookup_asset(label)
        if asset_id is None:
            unresolved += 1
            continue
        await db.execute("""
            INSERT INTO uc_requires_asset (use_case_id, data_asset_id, criticality, manual)
            VALUES ($1, $2, 'required', false)
            ON CONFLICT (use_case_id, data_asset_id) DO NOTHING
        """, use_case_id, asset_id)
        linked += 1
    return linked, unresolved


# ---------------------------------------------------------------------------
# history + read models for Operate
# ---------------------------------------------------------------------------
@router.get("/roadmap-import/history")
async def history():
    account_id = await acct.current()
    if account_id is None:
        return {"imports": []}
    rows = rows_to_list(await db.fetch("""
        SELECT id, source_app, roadmap_id, roadmap_version, title, summary_json, created_by, created_at
        FROM roadmap_imports WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50
    """, account_id))
    for r in rows:
        if isinstance(r.get("summary_json"), str):
            r["summary_json"] = json.loads(r["summary_json"])
    return {"imports": rows}


@router.get("/roadmap/summary")
async def roadmap_summary():
    """Pillars with how much of each is on the roadmap, in flight and live."""
    account_id = await acct.current()
    if account_id is None:
        return {"roadmap": None, "pillars": [], "use_cases": []}
    latest = await _latest_import(account_id)
    pillars = rows_to_list(await db.fetch("""
        SELECT pillar_id, name, description, sort_order FROM account_pillars
        WHERE account_id = $1 ORDER BY sort_order, name
    """, account_id))
    condition, params = await portfolio.portfolio_condition("uc", param_index=2)
    rows = rows_to_list(await db.fetch(f"""
        SELECT r.use_case_id, r.external_id, r.name, r.pillar_ids, r.stage, r.workstream,
               r.priority_rank, r.priority_tier, r.value_base, r.value_currency, r.dropped_at,
               uc.title, uc.status
        FROM account_roadmap_use_cases r JOIN use_cases uc ON uc.id = r.use_case_id
        WHERE r.account_id = $1 AND {condition}
        ORDER BY r.priority_rank NULLS LAST, uc.title
    """, account_id, *params))
    by_pillar = {p["pillar_id"]: {**p, "use_cases": 0, "in_flight": 0, "live": 0, "value_base": 0.0,
                                  "value_live": 0.0} for p in pillars}
    for r in rows:
        if r.get("dropped_at"):
            continue
        live = r["status"] in ("live", "value_realized")
        moving = r["status"] in ("scoping", "in_progress")
        lead = (r.get("pillar_ids") or [None])[0]
        b = by_pillar.get(lead)
        if b is None:
            continue
        b["use_cases"] += 1
        b["in_flight"] += int(moving)
        b["live"] += int(live)
        b["value_base"] += float(r.get("value_base") or 0)
        if live:
            b["value_live"] += float(r.get("value_base") or 0)
    roadmap = None
    if latest:
        pkg = latest["package_json"]
        roadmap = {"import_id": latest["id"], "roadmap_id": latest["roadmap_id"],
                   "version": latest.get("roadmap_version"), "title": latest.get("title"),
                   "organization": (pkg.get("roadmap") or {}).get("organization"),
                   "currency": (pkg.get("roadmap") or {}).get("currency") or "USD",
                   "imported_at": latest.get("created_at"), "imported_by": latest.get("created_by")}
    return {"roadmap": roadmap, "pillars": list(by_pillar.values()), "use_cases": rows}


@router.get("/roadmap/use-cases/{use_case_id}")
async def roadmap_use_case(use_case_id: int):
    account_id = await acct.current()
    if account_id is None:
        return {"roadmap": None}
    row = await db.fetchrow("""
        SELECT * FROM account_roadmap_use_cases WHERE account_id = $1 AND use_case_id = $2
    """, account_id, use_case_id)
    if not row:
        return {"roadmap": None}
    d = dict(row)
    for k in ("value_json", "plan_json", "data_needs_json"):
        if isinstance(d.get(k), str):
            d[k] = json.loads(d[k])
    names = {r["pillar_id"]: r["name"] for r in await db.fetch(
        "SELECT pillar_id, name FROM account_pillars WHERE account_id = $1", account_id)}
    d["pillars"] = [{"id": p, "name": names.get(p, p)} for p in (d.get("pillar_ids") or [])]
    return {"roadmap": d}
