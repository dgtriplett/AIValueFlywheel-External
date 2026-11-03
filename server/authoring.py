"""Use-case authoring agent — pure logic (no I/O).

A person adds ONE use case by hand (title + a few sentences); the agent maps it
into the catalog the same way the shipped use cases are mapped:

  * house-style title/description, category, sub-vertical, effort
  * line of business
  * required / helpful data domains
  * required / helpful data assets (modules)
  * prerequisites (use cases it builds on) and use cases it enables
  * a parameterized value model (built separately by agents.build_value_model)

The model only ever sees — and may only return — ids from the catalog it was
given. `validate_proposal` enforces that, drops anything else with a warning,
and `drop_cycle_edges` refuses dependency edges that would create a cycle
(phase is derived from the enables graph, so a cycle would make phase undefined).

Kept free of the database so every rule is unit-testable; routes/authoring.py
loads the catalog, calls the LLM, and performs the confirmed write.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict

EFFORT_VALUES = ("S", "M", "L", "XL")
SUB_VERTICALS = ("fossil", "hydro", "renewables", "nuclear", "cross")
CRITICALITY = ("required", "helpful")

MAX_ASSETS = 10
MAX_DOMAINS = 8
MAX_EDGES = 8

RESPONSE_SCHEMA = {
    "name": "authored_use_case",
    "schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "category": {"type": "string"},
            "sub_vertical": {"type": "string", "enum": list(SUB_VERTICALS)},
            "effort_tshirt": {"type": "string", "enum": list(EFFORT_VALUES)},
            "lob_id": {"type": "integer"},
            "domains": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string"},
                "necessity": {"type": "string", "enum": list(CRITICALITY)},
                "rationale": {"type": "string"}},
                "required": ["name", "necessity", "rationale"]}},
            "data_assets": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "integer"},
                "criticality": {"type": "string", "enum": list(CRITICALITY)},
                "rationale": {"type": "string"}},
                "required": ["id", "criticality", "rationale"]}},
            "prerequisites": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "integer"}, "rationale": {"type": "string"}},
                "required": ["id", "rationale"]}},
            "enables": {"type": "array", "items": {"type": "object", "properties": {
                "id": {"type": "integer"}, "rationale": {"type": "string"}},
                "required": ["id", "rationale"]}},
            "notes": {"type": "string"},
        },
        "required": ["title", "description", "lob_id", "domains", "data_assets",
                     "prerequisites", "enables"],
    },
    "strict": False,
}


def _line(*parts) -> str:
    return " | ".join(str(p) for p in parts if p not in (None, ""))


def build_prompt(draft: dict, *, lobs: list[dict], domains: list[dict],
                 assets: list[dict], use_cases: list[dict]) -> str:
    """One grounded call: the full catalog as compact id-keyed lines."""
    lob_lines = "\n".join(_line(lob["id"], lob["name"]) for lob in lobs)
    domain_lines = "\n".join(_line(d["name"], d.get("label"), d.get("category")) for d in domains)
    asset_lines = "\n".join(
        _line(a["id"], a.get("source_category") or a.get("source_system"), a["module"],
              (a.get("description") or "")[:90]) for a in assets)
    uc_lines = "\n".join(
        _line(u["id"], u["title"], f"phase {u['phase']}" if u.get("phase") is not None else None)
        for u in use_cases if u.get("id") != draft.get("use_case_id"))
    lob_hint = (f"The author placed it in line of business id {draft['lob_id']}; keep that "
                "unless it is clearly wrong.") if draft.get("lob_id") else \
        "Pick the line of business it belongs to."
    return f"""You are a data & AI architect mapping ONE new use case into an existing
Power & Utilities use-case catalog. Map it exactly the way the catalog's own use
cases are mapped. Use ONLY ids / names from the lists below — never invent one.

NEW USE CASE
Title: {draft.get('title') or ''}
Description: {draft.get('description') or ''}
Author notes: {draft.get('notes') or '(none)'}
{lob_hint}

LINES OF BUSINESS (id | name)
{lob_lines}

DATA DOMAINS (name | label | category)
{domain_lines}

DATA ASSETS (id | source | module | description)
{asset_lines}

EXISTING USE CASES (id | title | phase)
{uc_lines}

Return STRICT JSON with:
- title: concise, title-cased, in the catalog's style (keep the author's meaning)
- description: 1-3 sentences, what it does and the business outcome
- category: short category label; sub_vertical: one of {', '.join(SUB_VERTICALS)}
- effort_tshirt: one of {', '.join(EFFORT_VALUES)}
- lob_id: from the list
- domains: up to {MAX_DOMAINS} {{name, necessity: required|helpful, rationale}}
- data_assets: up to {MAX_ASSETS} {{id, criticality: required|helpful, rationale}} —
  "required" only if the use case cannot work without it
- prerequisites: up to {MAX_EDGES} {{id, rationale}} existing use cases this one BUILDS ON
  (their data/models must exist first)
- enables: up to {MAX_EDGES} {{id, rationale}} existing use cases that become easier
  or possible once this one is live
- notes: anything the reviewer should double-check
Each rationale is one short sentence a reviewer can verify."""


def _as_int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _clean_text(v, limit: int) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:limit]


def validate_proposal(raw: dict | None, draft: dict, *, lob_ids: set[int],
                      domain_names: set[str], asset_ids: set[int],
                      use_case_ids: set[int]) -> tuple[dict, list[str]]:
    """Coerce model (or user-edited) output into a safe proposal.

    Never trusts an id: anything not in the catalog is dropped and reported, so
    the reviewer sees what the agent tried and the write can't fail on an FK.
    """
    raw = raw if isinstance(raw, dict) else {}
    warnings: list[str] = []
    self_id = draft.get("use_case_id")

    title = _clean_text(raw.get("title"), 200) or _clean_text(draft.get("title"), 200)
    lob_id = _as_int(raw.get("lob_id")) or _as_int(draft.get("lob_id"))
    if lob_id is not None and lob_id not in lob_ids:
        warnings.append(f"Unknown line of business {lob_id} — left unset.")
        lob_id = None

    def _crit(v) -> str:
        return v if v in CRITICALITY else "required"

    domains, seen = [], set()
    for d in raw.get("domains") or []:
        if not isinstance(d, dict):
            continue
        name = str(d.get("name") or "").strip()
        if name not in domain_names:
            if name:
                warnings.append(f"Domain '{name}' is not in the catalog — dropped.")
            continue
        if name in seen:
            continue
        seen.add(name)
        domains.append({"name": name, "necessity": _crit(d.get("necessity")),
                        "rationale": _clean_text(d.get("rationale"), 300)})

    assets, seen = [], set()
    for a in raw.get("data_assets") or []:
        if not isinstance(a, dict):
            continue
        aid = _as_int(a.get("id"))
        if aid not in asset_ids:
            warnings.append(f"Data asset {a.get('id')} is not in the catalog — dropped.")
            continue
        if aid in seen:
            continue
        seen.add(aid)
        assets.append({"id": aid, "criticality": _crit(a.get("criticality")),
                       "rationale": _clean_text(a.get("rationale"), 300)})

    def _edges(key: str) -> list[dict]:
        out, seen_ids = [], set()
        for e in raw.get(key) or []:
            if not isinstance(e, dict):
                continue
            eid = _as_int(e.get("id"))
            if eid not in use_case_ids or eid == self_id:
                warnings.append(f"{key[:-1].capitalize()} use case {e.get('id')} is not valid — dropped.")
                continue
            if eid in seen_ids:
                continue
            seen_ids.add(eid)
            out.append({"id": eid, "rationale": _clean_text(e.get("rationale"), 300)})
        return out[:MAX_EDGES]

    prerequisites = _edges("prerequisites")
    enables = _edges("enables")
    both = {e["id"] for e in prerequisites} & {e["id"] for e in enables}
    if both:
        warnings.append("A use case can't be both a prerequisite and enabled — kept it as a prerequisite.")
        enables = [e for e in enables if e["id"] not in both]

    proposal = {
        "title": title,
        "description": _clean_text(raw.get("description"), 2000)
                       or _clean_text(draft.get("description"), 2000),
        "category": _clean_text(raw.get("category"), 80) or None,
        "sub_vertical": raw.get("sub_vertical") if raw.get("sub_vertical") in SUB_VERTICALS else "cross",
        "effort_tshirt": raw.get("effort_tshirt") if raw.get("effort_tshirt") in EFFORT_VALUES else "M",
        "lob_id": lob_id,
        "domains": domains[:MAX_DOMAINS],
        "data_assets": assets[:MAX_ASSETS],
        "prerequisites": prerequisites,
        "enables": enables,
        "notes": _clean_text(raw.get("notes"), 1000),
    }
    if raw.get("value_model") is not None:
        proposal["value_model"] = raw["value_model"]
    if not proposal["title"]:
        warnings.append("A title is required.")
    return proposal, warnings


def _reachable(graph: dict[int, set[int]], start: int) -> set[int]:
    seen, stack = set(), [start]
    while stack:
        n = stack.pop()
        for m in graph.get(n, ()):
            if m not in seen:
                seen.add(m)
                stack.append(m)
    return seen


def drop_cycle_edges(proposal: dict, existing_edges: list[tuple[int, int]],
                     node_id: int = -1) -> list[str]:
    """Remove proposed edges that would close a cycle in the enables graph.

    Edges are from -> to ("from enables to"). The new use case is `node_id`
    (-1 before it exists). Prerequisite p adds p -> node; enables e adds node -> e.
    Existing edges touching node_id (a re-map) are ignored — they get replaced.
    Mutates `proposal`; returns warnings.
    """
    graph: dict[int, set[int]] = defaultdict(set)
    for f, t in existing_edges:
        if node_id in (f, t):
            continue
        graph[f].add(t)
    warnings: list[str] = []
    kept_pre = []
    for p in proposal.get("prerequisites", []):
        graph[p["id"]].add(node_id)
        kept_pre.append(p)
    kept_en = []
    for e in proposal.get("enables", []):
        # node -> e closes a cycle iff node is reachable from e.
        if node_id in _reachable(graph, e["id"]):
            warnings.append(f"Dropped 'enables {e['id']}': it would create a dependency cycle.")
            continue
        graph[node_id].add(e["id"])
        kept_en.append(e)
    proposal["prerequisites"], proposal["enables"] = kept_pre, kept_en
    return warnings


def heuristic_proposal(draft: dict, *, domains: list[dict], assets: list[dict]) -> dict:
    """Deterministic fallback when the model is unavailable: keyword overlap.

    Deliberately conservative (helpful-only beyond the top matches, no edges) —
    the reviewer is told the agent was unavailable and should map by hand.
    """
    text = f"{draft.get('title') or ''} {draft.get('description') or ''}".lower()
    words = {w for w in re.findall(r"[a-z]{4,}", text)}

    def score(s: str) -> int:
        return sum(1 for w in set(re.findall(r"[a-z]{4,}", s.lower())) if w in words)

    ranked_assets = sorted(
        ((score(f"{a.get('source_category') or ''} {a['module']} {a.get('description') or ''}"), a)
         for a in assets), key=lambda x: -x[0])
    ranked_domains = sorted(
        ((score(f"{d['name'].replace('_', ' ')} {d.get('label') or ''} {d.get('description') or ''}"), d)
         for d in domains), key=lambda x: -x[0])
    return {
        "title": draft.get("title"), "description": draft.get("description"),
        "lob_id": draft.get("lob_id"),
        "domains": [{"name": d["name"], "necessity": "required" if i < 2 else "helpful",
                     "rationale": "Keyword match (AI unavailable)."}
                    for i, (s, d) in enumerate(ranked_domains[:4]) if s],
        "data_assets": [{"id": a["id"], "criticality": "required" if i < 2 else "helpful",
                         "rationale": "Keyword match (AI unavailable)."}
                        for i, (s, a) in enumerate(ranked_assets[:6]) if s],
        "prerequisites": [], "enables": [],
        "notes": "The AI agent was unavailable; these are keyword matches. Review carefully.",
    }


def summarize(proposal: dict) -> str:
    return (f"{len(proposal.get('data_assets', []))} data assets, "
            f"{len(proposal.get('domains', []))} domains, "
            f"{len(proposal.get('prerequisites', []))} prerequisites, "
            f"{len(proposal.get('enables', []))} enabled use cases")


def dumps(v) -> str:
    return json.dumps(v, default=str)
