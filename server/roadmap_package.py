"""Roadmap package (format `aivr.roadmap`, version 1): validate, normalize, match, diff.

A roadmap package is how a planning tool hands a business unit's Data & AI roadmap to
this app. The format is documented in ROADMAP_PACKAGE.md and described by
reference/roadmap-package.schema.json; reference/example-roadmap-package.json is a
complete example.

Everything here is pure (no database, no network) so it can be tested exhaustively:

    normalize(package)            -> (Normalized, errors, warnings)
    match(use_cases, catalog)     -> per use case, ranked catalog candidates + a suggestion
    diff(previous, current)       -> added / removed / changed use cases between versions
    value_formula(value)          -> a value_engine formula carrying the roadmap estimate

The import route (server/routes/roadmap_import.py) does the database work.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

FORMAT = "aivr.roadmap"
SUPPORTED_VERSIONS = (1,)

# Bounds. A package is user-supplied input: cap everything so a malformed or hostile
# file cannot balloon the database or the review screen.
MAX_USE_CASES = 500
MAX_PILLARS = 20
MAX_LIST = 100
MAX_TEXT = 4000
MAX_SHORT = 300

EFFORTS = ("S", "M", "L", "XL")
_EFFORT_ALIASES = {
    "s": "S", "small": "S", "low": "S", "quick": "S",
    "m": "M", "medium": "M", "med": "M", "moderate": "M",
    "l": "L", "large": "L", "high": "L",
    "xl": "XL", "x-large": "XL", "very high": "XL", "very large": "XL",
}
TIERS = ("now", "next", "later")

_ID_RE = re.compile(r"[^A-Za-z0-9_.:-]+")


@dataclass
class Normalized:
    """A validated package, every field present and bounded."""
    format_version: int
    generator: dict
    roadmap: dict
    pillars: list[dict] = field(default_factory=list)
    stages: list[dict] = field(default_factory=list)
    workstreams: list[dict] = field(default_factory=list)
    data_categories: list[dict] = field(default_factory=list)
    datasets: list[dict] = field(default_factory=list)
    use_cases: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "format": FORMAT, "format_version": self.format_version,
            "generator": self.generator, "roadmap": self.roadmap,
            "pillars": self.pillars, "stages": self.stages, "workstreams": self.workstreams,
            "data_categories": self.data_categories, "datasets": self.datasets,
            "use_cases": self.use_cases,
        }


# ---------------------------------------------------------------------------
# small coercions
# ---------------------------------------------------------------------------
def _text(v: Any, limit: int = MAX_TEXT) -> str | None:
    if v is None:
        return None
    if not isinstance(v, (str, int, float)):
        return None
    s = " ".join(str(v).replace("\r", " ").split()) if limit <= MAX_SHORT else str(v).strip()
    if not s:
        return None
    return s[:limit]


def _id(v: Any) -> str | None:
    s = _text(v, MAX_SHORT)
    if not s:
        return None
    s = _ID_RE.sub("-", s).strip("-")
    return s[:120] or None


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v and abs(v) != float("inf") else None
    if isinstance(v, str):
        try:
            f = float(v.replace(",", "").strip())
        except ValueError:
            return None
        return f if f == f and abs(f) != float("inf") else None
    return None


def _int(v: Any) -> int | None:
    n = _num(v)
    return int(n) if n is not None and n == int(n) else None


def _list(v: Any, limit: int = MAX_LIST) -> list:
    return list(v[:limit]) if isinstance(v, list) else []


def _text_list(v: Any, limit: int = MAX_LIST, each: int = MAX_SHORT) -> list[str]:
    out = []
    for x in _list(v, limit):
        t = _text(x, each)
        if t:
            out.append(t)
    return out


def _id_list(v: Any) -> list[str]:
    out: list[str] = []
    for x in _list(v):
        i = _id(x)
        if i and i not in out:
            out.append(i)
    return out


def effort(v: Any) -> str | None:
    s = _text(v, 40)
    if not s:
        return None
    if s.upper() in EFFORTS:
        return s.upper()
    return _EFFORT_ALIASES.get(s.lower())


def _ref_list(raw: Any, kind: str, errors: list[str], *, extra=()) -> list[dict]:
    """[{id, name, description, ...}] with unique ids; entries without id+name dropped."""
    out, seen = [], set()
    for i, item in enumerate(_list(raw, MAX_LIST)):
        if not isinstance(item, dict):
            errors.append(f"{kind}[{i}] is not an object")
            continue
        iid, name = _id(item.get("id")), _text(item.get("name"), MAX_SHORT)
        if not iid or not name:
            errors.append(f"{kind}[{i}] needs an id and a name")
            continue
        if iid in seen:
            errors.append(f"{kind}: duplicate id {iid!r}")
            continue
        seen.add(iid)
        entry = {"id": iid, "name": name, "description": _text(item.get("description"))}
        for key in extra:
            entry[key] = item.get(key)
        out.append(entry)
    return out


# ---------------------------------------------------------------------------
# normalize
# ---------------------------------------------------------------------------
def normalize(package: Any) -> tuple[Normalized | None, list[str], list[str]]:
    """Validate a package and return it in canonical form.

    `errors` make the package unusable (nothing is imported); `warnings` are worth
    showing to the person importing but do not block (an unknown pillar id on one use
    case, a value range given out of order, ...)."""
    errors: list[str] = []
    warnings: list[str] = []
    if not isinstance(package, dict):
        return None, ["The file is not a JSON object."], []
    if package.get("format") != FORMAT:
        return None, [f"Not a roadmap package: expected \"format\": \"{FORMAT}\"."], []
    version = _int(package.get("format_version"))
    if version not in SUPPORTED_VERSIONS:
        return None, [f"Unsupported format_version {package.get('format_version')!r}; "
                      f"this app reads {', '.join(map(str, SUPPORTED_VERSIONS))}."], []

    rm = package.get("roadmap") if isinstance(package.get("roadmap"), dict) else {}
    roadmap = {
        "id": _id(rm.get("id")),
        "version": _text(rm.get("version"), 60),
        "title": _text(rm.get("title"), MAX_SHORT),
        "organization": _text(rm.get("organization"), MAX_SHORT),
        "industry": _text(rm.get("industry"), 60),
        "target_executive": _text(rm.get("target_executive"), 80),
        "currency": (_text(rm.get("currency"), 3) or "USD").upper(),
        "business_unit": _text(rm.get("business_unit"), MAX_SHORT),
    }
    if not roadmap["id"]:
        errors.append("roadmap.id is required (a stable id that stays the same across versions).")
    gen = package.get("generator") if isinstance(package.get("generator"), dict) else {}
    generator = {"name": _text(gen.get("name"), 120) or "unknown", "version": _text(gen.get("version"), 60)}

    pillars = _ref_list(package.get("pillars"), "pillars", errors)[:MAX_PILLARS]
    stages = _ref_list(package.get("stages"), "stages", errors)
    workstreams = _ref_list(package.get("workstreams"), "workstreams", errors)
    data_categories = _ref_list(package.get("data_categories"), "data_categories", errors)
    datasets = _ref_list(package.get("datasets"), "datasets", errors, extra=("category_id",))
    for d in datasets:
        d["category_id"] = _id(d.get("category_id"))

    pillar_ids = {p["id"] for p in pillars}
    stage_ids = {s["id"] for s in stages}
    ws_ids = {w["id"] for w in workstreams}
    ds_ids = {d["id"] for d in datasets}

    raw_ucs = package.get("use_cases")
    if not isinstance(raw_ucs, list) or not raw_ucs:
        errors.append("use_cases must be a non-empty list.")
        raw_ucs = []
    if len(raw_ucs) > MAX_USE_CASES:
        errors.append(f"{len(raw_ucs)} use cases; the limit is {MAX_USE_CASES}.")
        raw_ucs = raw_ucs[:MAX_USE_CASES]

    use_cases, seen = [], set()
    for i, raw in enumerate(raw_ucs):
        if not isinstance(raw, dict):
            errors.append(f"use_cases[{i}] is not an object")
            continue
        uid, name = _id(raw.get("id")), _text(raw.get("name"), MAX_SHORT)
        if not uid or not name:
            errors.append(f"use_cases[{i}] needs an id and a name")
            continue
        if uid in seen:
            errors.append(f"use_cases: duplicate id {uid!r}")
            continue
        seen.add(uid)
        label = f"use case {uid!r}"

        pids = _id_list(raw.get("pillar_ids"))
        unknown = [p for p in pids if p not in pillar_ids]
        if unknown:
            warnings.append(f"{label}: unknown pillar id(s) {', '.join(unknown)} ignored")
            pids = [p for p in pids if p in pillar_ids]
        stage = _id(raw.get("stage_id"))
        if stage and stage not in stage_ids:
            warnings.append(f"{label}: unknown stage {stage!r} ignored")
            stage = None
        ws = _id(raw.get("workstream_id"))
        if ws and ws not in ws_ids:
            warnings.append(f"{label}: unknown workstream {ws!r} ignored")
            ws = None
        dsids = _id_list(raw.get("dataset_ids"))
        if [d for d in dsids if d not in ds_ids]:
            warnings.append(f"{label}: unknown dataset id(s) ignored")
            dsids = [d for d in dsids if d in ds_ids]

        tier = _text(raw.get("priority_tier"), 10)
        tier = tier.lower() if tier else None
        if tier and tier not in TIERS:
            warnings.append(f"{label}: priority_tier {tier!r} is not now/next/later; ignored")
            tier = None

        eff_raw = raw.get("effort")
        eff = effort(eff_raw)
        if eff_raw is not None and eff is None:
            warnings.append(f"{label}: effort {eff_raw!r} not recognised (S/M/L/XL); ignored")

        dr = raw.get("data_requirements") if isinstance(raw.get("data_requirements"), dict) else {}
        hint = raw.get("catalog_match") if isinstance(raw.get("catalog_match"), dict) else {}
        use_cases.append({
            "id": uid,
            "name": name,
            "summary": _text(raw.get("summary"), 1000),
            "description": _text(raw.get("description")),
            "business_problem": _text(raw.get("business_problem")),
            "kpi": _text(raw.get("kpi"), 1000),
            "pillar_ids": pids,
            "stage_id": stage,
            "workstream_id": ws,
            "priority_rank": _int(raw.get("priority_rank")),
            "priority_tier": tier,
            "effort": eff,
            "effort_quadrant": _text(raw.get("effort_quadrant"), 60),
            "effort_rationale": _text(raw.get("effort_rationale"), 1000),
            "dataset_ids": dsids,
            "data_requirements": {
                "assets": _text_list(dr.get("assets"), 40),
                "sources": _text_list(dr.get("sources"), 40),
                "rationale": _text(dr.get("rationale"), 1000),
            },
            "value": _value(raw.get("value"), label, warnings),
            "plan": _plan(raw.get("plan")),
            "catalog_match": {"title": _text(hint.get("title"), MAX_SHORT), "id": _text(hint.get("id"), 120)},
        })

    if errors:
        return None, errors, warnings
    return Normalized(version, generator, roadmap, pillars, stages, workstreams,
                      data_categories, datasets, use_cases), errors, warnings


def _value(raw: Any, label: str, warnings: list[str]) -> dict | None:
    if not isinstance(raw, dict):
        return None
    low, base, high = (_num(raw.get(k)) for k in ("annual_low", "annual_base", "annual_high"))
    if base is None:
        return None
    if base < 0:
        warnings.append(f"{label}: negative value ignored")
        return None
    low = base if low is None else low
    high = base if high is None else high
    if not (low <= base <= high):
        warnings.append(f"{label}: value range out of order; sorted")
        low, base, high = sorted((low, base, high))
    assumptions = []
    for a in _list(raw.get("assumptions"), 30):
        if not isinstance(a, dict) or not _text(a.get("label"), MAX_SHORT):
            continue
        assumptions.append({
            "label": _text(a.get("label"), MAX_SHORT),
            "low": _num(a.get("low")), "base": _num(a.get("base")), "high": _num(a.get("high")),
            "unit": _text(a.get("unit"), 20), "note": _text(a.get("note"), 1000),
            "source": _text(a.get("source"), MAX_SHORT),
        })
    return {
        "annual_low": round(low, 2), "annual_base": round(base, 2), "annual_high": round(high, 2),
        "basis": _text(raw.get("basis"), 1000),
        "formula": _text(raw.get("formula"), 1000),
        "assumptions": assumptions,
    }


def _plan(raw: Any) -> dict | None:
    if not isinstance(raw, dict):
        return None
    phases = []
    for p in _list(raw.get("phases"), 8):
        if not isinstance(p, dict):
            continue
        title = _text(p.get("title"), MAX_SHORT)
        name = _text(p.get("name"), 80)
        if not (title or name):
            continue
        phases.append({
            "name": name, "when": _text(p.get("when"), 80), "title": title,
            "summary": _text(p.get("summary"), 1000), "scope": _text(p.get("scope"), MAX_SHORT),
            "steps": _text_list(p.get("steps"), 12, 400),
        })
    headline, pilot = _text(raw.get("headline"), MAX_SHORT), _text(raw.get("pilot"), 1000)
    if not (phases or headline or pilot):
        return None
    return {"headline": headline, "pilot": pilot, "phases": phases}


# ---------------------------------------------------------------------------
# match a roadmap use case to the catalog
# ---------------------------------------------------------------------------
_STOP = frozenset("""a an and the of for to in on with by from at as or vs via into across per
our your their its is are be this that using use based data ai ml analytics analysis
management system systems platform program""".split())


def _norm_title(s: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split())


def _stem(w: str) -> str:
    for suf in ("ization", "isation", "ations", "ation", "ments", "ment", "ings", "ing",
                "ies", "es", "ed", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokens(s: str) -> set[str]:
    return {_stem(w) for w in _norm_title(s).split() if w not in _STOP and len(w) > 2}


def _score(uc_tokens: set[str], uc_desc_tokens: set[str], cand_tokens: set[str]) -> float:
    if not uc_tokens or not cand_tokens:
        return 0.0
    inter = uc_tokens & cand_tokens
    # Title-to-title Dice coefficient, plus a small lift when the roadmap's
    # description shares words with the catalog title.
    dice = 2 * len(inter) / (len(uc_tokens) + len(cand_tokens))
    lift = 0.15 * (len((uc_desc_tokens - uc_tokens) & cand_tokens) / max(len(cand_tokens), 1))
    return min(1.0, dice + lift)


MAP_THRESHOLD = 0.7     # suggest "map to the catalog" at or above this score
CANDIDATE_FLOOR = 0.2   # never show a candidate below this


def match(use_cases: list[dict], catalog: list[dict], *, limit: int = 3) -> list[dict]:
    """Rank catalog use cases for each roadmap use case.

    `catalog` rows: {id, title, description?}. Deterministic and explainable: exact
    title (or the package's own catalog_match hint) first, then word overlap. The
    person importing confirms every row, so this only has to put the right answer
    near the top, never decide on its own."""
    by_title = {_norm_title(c["title"]): c for c in catalog}
    by_id = {str(c["id"]): c for c in catalog}
    cat_tokens = [(c, tokens(c["title"])) for c in catalog]
    out = []
    for uc in use_cases:
        hint = uc.get("catalog_match") or {}
        exact, reason = None, None
        if hint.get("id") and str(hint["id"]) in by_id:
            exact, reason = by_id[str(hint["id"])], "catalog id given by the roadmap"
        elif hint.get("title") and _norm_title(hint["title"]) in by_title:
            exact, reason = by_title[_norm_title(hint["title"])], "catalog title given by the roadmap"
        elif _norm_title(uc["name"]) in by_title:
            exact, reason = by_title[_norm_title(uc["name"])], "same title"
        cands: list[dict] = []
        if exact:
            cands.append({"use_case_id": exact["id"], "title": exact["title"], "score": 1.0, "reason": reason})
        ut, dt = tokens(uc["name"]), tokens(" ".join(filter(None, [uc.get("summary"), uc.get("description")])))
        scored = sorted(((round(_score(ut, dt, ct), 3), c) for c, ct in cat_tokens
                         if not exact or c["id"] != exact["id"]),
                        key=lambda x: (-x[0], x[1]["title"]))
        for s, c in scored:
            if len(cands) >= limit or s < CANDIDATE_FLOOR:
                break
            cands.append({"use_case_id": c["id"], "title": c["title"], "score": s, "reason": "similar title"})
        top = cands[0] if cands else None
        if top and top["score"] >= MAP_THRESHOLD:
            suggestion = {"action": "map", "use_case_id": top["use_case_id"]}
        else:
            suggestion = {"action": "create", "use_case_id": None}
        out.append({"external_id": uc["id"], "name": uc["name"], "candidates": cands,
                    "suggestion": suggestion})
    return out


# ---------------------------------------------------------------------------
# diff two versions of the same roadmap
# ---------------------------------------------------------------------------
_DIFF_FIELDS = ("name", "pillar_ids", "stage_id", "workstream_id", "priority_tier", "priority_rank", "effort")


def diff(previous: dict | None, current: dict) -> dict:
    """What changed between the last applied version of a roadmap and this one, by
    use-case id. `previous`/`current` are Normalized.as_dict() payloads."""
    if not previous:
        return {"first_import": True, "added": [u["id"] for u in current["use_cases"]],
                "removed": [], "changed": []}
    old = {u["id"]: u for u in previous.get("use_cases", [])}
    new = {u["id"]: u for u in current["use_cases"]}
    changed = []
    for uid in new.keys() & old.keys():
        a, b = old[uid], new[uid]
        fields = [f for f in _DIFF_FIELDS if a.get(f) != b.get(f)]
        va = (a.get("value") or {}).get("annual_base")
        vb = (b.get("value") or {}).get("annual_base")
        if va != vb:
            fields.append("value")
        if fields:
            changed.append({"id": uid, "name": b["name"], "fields": fields})
    return {
        "first_import": False,
        "added": sorted(new.keys() - old.keys()),
        "removed": sorted(old.keys() - new.keys()),
        "changed": sorted(changed, key=lambda c: c["id"]),
    }


# ---------------------------------------------------------------------------
# value
# ---------------------------------------------------------------------------
def value_formula(value: dict | None, currency: str = "USD") -> dict | None:
    """A value_engine formula that evaluates to the roadmap's own estimate.

    Uses value_engine's fixed-estimate form ({low_mm, mid_mm, high_mm}, no components)
    so the roadmap's base value is kept exactly (a component formula's mid is the
    average of low and high, which moves it whenever the range is asymmetric) and
    flows unchanged through every value surface: Value tab, analytics, what-if."""
    if not value or not value.get("annual_base"):
        return None
    return {
        "driver": "Roadmap estimate",
        "source": "roadmap",
        "currency": currency,
        "basis": value.get("formula") or value.get("basis"),
        "low_mm": round(value["annual_low"] / 1e6, 3),
        "mid_mm": round(value["annual_base"] / 1e6, 3),
        "high_mm": round(value["annual_high"] / 1e6, 3),
        "roiMonths": None,
    }
