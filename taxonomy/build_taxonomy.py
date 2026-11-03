#!/usr/bin/env python3
"""
Grid Compass — canonical taxonomy + crosswalk builder (Phase A).

Produces the single source of truth for the converged app's data taxonomy and the
three crosswalks that let it move between the strategic (coarse) grain and the
operational (fine) grain:

  1. data_sources.json            — CANONICAL coarse taxonomy (31 domain-aligned ds_*).
                                     Survey grain + Assess selection grain. Stable ids.
  2. crosswalk_wizard_to_source.json
                                   — legacy 37 wizard ds_* -> canonical 31 (data migration
                                     + reconciles the vocabulary split that broke round-trip).
  3. crosswalk_module_to_source.json
                                   — fine modules -> canonical coarse source (roll-UP;
                                     this is the lower->higher granularity bridge).
  4. crosswalk_source_to_domain.json
                                   — canonical coarse source <-> 63 semantic domains
                                     (DERIVED from grid-atlas SERVES + the module rollup).
  5. TAXONOMY_REVIEW.md           — human review report: coverage, ambiguous/flagged maps, gaps.

Inputs are read from the two existing apps at build time (single source of truth, no retyping);
outputs are self-contained JSON the new app seeds from. Read-only against the old apps.
"""
from __future__ import annotations
import json
import os
import re
import importlib.util
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECTS = os.path.abspath(os.path.join(HERE, "..", ".."))
ASSESS = os.path.join(PROJECTS, "data-ai-maturity-assessment")
ATLAS = os.path.join(PROJECTS, "grid-atlas")


def _load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# --------------------------------------------------------------------------
# INPUT 1 — canonical 31 coarse sources (from the survey template = single truth)
# --------------------------------------------------------------------------
pat = _load_module(os.path.join(ASSESS, "backend", "preassessment_template.py"),
                   "pat_src")
CANON_SOURCES = [dict(d) for d in pat.DATA_SOURCES]  # id, category, name, description
CANON_IDS = {d["id"] for d in CANON_SOURCES}
assert len(CANON_SOURCES) == 31, f"expected 31 canonical sources, got {len(CANON_SOURCES)}"

# --------------------------------------------------------------------------
# INPUT 2 — legacy 37 wizard sources (dataSources.ts, parsed with regex)
# --------------------------------------------------------------------------
ts = open(os.path.join(ASSESS, "frontend", "src", "data", "dataSources.ts")).read()
WIZARD = []
for blk in re.findall(r"\{[^{}]*id:\s*['\"]ds_[^{}]*\}", ts, re.S):
    gid = re.search(r"id:\s*['\"](ds_[a-z0-9_]+)", blk)
    gnm = re.search(r"name:\s*['\"]([^'\"]+)", blk)
    gct = re.search(r"category:\s*['\"]([^'\"]+)", blk)
    WIZARD.append({"id": gid.group(1),
                   "name": gnm.group(1) if gnm else "",
                   "category": gct.group(1) if gct else ""})
WIZARD_IDS = {w["id"] for w in WIZARD}

# --------------------------------------------------------------------------
# INPUT 3 — fine modules (grid-compass's OWN seed_data.json, the canonical seed
# this app actually loads). It began as grid-atlas's 146 and grew (e.g. the 18
# modules added so the 6 previously-inert coarse sources roll DOWN to real
# modules). Reading it here — not the grid-atlas ancestor — keeps the module
# crosswalk in lockstep with what seed_lib.load_data() seeds, so a clean re-seed
# never leaves a module unmapped.
# --------------------------------------------------------------------------
GC_SEED = os.path.join(HERE, "..", "scripts", "seed_data.json")
seed = json.load(open(GC_SEED if os.path.exists(GC_SEED)
                      else os.path.join(ATLAS, "scripts", "seed_data.json")))
MODULES = [(a["source_category"], a["module"]) for a in seed["data_assets"]]
SOURCE_CATEGORIES = sorted({sc for sc, _ in MODULES})

# --------------------------------------------------------------------------
# INPUT 4 — domains + SERVES (grid-compass's OWN pu_domains.py, the canonical seed
# this app loads). Like INPUT 3, read grid-compass — not the grid-atlas ancestor —
# so the derived source<->domain crosswalk includes the domains added for the 6
# previously-inert coarse sources (IT observability, OT security, identity, DCS
# controls, outage comms, outage planning). Falls back to the ancestor if absent.
# --------------------------------------------------------------------------
GC_DOMAINS = os.path.join(HERE, "..", "scripts", "pu_domains.py")
pud = _load_module(GC_DOMAINS if os.path.exists(GC_DOMAINS)
                   else os.path.join(ATLAS, "scripts", "pu_domains.py"), "pu_domains_src")
DOMAINS = {name: {"label": label, "category": cat} for (name, label, cat, _d, _e) in pud.DOMAINS}
SERVES = pud.SERVES  # domain_name -> [(source_category, module), ...]

# ==========================================================================
# HAND-AUTHORED MAP A — legacy wizard 37 -> canonical 31
#   confidence: exact | high | medium | flag  (flag = needs Drew's review / genuine gap)
# ==========================================================================
WIZARD_TO_SOURCE = {
    "ds_scada":        ("ds_distribution_scada", "medium", "Generic SCADA; splits into dist vs trans in canonical — defaulting to distribution."),
    "ds_ami":          ("ds_ami_meter", "exact", ""),
    "ds_amr":          ("ds_ami_meter", "high", "Legacy AMR folds into the AMI/metering coarse source."),
    "ds_oms":          ("ds_outage_management", "exact", ""),
    "ds_dms":          ("ds_dms_adms", "exact", ""),
    "ds_ems":          ("ds_trans_scada", "high", "EMS = transmission SCADA+EMS coarse source."),
    "ds_gis":          ("ds_dist_assets_gis", "high", ""),
    "ds_field_mobile": ("ds_mobile_workforce", "high", ""),
    "ds_lidar":        ("ds_geospatial", "high", ""),
    "ds_drone":        ("ds_geospatial", "high", ""),
    "ds_satellite":    ("ds_geospatial", "high", ""),
    "ds_dcs_plant":    ("ds_dcs_controls", "high", "Plant DCS/historian; pairs with ds_pi_historian at module grain."),
    "ds_cis":          ("ds_meter_billing", "high", ""),
    "ds_crm":          ("ds_meter_billing", "medium", "CRM customer master rolls into CIS/billing coarse source."),
    "ds_billing":      ("ds_meter_billing", "exact", ""),
    "ds_web_portal":   ("ds_call_center", "medium", "Digital self-service channel folds into the customer-interaction coarse source."),
    "ds_call_center":  ("ds_call_center", "exact", ""),
    "ds_dsm":          ("ds_program_enrollment", "high", ""),
    "ds_eam":          ("ds_work_management", "high", "EAM asset registry+WO; asset-master attributes also feed ds_transformer_records."),
    "ds_workorders":   ("ds_work_management", "exact", ""),
    "ds_iot_equipment":("ds_transformer_records", "medium", "Equipment IoT/condition telemetry attaches to the asset-records coarse source."),
    "ds_inspections":  ("ds_work_management", "medium", "Inspections/rounds live under work management at coarse grain."),
    "ds_erp":          ("ds_erp_financial", "exact", ""),
    "ds_capital":      ("ds_capital_projects", "exact", ""),
    "ds_regulatory":   ("ds_regulatory_filings", "exact", ""),
    "ds_iso_market":   ("ds_iso_market", "exact", ""),
    "ds_gas_market":   ("ds_fuel_mgmt", "medium", "Gas/NYMEX pricing folds into fuel management (contracts/hedges/nominations)."),
    "ds_weather":      ("ds_weather", "exact", ""),
    "ds_emissions":    ("ds_emissions_cems", "medium", "External carbon/GHG folds into the emissions coarse source (stack CEMS is the module-grain sibling)."),
    "ds_third_party_veg":("ds_geospatial", "medium", "Third-party vegetation data folds into geospatial/imagery."),
    # ---- genuine gaps: no coarse home in the domain-aligned 31 ----
    "ds_demographics": (None, "flag", "External demographics/census — no coarse home in the 31. Decide: add a canonical external-analytics source, or drop."),
    "ds_social":       (None, "flag", "Social/sentiment — no coarse home in the 31. Same decision as demographics."),
    "ds_cp":           (None, "flag", "Gas cathodic-protection telemetry — gas-integrity data not represented in the 31 (or in grid-atlas's 146). Add a gas-integrity coarse source if the gas motion needs it."),
    "ds_ili":          (None, "flag", "Pipeline ILI / smart-pig — gas-integrity gap (see ds_cp)."),
    "ds_methane":      (None, "flag", "Methane/leak survey — gas-integrity gap (see ds_cp)."),
    "ds_compressor":   (None, "flag", "Compressor-station telemetry — gas-integrity gap (see ds_cp)."),
    "ds_storage_meter":(None, "flag", "Gas storage / LNG telemetry — gas-integrity gap (see ds_cp)."),
}

# ==========================================================================
# HAND-AUTHORED MAP B — fine module -> canonical coarse source
#   Keyed primarily by source_category; a few (source_category, module) overrides
#   where a category legitimately splits across coarse sources.
# ==========================================================================
CATEGORY_TO_SOURCE = {
    "ADMS (Distribution)":   "ds_dms_adms",
    "CEMS":                  "ds_emissions_cems",
    "CIS/Billing":           "ds_meter_billing",
    "DERMS":                 "ds_program_enrollment",
    "Data Historian":        "ds_pi_historian",
    "Document/Content Mgmt": "ds_regulatory_filings",
    "EAM/APM":               "ds_work_management",
    "EMS (Transmission)":    "ds_trans_scada",
    "ERP":                   "ds_erp_financial",
    "Fuel Management":       "ds_fuel_mgmt",
    "GIS":                   "ds_dist_assets_gis",
    "LIMS":                  "ds_pi_historian",
    "Market/ISO Feed":       "ds_iso_market",
    "Meter/AMI/MDM":         "ds_ami_meter",
    "PMU/Synchrophasor":     "ds_pmu",
    "Radiation/Dosimetry":   "ds_safety_incidents",
    "Standalone OMS":        "ds_outage_management",
    "Standalone SCADA":      "ds_distribution_scada",
    "Weather":               "ds_weather",
    # Categories added so the 6 coarse survey sources that the inherited grid-atlas
    # 146-module catalog never modeled (IT observability, OT security, identity, DCS
    # controls, customer outage comms, outage/maintenance planning) roll down to real
    # fine modules instead of being inert.
    "IT Observability":            "ds_it_observability",
    "OT Security":                 "ds_ot_security",
    "Identity & Access":           "ds_identity_iam",
    "DCS / Unit Controls":         "ds_dcs_controls",
    "Customer Outage Comms":       "ds_outage_notifications",
    "Outage & Maintenance Planning": "ds_outage_planning",
}
MODULE_OVERRIDES = {
    ("ADMS (Distribution)", "D-SCADA"):                 "ds_distribution_scada",
    ("ADMS (Distribution)", "OMS (Outage Management)"): "ds_outage_management",
    ("ADMS (Distribution)", "Storm / Damage Assessment"): "ds_outage_management",
    ("CIS/Billing", "CRM / Contact Center"):            "ds_call_center",
    ("CIS/Billing", "Programs / DSM Enrollment"):       "ds_program_enrollment",
    ("EAM/APM", "Mobile Workforce Management"):         "ds_mobile_workforce",
    ("EAM/APM", "Scheduling & Crew Optimization"):      "ds_mobile_workforce",
    ("EAM/APM", "Asset Registry & Hierarchy"):          "ds_transformer_records",
    ("EAM/APM", "Asset Performance & Health Scoring"):  "ds_transformer_records",
    ("ERP", "Human Capital Management"):                "ds_hr_workforce",
    ("ERP", "Procurement / Sourcing"):                  "ds_procurement",
    ("ERP", "Project System"):                          "ds_capital_projects",
    ("ERP", "Environment, Health & Safety"):            "ds_safety_incidents",
    ("ERP", "Plant Maintenance / EAM"):                 "ds_work_management",
    ("ERP", "Work Clearance Management"):               "ds_work_management",
    ("GIS", "Vegetation Management"):                   "ds_geospatial",
    ("Fuel Management", "Gas Nominations"):             "ds_fuel_mgmt",
}


def module_to_source(sc, mod):
    return MODULE_OVERRIDES.get((sc, mod)) or CATEGORY_TO_SOURCE.get(sc)


# ==========================================================================
# BUILD
# ==========================================================================
def build():
    out = {}

    # 1. canonical sources (add empty match_terms + utility_types placeholders to enrich later)
    out["data_sources"] = CANON_SOURCES

    # 2. wizard -> source
    w2s = []
    for w in WIZARD:
        tgt, conf, note = WIZARD_TO_SOURCE.get(w["id"], (None, "flag", "UNMAPPED — not in hand map"))
        assert tgt is None or tgt in CANON_IDS, f"{w['id']} -> {tgt} not canonical"
        w2s.append({"wizard_id": w["id"], "wizard_name": w["name"],
                    "wizard_category": w["category"], "source_id": tgt,
                    "confidence": conf, "notes": note})
    out["crosswalk_wizard_to_source"] = w2s

    # 3. module -> source
    m2s, unmapped_modules = [], []
    for sc, mod in MODULES:
        sid = module_to_source(sc, mod)
        if sid is None or sid not in CANON_IDS:
            unmapped_modules.append((sc, mod))
        m2s.append({"source_category": sc, "module": mod, "source_id": sid})
    out["crosswalk_module_to_source"] = m2s

    # 4. source <-> domain, DERIVED: domain -> serving modules -> coarse sources
    src_to_domains = defaultdict(set)
    domain_to_srcs = {}
    for dom, pairs in SERVES.items():
        srcs = set()
        for sc, mod in pairs:
            sid = module_to_source(sc, mod)
            if sid:
                srcs.add(sid)
                src_to_domains[sid].add(dom)
        domain_to_srcs[dom] = sorted(srcs)
    out["crosswalk_source_to_domain"] = {
        "source_to_domains": {s: sorted(src_to_domains.get(s, [])) for s in sorted(CANON_IDS)},
        "domain_to_sources": {d: domain_to_srcs[d] for d in sorted(domain_to_srcs)},
    }

    # write artifacts
    for key in ("data_sources", "crosswalk_wizard_to_source",
                "crosswalk_module_to_source", "crosswalk_source_to_domain"):
        with open(os.path.join(HERE, key + ".json"), "w") as f:
            json.dump(out[key], f, indent=2)

    # --------------------------------------------------------------
    # VALIDATION 1 — CMS worksheet round-trips against canonical ids
    # --------------------------------------------------------------
    import openpyxl
    wb = openpyxl.load_workbook("/tmp/assessment_checklist.xlsx", data_only=True)
    cms_ds = [str(r[1]) for r in wb["Data Sources"].iter_rows(min_row=2, values_only=True) if r and r[1]]
    cms_uc = [str(r[2]) for r in wb["Use Cases"].iter_rows(min_row=2, values_only=True) if r and r[2]]
    catalog_uc_ids = {u.get("parent_id") for u in seed["use_cases"]} | set(seed.get("id_to_index", {}).keys())
    ds_unresolved = [x for x in cms_ds if x not in CANON_IDS]
    uc_unresolved = [x for x in cms_uc if x not in catalog_uc_ids]

    # --------------------------------------------------------------
    # REVIEW REPORT
    # --------------------------------------------------------------
    flags = [r for r in w2s if r["confidence"] == "flag"]
    mediums = [r for r in w2s if r["confidence"] == "medium"]
    domains_no_source = [d for d, s in domain_to_srcs.items() if not s]
    sources_no_domain = [s for s in sorted(CANON_IDS) if not src_to_domains.get(s)]

    lines = []
    A = lines.append
    A("# Grid Compass — Taxonomy & Crosswalk Review\n")
    A("_Generated by `build_taxonomy.py`. Inputs read read-only from the two live apps._\n")
    A("## Canonical coarse taxonomy")
    A(f"- **{len(CANON_SOURCES)} data sources** (domain-aligned survey vocabulary), "
      f"{len({d['category'] for d in CANON_SOURCES})} categories: "
      f"{', '.join(sorted({d['category'] for d in CANON_SOURCES}))}\n")
    A("## Fine + semantic layers (from grid-atlas)")
    A(f"- **{len(MODULES)} modules** across {len(SOURCE_CATEGORIES)} source categories")
    A(f"- **{len(DOMAINS)} semantic domains** across {len({v['category'] for v in DOMAINS.values()})} categories\n")

    A("## Round-trip validation (the bug this fixes)")
    A(f"- CMS worksheet **data sources**: {len(cms_ds)} rows, "
      f"**{len(cms_ds)-len(ds_unresolved)}/{len(cms_ds)} resolve** against canonical ids"
      + (f" — UNRESOLVED: {ds_unresolved}" if ds_unresolved else " ✅"))
    A(f"- CMS worksheet **use cases**: {len(cms_uc)} rows, "
      f"**{len(cms_uc)-len(uc_unresolved)}/{len(cms_uc)} resolve** against the catalog"
      + (f" — UNRESOLVED (first 10): {uc_unresolved[:10]}" if uc_unresolved else " ✅"))
    A("")

    A("## Crosswalk 1 — legacy 37 wizard sources → canonical 31")
    A(f"- exact/high: {len([r for r in w2s if r['confidence'] in ('exact','high')])}"
      f"  •  medium (review nice-to-have): {len(mediums)}"
      f"  •  **flagged gaps (need your decision): {len(flags)}**")
    if flags:
        A("\n**Flagged — genuine gaps with no coarse home in the 31:**\n")
        A("| wizard id | name | issue |")
        A("|---|---|---|")
        for r in flags:
            A(f"| `{r['wizard_id']}` | {r['wizard_name']} | {r['notes']} |")
    if mediums:
        A("\n<details><summary>Medium-confidence maps (fold-ins; confirm you're OK)</summary>\n")
        A("| wizard id | → source | note |")
        A("|---|---|---|")
        for r in mediums:
            A(f"| `{r['wizard_id']}` | `{r['source_id']}` | {r['notes']} |")
        A("</details>")
    A("")

    A(f"## Crosswalk 2 — {len(MODULES)} modules → canonical coarse source (roll-up)")
    A(f"- modules mapped: **{len(MODULES)-len(unmapped_modules)}/{len(MODULES)}**"
      + (f" — UNMAPPED: {unmapped_modules}" if unmapped_modules else " ✅ (every module rolls up to exactly one coarse source)"))
    # rollup counts
    roll = defaultdict(int)
    for r in m2s:
        if r["source_id"]:
            roll[r["source_id"]] += 1
    A("\n<details><summary>Modules per coarse source</summary>\n")
    A("| coarse source | # modules |")
    A("|---|---|")
    for s in sorted(roll, key=lambda k: -roll[k]):
        A(f"| `{s}` | {roll[s]} |")
    A("</details>\n")

    A("## Crosswalk 3 — coarse source ↔ 63 domains (derived)")
    A(f"- domains with ≥1 serving coarse source: **{len(DOMAINS)-len(domains_no_source)}/{len(DOMAINS)}**"
      + (f" — domains with NO coarse source: {domains_no_source}" if domains_no_source else " ✅"))
    A(f"- coarse sources touching ≥1 domain: **{len(CANON_IDS)-len(sources_no_domain)}/{len(CANON_IDS)}**"
      + (f" — sources with NO domain: {sources_no_domain}" if sources_no_domain else ""))
    if sources_no_domain:
        A("  (sources with no domain are typically IT/OT/Security & identity — expected; "
          "they carry no use-case data need in the current domain vocabulary.)")
    A("")

    with open(os.path.join(HERE, "TAXONOMY_REVIEW.md"), "w") as f:
        f.write("\n".join(lines) + "\n")

    print("\n".join(lines))
    print("\nArtifacts written to", HERE)


if __name__ == "__main__":
    build()
