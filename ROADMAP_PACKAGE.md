# Roadmap package — format `aivr.roadmap`, version 1

How a roadmap gets into AIVR. *Operate → Roadmap → Import roadmap* accepts either:

- an **AI Transformation Roadmap deck** (`.html`, as published). AIVR reads it into a
  package like the one below in memory (`server/aitr_deck.py`) and never stores the
  HTML; *Download what was read* on the import screen shows exactly what was taken.
- a **roadmap package** (`.json`) in the format below, from any planning tool.

- Schema: [`reference/roadmap-package.schema.json`](reference/roadmap-package.schema.json)
- Complete example: [`reference/example-roadmap-package.json`](reference/example-roadmap-package.json)
- Validation, matching and diff: `server/roadmap_package.py`
- Import endpoints: `server/routes/roadmap_import.py`

## What happens on import

1. **Preview** (`POST /api/roadmap-import/preview`) validates the package and writes
   nothing. A package that breaks a rule below is refused with the list of reasons;
   one that is merely imperfect (an unknown pillar id on one use case, a value range
   given out of order) is accepted with warnings, never silently "fixed".
2. Every use case gets **catalog candidates**: the catalog id or title the package
   names in `catalog_match`, an exact title match, then word overlap. A use case is
   suggested *map* only when the match is strong; otherwise *create*. *Suggest matches
   with AI* (`POST /api/roadmap-import/suggest`) asks the model to pick from a short
   list of real catalog use cases, or none.
3. The person importing sets each row to **map** (to a catalog use case), **create**
   (a new use case for this business unit) or **skip**, and clicks *Import*
   (`POST /api/roadmap-import/apply`). Only owners and editors of the business unit
   can import.
4. AIVR adds the use cases to the business unit's portfolio, keeps what the roadmap
   said about each (`account_roadmap_use_cases`), replaces the business unit's pillars,
   and records the import (`roadmap_imports`). A created use case takes the roadmap's
   value estimate as its value model and is linked to the catalog data assets its data
   needs name, so readiness works from day one.

## Versions

`roadmap.id` must stay the same across versions of the same roadmap. Importing a
package with the same id:

- keeps every earlier mapping (a re-import never quietly re-points a use case);
- shows what was **added**, **changed** (name, pillar, stage, workstream, priority,
  effort, value) and **removed**;
- refreshes the value of a use case it created, as long as that value is still the
  roadmap's estimate (once someone replaces it with a real model, it is left alone);
- flags removed use cases as *dropped from roadmap*. They stay in the portfolio until
  someone removes them: they may already be half built.

A package with a different `roadmap.id` becomes the business unit's current roadmap,
and use cases only on the previous one are flagged dropped.

## Format

Top level:

| Field | Required | Notes |
|---|---|---|
| `format` | yes | `"aivr.roadmap"` |
| `format_version` | yes | `1` |
| `generated_at` | | ISO 8601 |
| `generator` | | `{name, version}` of the tool that wrote it |
| `roadmap` | yes | see below |
| `pillars` | | `[{id, name, description}]`, at most 20. The strategic priorities every use case ladders up to. |
| `stages` | | `[{id, name, description}]` — the value chain (e.g. Plan, Build, Operate, Serve). |
| `workstreams` | | `[{id, name, description, use_case_ids}]` |
| `data_categories` | | `[{id, name, description}]` |
| `datasets` | | `[{id, name, description, category_id}]` — the data the use cases need. |
| `use_cases` | yes | 1–500 entries, see below |

`roadmap`:

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable across versions (e.g. `example-power-and-light`). |
| `version` | | Shown in the app and in the import history. |
| `title`, `organization`, `business_unit`, `target_executive` | | Display. |
| `industry` | | e.g. `power_utilities`. The shipped catalog is Power & Utilities; other industries import, mostly as new use cases. |
| `currency` | | ISO code, default `USD`. |

Each use case:

| Field | Notes |
|---|---|
| `id`, `name` | Required. `id` is unique within the package and stable across versions. |
| `summary`, `description`, `business_problem`, `kpi` | Shown on the use case's *Roadmap* tab. |
| `pillar_ids` | Lead pillar first. Ids must be in `pillars`. |
| `stage_id`, `workstream_id`, `dataset_ids` | Ids from the lists above. |
| `priority_rank` | 1 = first. Orders the Operate table. |
| `priority_tier` | `now`, `next` or `later`. |
| `effort` | `S`, `M`, `L`, `XL` (`Low` / `Medium` / `High` are accepted). |
| `effort_quadrant`, `effort_rationale` | e.g. *Quick Win*. |
| `data_requirements` | `{assets: [...], sources: [...], rationale}` — free text; assets are matched to the catalog's data assets for use cases the import creates. |
| `value` | `{annual_low, annual_base, annual_high, basis, formula, assumptions: [{label, low, base, high, unit, note, source}]}`. The organization's full annual value from the use case, in `roadmap.currency`, whole units (not millions). `annual_base` is required when `value` is given. |
| `plan` | `{headline, pilot, phases: [{name, when, title, summary, scope, steps: [...]}]}` — the first-version plan (e.g. crawl / walk / run), at most 8 phases. |
| `catalog_match` | `{id}` or `{title}` of the catalog use case this one is, when the planning tool knows. `GET /api/sync/catalog` exports the catalog for that purpose. |

Limits: 500 use cases, 5 MB per package (15 MB per deck). Longer text fields are
truncated, and ids are reduced to letters, digits and `_ . : -`.
