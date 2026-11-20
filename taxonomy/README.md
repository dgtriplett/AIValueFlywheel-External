# Taxonomy crosswalks (provenance)

The source data the shipped reference catalog's data taxonomy was built from:

| File | What |
|---|---|
| `data_sources.json` | The 31 canonical coarse data sources. |
| `crosswalk_module_to_source.json` | Each of the 164 fine data modules → its coarse source. |
| `crosswalk_source_to_domain.json` | Coarse sources ↔ the 66 semantic data domains. |
| `crosswalk_wizard_to_source.json` | An earlier 37-source vocabulary → the canonical 31. |
| `asset_feeds.json`, `asset_tiers.json`, `use_case_outcomes.json` | Asset lineage, raw vs product tiers, use-case outcomes. |

The app does not read these at runtime: everything it needs is in
`reference/catalog.json` (built by `scripts/export_reference.py`). Edit the catalog in
**Admin**, or change `reference/catalog.json` and re-run setup with
`refresh_catalog=true` (see OPERATIONS.md).
