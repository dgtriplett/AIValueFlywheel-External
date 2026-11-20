"""AITR deck -> roadmap package. Lets a business unit upload the AI Transformation
Roadmap deck (the single .html file) straight into Operate > Roadmap > Import.

    package = deck_to_package(html_text, file_name="example-aitr-v1.html")

The deck is a self-contained page whose data lives in `const NAME = {...};` JSON
literals; this reads those literals as data (nothing in the page is executed) and
returns a package in the `aivr.roadmap` v1 format (ROADMAP_PACKAGE.md), which then
goes through the same validation, matching and review as any other package.

Only what a business unit needs to run its roadmap is taken, from an allow-list:
pillars, value-chain stages, workstreams, datasets, and per use case its description,
KPI, priority, effort, data needs, first-version plan and the gross annual value to
the organization. Everything else in the deck is ignored, including any partner
value-attribution model, team/staffing lanes, references, and tiles describing work
already in flight in other systems. `_clean()` drops any sentence that mentions
attribution, and `check_customer_safe()` refuses the result if anything of that kind
slipped through. The uploaded HTML itself is never stored: only the package is.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

FORMAT, FORMAT_VERSION = "aivr.roadmap", 1
GENERATOR = {"name": "AI Transformation Roadmap", "version": "deck import 1"}

_EFFORT = {"low": "S", "medium": "M", "high": "L", "very high": "XL"}

# Sentences/clauses containing any of these never leave the building.
_UNSAFE = re.compile(
    r"(?i)(attribut|\bBVA\b|databricks[- ]attributable|credited to data and ai|"
    r"salesforce|\bUCOs?\b|\bDBUs?\b|account team|🔒|go/[a-z])")
# A final check over the whole package: these must not appear anywhere.
_FORBIDDEN = re.compile(
    r"(?i)(attribut|\bBVA\b|databricks[- ]attributable|salesforce|\bUCOs?\b|"
    r"\bDBUs?\b|🔒|kb_[a-z0-9_]+|\bgo/[a-z])")


class UnsafeContent(ValueError):
    pass


# ---------------------------------------------------------------------------
# reading the deck
# ---------------------------------------------------------------------------
def _const(html: str, name: str, default=None):
    """The JSON literal assigned to `const NAME =` in the deck, or `default`."""
    m = re.search(r"const\s+" + re.escape(name) + r"\s*=\s*", html)
    if not m:
        return default
    try:
        return json.JSONDecoder().raw_decode(html[m.end():])[0]
    except ValueError:
        return default


def _str_const(html: str, name: str) -> str | None:
    m = re.search(r"const\s+" + re.escape(name) + r"\s*=\s*\"((?:[^\"\\]|\\.)*)\"", html)
    return json.loads(f'"{m.group(1)}"') if m else None


# ---------------------------------------------------------------------------
# cleaning
# ---------------------------------------------------------------------------
def _clean(text: str | None) -> str | None:
    """Drop every sentence (and, inside a kept sentence, every comma clause) that
    mentions attribution or other internal-only basis. None if nothing is left."""
    if not text or not isinstance(text, str):
        return None
    out_paras = []
    for para in re.split(r"\n\s*\n", text):
        kept = []
        for sent in re.split(r"(?<=[.!?])\s+", para.strip()):
            if not sent:
                continue
            if _UNSAFE.search(sent):
                # Keep the safe LEADING clauses of a list-like sentence ("share 40%,
                # margin 88%, primary attribution 50%." -> "share 40%, margin 88%.");
                # a sentence that starts unsafe is dropped whole, so no fragment of
                # it survives ("..., while the fleet keeps growing.").
                prefix = []
                for clause in re.split(r",\s+|;\s+", sent):
                    if _UNSAFE.search(clause):
                        break
                    prefix.append(clause)
                if not prefix:
                    continue
                sent = ", ".join(prefix).rstrip(",;. ") + "."
            kept.append(sent)
        if kept:
            out_paras.append(" ".join(kept))
    s = "\n\n".join(out_paras).strip()
    return s or None


def _clean_formula(formula: str | None) -> str | None:
    if not formula:
        return None
    parts = [p.strip() for p in re.split(r"\s+[x×]\s+", formula)]
    parts = [p for p in parts if p and not _UNSAFE.search(p)]
    return " × ".join(parts) or None


def _public_source(src) -> str | None:
    if not isinstance(src, str) or not src.strip():
        return None
    s = src.strip()
    if re.fullmatch(r"[a-z0-9_]+", s) or _UNSAFE.search(s) or re.search(r"(?i)databricks", s):
        # An internal reference id, internal basis, or a vendor-internal knowledge
        # source the organization cannot look up: not a citation worth passing on.
        return None
    return s[:300]


# ---------------------------------------------------------------------------
# value: gross, never attributed (mirrors the deck's bvaStreamValue / bvaGross)
# ---------------------------------------------------------------------------
def _stream_value(stream: dict, scen: str) -> float:
    v = float(((stream.get("base") or {}).get("val")) or 0)
    for d in stream.get("drivers") or []:
        if _UNSAFE.search(str(d.get("label") or "")):
            # Attribution belongs in sizing["attribution"], which is never read; a
            # deck that also models it as a driver must not shrink the gross value.
            continue
        x = d.get(scen) if d.get(scen) is not None else d.get("base")
        x = float(x or 0)
        v *= x / 100 if d.get("fmt") == "pct" else x
    return v


def _gross(sizing: dict | None, scen: str) -> float:
    if not sizing:
        return 0.0
    return sum(_stream_value(s, scen) for s in sizing.get("streams") or [])


def _value(uc_id: str, sizing_all: dict, assumptions_text: dict) -> dict | None:
    sz = (sizing_all or {}).get(uc_id)
    if not sz:
        return None
    low, base, high = (_gross(sz, s) for s in ("low", "base", "high"))
    if base <= 0:
        return None
    low, base, high = sorted((low, base, high))
    drivers = []
    for st in sz.get("streams") or []:
        b = st.get("base") or {}
        if b.get("label") and not _UNSAFE.search(b["label"]):
            drivers.append({"label": _clean(b["label"]), "base": b.get("val"),
                            "unit": "USD" if b.get("fmt") == "usd" else b.get("fmt"),
                            "note": _clean(b.get("note")), "source": _public_source(b.get("src"))})
        for d in st.get("drivers") or []:
            if not d.get("label") or _UNSAFE.search(d["label"]):
                continue
            drivers.append({"label": _clean(d["label"]), "low": d.get("low"), "base": d.get("base"),
                            "high": d.get("high"), "unit": "%" if d.get("fmt") == "pct" else d.get("fmt"),
                            "note": _clean(d.get("note")), "source": _public_source(d.get("src"))})
    va = (assumptions_text or {}).get(uc_id) or {}
    basis = " ".join(filter(None, [_clean(va.get("baseline")), _clean(va.get("impact"))])) or None
    return {"annual_low": round(low), "annual_base": round(base), "annual_high": round(high),
            "basis": basis, "formula": _clean_formula(sz.get("formula")),
            "assumptions": [d for d in drivers if d["label"]][:30]}


# ---------------------------------------------------------------------------
# plan
# ---------------------------------------------------------------------------
def _plan(p: dict | None) -> dict | None:
    if not p:
        return None
    phases = []
    for ph in (p.get("phases") or [])[:8]:
        steps = [_clean(b) for b in ph.get("bullets") or []]
        phases.append({"name": _clean(ph.get("tag")), "when": _clean(ph.get("when")),
                       "title": _clean(ph.get("title")), "summary": _clean(ph.get("text")),
                       "scope": _clean(ph.get("scope")), "steps": [s for s in steps if s]})
    out = {"headline": _clean(p.get("p1head")), "pilot": _clean(p.get("pilot")), "phases": phases}
    return out if (phases or out["headline"] or out["pilot"]) else None


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------
def list_business_units(html: str) -> list[dict]:
    base = _const(html, "BASELINE", {}) or {}
    return [{"id": b.get("id"), "name": b.get("name")} for b in base.get("BUS") or []]


def looks_like_deck(html: str) -> bool:
    return isinstance(html, str) and "const BASELINE" in html and "useCases" in html


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:80] or "roadmap"


def deck_to_package(html: str, *, file_name: str | None = None, industry: str | None = None,
                    bu: str | None = None, generated_at: str | None = None) -> dict:
    """The deck as a roadmap package. The roadmap id comes from the organization's
    name, so every later version of the same organization's deck lines up with the
    earlier import; the version is read from a `-vN` in the file name when present."""
    org = _str_const(html, "PLAN_CUST_FULL") or _str_const(html, "PLAN_CUST")
    m = re.search(r"(?i)[-_ ]v(\d+)(?:[-_.]|$)", file_name or "")
    d = re.search(r"(\d{4}-\d{2}-\d{2})", file_name or "")
    version = m.group(1) if m else (d.group(1) if d else None)
    return export_package(html, slug=_slug(org or "roadmap"), version=version,
                          industry=industry, bu=bu, generated_at=generated_at)


def export_package(html: str, *, slug: str, version: str | None = None,
                   industry: str | None = None, bu: str | None = None,
                   generated_at: str | None = None) -> dict:
    """Build the package. `bu`: a business-unit id from the deck's BU views; the
    package then carries that BU's pillars and the use cases tagged to it, so each
    business unit can be imported into its own AIVR business unit."""
    base = _const(html, "BASELINE")
    if not isinstance(base, dict) or not base.get("useCases"):
        raise ValueError("This does not look like an AI Transformation Roadmap deck (no use-case data found).")
    sizing = _const(html, "BVA_SIZING", {}) or {}
    plans = _const(html, "PLAN_CONTENT", {}) or {}
    detail = _const(html, "USECASE_DETAIL", {}) or {}
    va_text = _const(html, "VALUE_ASSUMPTIONS", {}) or {}
    effort_r = _const(html, "EFFORT_RATIONALES", {}) or {}
    stage_map = _const(html, "STAGE_MAP", {}) or {}
    chain = _const(html, "VALUE_CHAIN", []) or []
    plays = _const(html, "PLAYS", {}) or {}
    cats = _const(html, "DATA_CATEGORIES", []) or []
    buckets = _const(html, "DATA_BUCKETS", []) or []
    needs = _const(html, "UC_DATA_NEEDS", {}) or {}
    reqs = _const(html, "DATA_REQUIREMENTS", {}) or {}
    org = _str_const(html, "PLAN_CUST_FULL") or _str_const(html, "PLAN_CUST") or slug

    bus = {b.get("id"): b for b in base.get("BUS") or []}
    if bu is not None and bu not in bus:
        raise ValueError(f"No business-unit view {bu!r} in this deck; it has: {', '.join(bus) or 'none'}")
    if bu is None:
        pillars_src = base.get("ceoPillars") or []
    else:
        pillars_src = [p for p in base.get("buPillars") or [] if p.get("bu") == bu]
    pillar_ids = [p.get("id") for p in pillars_src]

    # Allow-list: named, included, sized-or-planned use cases; never pipeline tiles
    # (live work from internal systems) nor enabler tiles.
    ucs = [u for u in base["useCases"] if u.get("included", True) and not u.get("inPipeline")
           and not u.get("enabler")]
    if bu is not None:
        ucs = [u for u in ucs if set(u.get("bu") or []) & set(pillar_ids)]

    def tier(u):
        if bu is not None:
            return "now" if (u.get("buTop") or {}).get(bu) else "next"
        return "now" if u.get("top8") else "next" if u.get("ceoTop15") else "later"
    order = {"now": 0, "next": 1, "later": 2}
    ucs = sorted(ucs, key=lambda u: order[tier(u)])  # stable: keeps the deck's order inside a tier

    ws_src = (plays.get("ceo") if bu is None else plays.get(bu)) or plays.get("ceo") or []
    ws_of = {}
    for w in ws_src:
        for uid in w.get("ucs") or []:
            ws_of.setdefault(uid, w.get("id"))
    known = {u["id"] for u in ucs}

    use_cases = []
    for rank, u in enumerate(ucs, 1):
        uid = u["id"]
        own = (u.get("bu") if bu is not None else u.get("ceo")) or []
        er = effort_r.get(uid) or {}
        dr = reqs.get(uid) or {}
        use_cases.append({
            "id": uid,
            "name": _clean(u.get("name")) or uid,
            "summary": _clean(u.get("desc")),
            "description": _clean(u.get("longDesc")),
            "business_problem": _clean((detail.get(uid) or {}).get("burningPlatform")),
            "kpi": _clean(u.get("kpi")),
            "pillar_ids": [p for p in own if p in pillar_ids],
            "stage_id": stage_map.get(uid),
            "workstream_id": ws_of.get(uid),
            "priority_rank": rank,
            "priority_tier": tier(u),
            "effort": _EFFORT.get(str(u.get("effort") or "").lower()),
            "effort_quadrant": _clean(er.get("quadrant")),
            "effort_rationale": _clean(er.get("reason")),
            "dataset_ids": list((needs.get(uid) or {}).get("buckets") or []),
            "data_requirements": {"assets": [a for a in map(_clean, dr.get("assets") or []) if a],
                                  "sources": [s for s in map(_clean, dr.get("sources") or []) if s],
                                  "rationale": _clean(dr.get("rationale"))},
            "value": _value(uid, sizing, va_text),
            "plan": _plan(plans.get(uid)),
        })

    used_buckets = {b for u in use_cases for b in u["dataset_ids"]}
    package = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "generated_at": generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "generator": GENERATOR,
        "roadmap": {
            "id": slug if bu is None else f"{slug}--{bu}",
            "version": str(version) if version is not None else None,
            "title": f"{org}: Data & AI Roadmap" + (f" ({bus[bu].get('name')})" if bu else ""),
            "organization": org,
            "business_unit": bus[bu].get("name") if bu else None,
            "industry": industry,
            "currency": "USD",
        },
        "pillars": [{"id": p.get("id"), "name": _clean(p.get("name")),
                     "description": _clean(p.get("desc"))} for p in pillars_src],
        "stages": [{"id": s.get("id"), "name": _clean(s.get("name")),
                    "description": _clean(s.get("tagline"))} for s in chain],
        "workstreams": [{"id": w.get("id"), "name": _clean(w.get("name")),
                         "description": _clean(w.get("blurb") or w.get("desc")),
                         "use_case_ids": [x for x in w.get("ucs") or [] if x in known]} for w in ws_src],
        "data_categories": [{"id": c.get("id"), "name": _clean(c.get("name")),
                             "description": _clean(c.get("tagline"))} for c in cats],
        "datasets": [{"id": b.get("id"), "category_id": b.get("category"), "name": _clean(b.get("name")),
                      "description": _clean(b.get("desc"))} for b in buckets if b.get("id") in used_buckets],
        "use_cases": use_cases,
    }
    check_customer_safe(package)
    return package


def check_customer_safe(package: dict) -> None:
    """Raise UnsafeContent if anything internal-only reached the package."""
    hits = sorted({m.group(0) for m in _FORBIDDEN.finditer(json.dumps(package, ensure_ascii=False))})
    if hits:
        raise UnsafeContent(f"Internal-only content in the package: {', '.join(hits[:10])}")
