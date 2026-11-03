"""Assess AI Insights — the LLM-backed beta features on the results dashboard.

These are the endpoints the ported assessment frontend already calls (see
frontend/src/lib/api.ts): exec summary, proposed use cases, data strategy, strategic
roadmap narrative, and the pre-submit consistency check. They were missing in the
converged backend, so the "AI Insights" beta rendered blank. Each reads the stored
assessment (account_assessments.answers_json / results_json) and calls the Foundation
Model via server/llm.py. Every endpoint degrades gracefully — on any LLM or parse
failure it returns a deterministic, grounded fallback so the tab never hard-errors.

    POST /api/assessments/{id}/exec-summary
    POST /api/assessments/{id}/proposed-use-cases
    POST /api/assessments/{id}/data-strategy
    POST /api/strategic-roadmap/narrative
    POST /api/assessments/consistency-check
"""
from __future__ import annotations

import io
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import accounts as acct
from .. import llm
from ..config import SERVING_ENDPOINT
from ..db import db
from ..limits import limiter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["assess-ai"])


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _decode(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:  # noqa: BLE001
            return {}
    return v or {}


async def _load_assessment(aid: str) -> dict:
    """Load a submitted/draft assessment, scoped to the current account."""
    account_id = await acct.current()
    row = await db.fetchrow(
        """SELECT id, label, answers_json, results_json, overall_score, current_phase
           FROM account_assessments WHERE id=$1 AND ($2::int IS NULL OR account_id=$2)""",
        aid, account_id)
    if row is None:
        raise HTTPException(404, "Assessment not found")
    d = dict(row)
    d["answers_json"] = _decode(d.get("answers_json"))
    d["results_json"] = _decode(d.get("results_json"))
    return d


def _extract_json(text: str):
    """Pull the first JSON object/array out of an LLM response (tolerates ```json fences)."""
    if not text:
        return None
    t = re.sub(r"```(?:json)?", "", text).strip()
    # Whole-string first (the clean case).
    try:
        return json.loads(t)
    except Exception:  # noqa: BLE001
        pass
    # Reasoning models can emit thinking text (with its own braces) BEFORE the answer,
    # so a naive first-{/last-} slice captures garbage. Scan every top-level {…} object
    # and return the first that parses (the answer), rather than the span across all.
    depth, start = 0, -1
    for i, ch in enumerate(t):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                try:
                    return json.loads(t[start:i + 1])
                except Exception:  # noqa: BLE001
                    start = -1
    # last resort: outermost slice (arrays too)
    for opener, closer in (("{", "}"), ("[", "]")):
        i, j = t.find(opener), t.rfind(closer)
        if i != -1 and j > i:
            try:
                return json.loads(t[i:j + 1])
            except Exception:  # noqa: BLE001
                continue
    return None


async def _llm_json(system: str, user: str):
    """Call the FM and parse a JSON reply; returns (obj_or_None, raw_text)."""
    try:
        raw = await llm.chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}])
    except Exception as exc:  # noqa: BLE001
        logger.info("LLM call failed (%s)", type(exc).__name__)
        return None, ""
    return _extract_json(raw), raw


def _profile_line(a: dict) -> str:
    p = (a.get("answers_json") or {}).get("profile", {})
    r = a.get("results_json") or {}
    return (f"Customer: {p.get('companyName') or a.get('label') or 'the utility'}; "
            f"type: {p.get('utilityType') or 'utility'}; territory: {p.get('territorySize') or 'n/a'}; "
            f"priorities: {', '.join(p.get('strategicPriorities') or []) or 'n/a'}. "
            f"Maturity: phase {r.get('currentPhase', a.get('current_phase'))} "
            f"({r.get('phaseName', 'n/a')}), score {r.get('overallScore', a.get('overall_score'))}/100. "
            f"Dimension scores: {r.get('dimensionScores', {})}.")


def _top_recs(a: dict, n: int = 8) -> list[dict]:
    recs = (a.get("results_json") or {}).get("recommendations") or []
    out = []
    for rc in recs[:n]:
        uc = rc.get("useCase") or rc
        out.append({"id": uc.get("id"), "title": uc.get("title") or uc.get("name"),
                    "phase": uc.get("phase"), "domain": uc.get("domain")})
    return out


# ---------------------------------------------------------------------------
# 1. Executive summary
# ---------------------------------------------------------------------------
@router.post("/assessments/{aid}/exec-summary",
             dependencies=[Depends(limiter("research"))])
async def exec_summary(aid: str, request: Request):
    a = await _load_assessment(aid)
    # PROSE, not JSON — a summary is a paragraph, and wrapping it in a JSON string just
    # invites parse failures (an unescaped quote/newline then shows the user raw braces).
    raw = await _llm_text(
        "You are a Databricks solutions strategist writing for a utility executive. "
        "Write 2-3 tight paragraphs of plain prose — no JSON, no markdown headers, no preamble.",
        f"{_profile_line(a)}\nTop recommended use cases: {json.dumps(_top_recs(a))}.\n"
        "Write an executive summary of where they are, the biggest opportunity, and the "
        "recommended first moves. Ground it in the numbers above; do not invent metrics.")
    summary = raw.strip() if raw else (
        f"{_profile_line(a)} The priority is to establish foundational, governed data "
        "and pursue the highest-readiness use cases first to build momentum toward the next phase.")
    return {"assessmentId": aid, "summary": summary, "model": SERVING_ENDPOINT}


# ---------------------------------------------------------------------------
# 2. Proposed (net-new) use cases
# ---------------------------------------------------------------------------
@router.post("/assessments/{aid}/proposed-use-cases",
             dependencies=[Depends(limiter("generate"))])
async def proposed_use_cases(aid: str, request: Request):
    a = await _load_assessment(aid)
    obj, _ = await _llm_json(
        "You propose net-new Data & AI use cases for a utility, tailored to their profile. "
        "Return STRICT JSON: {\"rationale\": str, \"proposals\": [{\"id\":str,\"name\":str,"
        "\"phase\":int,\"domain\":str,\"description\":str,\"businessValue\":[str],"
        "\"dataRequirements\":[str],\"complexity\":int,\"whyItFits\":str,\"expectedValueMM\":number}]}. "
        "3-5 proposals, complexity 1-5, phase 1-3, expectedValueMM a realistic annual $M number.",
        f"{_profile_line(a)}\nAlready-recommended (do NOT duplicate): {json.dumps(_top_recs(a))}.\n"
        "Propose use cases that fit their utility type and priorities and build on their current data.")
    if not isinstance(obj, dict) or not isinstance(obj.get("proposals"), list):
        return {"rationale": "AI proposals are temporarily unavailable; showing none. "
                             "Use the catalog recommendations on the Overview tab.", "proposals": []}
    # normalize types defensively
    props = []
    for p in obj["proposals"][:5]:
        if not isinstance(p, dict):
            continue
        props.append({
            "id": str(p.get("id") or p.get("name", "")).strip() or "proposed",
            "name": str(p.get("name") or "Proposed use case"),
            "phase": int(p.get("phase") or 1) if str(p.get("phase") or "").strip().isdigit() else 1,
            "domain": str(p.get("domain") or "Cross-domain"),
            "description": str(p.get("description") or ""),
            "businessValue": [str(x) for x in (p.get("businessValue") or [])][:5],
            "dataRequirements": [str(x) for x in (p.get("dataRequirements") or [])][:8],
            "complexity": int(p.get("complexity") or 3) if str(p.get("complexity") or "").strip().isdigit() else 3,
            "whyItFits": str(p.get("whyItFits") or ""),
            "expectedValueMM": float(p.get("expectedValueMM") or 0) if _isnum(p.get("expectedValueMM")) else 0.0,
        })
    return {"rationale": str(obj.get("rationale") or ""), "proposals": props}


def _isnum(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


# ---------------------------------------------------------------------------
# 3. Data strategy — grounded source inventory + AI narrative
# ---------------------------------------------------------------------------
@router.post("/assessments/{aid}/data-strategy",
             dependencies=[Depends(limiter("research"))])
async def data_strategy(aid: str, request: Request):
    a = await _load_assessment(aid)
    account_id = await acct.current()
    # Grounded: real coarse sources grouped by category, with this account's availability.
    rows = await db.fetch("""
        SELECT s.category, s.name,
               COALESCE(ss.available, false) AS available
        FROM data_sources s
        LEFT JOIN account_source_status ss
               ON ss.data_source_id = s.id AND ss.account_id = $1
        WHERE s.is_active
        ORDER BY s.category, s.sort_order, s.name
    """, account_id)
    cats: dict[str, list] = {}
    total = in_scope = 0
    for r in rows:
        total += 1
        avail = bool(r["available"])
        if avail:
            in_scope += 1
        cats.setdefault(r["category"] or "Other", []).append({
            "label": r["name"], "earliestPhase": 1,
            "ucIds": [], "ucNames": [], "alreadyInScope": avail,
        })
    categories = [{"name": k, "sources": v} for k, v in cats.items()]
    obj, raw = await _llm_json(
        "You are a Databricks data architect. Return STRICT JSON: {\"narrative\": \"<2 short paragraphs>\"}.",
        f"{_profile_line(a)}\nThe utility has {in_scope} of {total} data sources already available. "
        "Write a concise data-ingestion strategy: what to land first to unlock the roadmap, and the "
        "sequencing logic. No markdown headers.")
    narrative = (obj or {}).get("narrative") if isinstance(obj, dict) else None
    if not narrative:
        narrative = (raw.strip() if raw else
                     f"You already have {in_scope} of {total} data sources available. Prioritize landing and "
                     "governing the sources that unblock the most high-value use cases first, then expand "
                     "coverage domain by domain.")
    return {"narrative": narrative, "categories": categories,
            "totalSources": total, "alreadyInScope": in_scope, "needToIngest": total - in_scope}


# ---------------------------------------------------------------------------
# 4. Strategic roadmap narrative (LLM prose around a client-built schedule)
# ---------------------------------------------------------------------------
@router.post("/strategic-roadmap/narrative",
             dependencies=[Depends(limiter("research"))])
async def roadmap_narrative(request: Request):
    payload = {}
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        payload = {}
    horizon = payload.get("horizonYears") or payload.get("horizon") or 3
    obj, raw = await _llm_json(
        "You narrate a Data & AI strategic roadmap for a utility. Return STRICT JSON: "
        "{\"narrative\": \"<2-3 paragraphs explaining the phase transitions and why>\"}.",
        f"Roadmap horizon: {horizon} years. Schedule/context: {json.dumps(payload)[:4000]}.\n"
        "Explain the sequencing, the capability each phase unlocks, and the value trajectory. No markdown headers.")
    narrative = (obj or {}).get("narrative") if isinstance(obj, dict) else None
    if not narrative:
        narrative = (raw.strip() if raw else
                     "This roadmap sequences foundational data work first, then higher-value analytics and AI "
                     "as the data platform matures — each phase unlocks the prerequisites for the next.")
    return {"narrative": narrative, "model": SERVING_ENDPOINT,
            "horizonYears": int(horizon) if str(horizon).isdigit() else 3}


# ---------------------------------------------------------------------------
# 5. Pre-submit consistency check
# ---------------------------------------------------------------------------
class ConsistencyIn(BaseModel):
    answers: dict = {}


@router.post("/assessments/consistency-check",
             dependencies=[Depends(limiter("research"))])
async def consistency_check(body: ConsistencyIn, request: Request):
    obj, _ = await _llm_json(
        "You audit a utility's Data & AI maturity assessment answers for internal contradictions "
        "(e.g., claims advanced AI in production but no governed data platform). Return STRICT JSON: "
        "{\"issues\": [{\"id\":str,\"severity\":\"warn|info|error\",\"title\":str,\"description\":str,"
        "\"suggestedFix\":str,\"stepIndex\":int}]}. Return an empty list if the answers are consistent.",
        f"Assessment answers: {json.dumps(body.answers)[:6000]}")
    issues = obj.get("issues") if isinstance(obj, dict) else None
    if not isinstance(issues, list):
        issues = []
    clean = []
    for it in issues[:20]:
        if not isinstance(it, dict):
            continue
        sev = it.get("severity") if it.get("severity") in ("warn", "info", "error") else "info"
        clean.append({
            "id": str(it.get("id") or len(clean)),
            "severity": sev,
            "title": str(it.get("title") or "Possible inconsistency"),
            "description": str(it.get("description") or ""),
            "suggestedFix": str(it.get("suggestedFix") or ""),
            "stepIndex": int(it.get("stepIndex") or 0) if str(it.get("stepIndex") or "").strip().lstrip("-").isdigit() else 0,
        })
    return {"issues": clean}


# ---------------------------------------------------------------------------
# 6. Document exports — POC scope (.docx) + strategic roadmap deck (.pptx)
# ---------------------------------------------------------------------------
async def _llm_text(system: str, user: str) -> str:
    try:
        return await llm.chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}]) or ""
    except Exception as exc:  # noqa: BLE001
        logger.info("LLM text call failed (%s)", type(exc).__name__)
        return ""


@router.post("/poc-scope/generate", dependencies=[Depends(limiter("research"))])
async def poc_scope_generate(request: Request):
    """Generate a POC Statement of Work as a .docx. Body: {useCase:{title,description,...},
    customerName?}. Falls back to 503 if python-docx isn't installed."""
    try:
        import docx  # python-docx
    except Exception:  # noqa: BLE001
        raise HTTPException(503, "Document export isn't available (python-docx not installed).")
    payload = {}
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        payload = {}
    uc = payload.get("useCase") or payload.get("use_case") or {}
    customer = payload.get("customerName") or payload.get("customer") or "the customer"
    title = uc.get("title") or uc.get("name") or "Use Case"
    body_md = await _llm_text(
        "You write a concise proof-of-concept Statement of Work for a Databricks + utility "
        "engagement. Sections: Objective, Scope, Success Criteria, Data Requirements, "
        "Milestones (4-6 weeks), Roles, Out of Scope. Plain prose, no markdown symbols.",
        f"Customer: {customer}. Use case: {title}. Details: {json.dumps(uc)[:3000]}")
    doc = docx.Document()
    doc.add_heading(f"Proof of Concept — {title}", level=0)
    doc.add_paragraph(f"Customer: {customer}")
    for para in (body_md or "Objective: Deliver a working proof of concept.").split("\n"):
        para = para.strip()
        if not para:
            continue
        # a short line ending with ':' becomes a heading
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


@router.post("/strategic-roadmap/deck", dependencies=[Depends(limiter("research"))])
async def strategic_roadmap_deck(request: Request):
    """Generate a strategic-roadmap PowerPoint (.pptx). Body: the client-built schedule/
    context. Falls back to 503 if python-pptx isn't installed."""
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt
    except Exception:  # noqa: BLE001
        raise HTTPException(503, "Deck export isn't available (python-pptx not installed).")
    payload = {}
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        payload = {}
    customer = payload.get("customerName") or payload.get("customer") or "Utility"
    phases = payload.get("phases") or payload.get("schedule") or []
    narrative = await _llm_text(
        "You are drafting speaker notes for a utility Data & AI roadmap deck. One tight "
        "paragraph per phase. Plain prose.",
        f"Customer: {customer}. Roadmap: {json.dumps(payload)[:3500]}")
    prs = Presentation()
    title_slide = prs.slides.add_slide(prs.slide_layouts[0])
    title_slide.shapes.title.text = f"{customer} — Data & AI Strategic Roadmap"
    if title_slide.placeholders and len(title_slide.placeholders) > 1:
        title_slide.placeholders[1].text = "Generated by Grid Compass"
    # one content slide per phase (or a single overview slide)
    items = phases if isinstance(phases, list) and phases else [{"name": "Roadmap", "useCases": []}]
    for i, ph in enumerate(items[:8], 1):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        pname = (ph.get("name") if isinstance(ph, dict) else None) or f"Phase {i}"
        slide.shapes.title.text = pname
        tf = slide.placeholders[1].text_frame
        ucs = (ph.get("useCases") or ph.get("use_cases") or []) if isinstance(ph, dict) else []
        if ucs:
            tf.text = str(ucs[0].get("title") if isinstance(ucs[0], dict) else ucs[0])
            for uc in ucs[1:8]:
                p = tf.add_paragraph()
                p.text = str(uc.get("title") if isinstance(uc, dict) else uc)
        else:
            tf.text = "See roadmap detail in the app."
    notes_slide = prs.slides.add_slide(prs.slide_layouts[5])
    notes_slide.shapes.title.text = "Narrative"
    box = notes_slide.shapes.add_textbox(Inches(0.5), Inches(1.5), Inches(9), Inches(5))
    box.text_frame.text = (narrative or "This roadmap sequences foundational data work first.")[:3000]
    for p in box.text_frame.paragraphs:
        for run in p.runs:
            run.font.size = Pt(12)
    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": 'attachment; filename="strategic-roadmap.pptx"'})


# ---------------------------------------------------------------------------
# 8. Assessment results deck (.pptx) — the "PowerPoint" download on the results page
# ---------------------------------------------------------------------------
@router.get("/assessments/{aid}/pptx")
async def assessment_pptx(aid: str, request: Request):
    """Render a submitted assessment's results as a PowerPoint (title, maturity score/
    phase, dimension scores, top recommendations). GET so it can be a plain download
    link. Falls back to 503 if python-pptx isn't installed."""
    try:
        from pptx import Presentation
    except Exception:  # noqa: BLE001
        raise HTTPException(503, "Deck export isn't available (python-pptx not installed).")
    a = await _load_assessment(aid)
    r = a.get("results_json") or {}
    p = (a.get("answers_json") or {}).get("profile", {})
    name = p.get("companyName") or a.get("label") or "Assessment"
    prs = Presentation()
    s0 = prs.slides.add_slide(prs.slide_layouts[0])
    s0.shapes.title.text = f"{name} — Data & AI Maturity"
    if len(s0.placeholders) > 1:
        s0.placeholders[1].text = (f"Phase {r.get('currentPhase', a.get('current_phase'))} "
                                   f"({r.get('phaseName','')}) · Score "
                                   f"{r.get('overallScore', a.get('overall_score'))}/100")
    # dimension scores
    s1 = prs.slides.add_slide(prs.slide_layouts[1])
    s1.shapes.title.text = "Maturity by dimension"
    dims = r.get("dimensionScores") or {}
    tf = s1.placeholders[1].text_frame
    lines = [f"{k}: {v}/100" for k, v in dims.items()]
    tf.text = lines[0] if lines else "See the app for detail."
    for ln in lines[1:]:
        tf.add_paragraph().text = ln
    # recommendations
    s2 = prs.slides.add_slide(prs.slide_layouts[1])
    s2.shapes.title.text = "Recommended first moves"
    recs = r.get("recommendations") or []
    tf2 = s2.placeholders[1].text_frame
    titles = []
    for rc in recs[:8]:
        uc = rc.get("useCase") or rc
        t = uc.get("title") or uc.get("name")
        if t:
            titles.append(t)
    tf2.text = titles[0] if titles else "Run the assessment to see recommendations."
    for t in titles[1:]:
        tf2.add_paragraph().text = t
    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    fname = f"{str(name).lower().replace(' ', '-')[:40]}-maturity.pptx"
    return StreamingResponse(
        buf, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'})
