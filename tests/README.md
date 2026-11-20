# Tests

Run everything:

```bash
python3 -m unittest discover -s tests -v
```

Or run every gate CI runs — tests, lint, secret scan, console-bundle syntax, and a
clean import of `app.py` against the real (unstubbed) dependencies:

```bash
python3 scripts/check.py
```

`scripts/check.py` is the single definition of "does this repo pass";
`.github/workflows/ci.yml` only calls it, so the gates are identical on a laptop
and in CI. It reports a missing tool as **skip**, never as a pass.

The suite deliberately uses only the **standard library** (`unittest`,
`unittest.mock`) plus what the app already depends on. No pytest, no test
containers, no live Lakebase — so it runs in CI, in a sandbox, and on a laptop
that has never talked to Databricks.

| File | Covers |
|---|---|
| `test_pu_domains.py` | The shipped domain vocabulary is internally consistent and every module mapping resolves against `pu_catalog.MODULES`. |
| `test_readiness.py` | `classify()` truth table and the **dual-path** selection in `readiness_map()` (module vs. domain vs. `requires_locked`), driven by a fake DB. |
| `test_value_engine.py` | The parameterized value model: component arithmetic, low/high bands, realized value, and the shipped catalog (every assumption key it references is seeded, so nothing silently evaluates to $0). |
| `test_normalization.py` | Deterministic canonical matching (exact / alias / normalized) and that manual mappings are never overwritten. |
| `test_source_resolution.py` | The discovery→catalog join: 100% of a realistic corpus of customer schema names (`maximo`, `osisoft_pi`, `sap_isu`) resolves deterministically, and **zero** analytics-noise names (`dim_date`, `bronze`, `poc_project`) resolve. Both corpora are the test — a resolver that matches everything makes the coverage numbers fiction. |
| `test_sync_packages.py` | Free-text data-need labels (e.g. a roadmap's datasets) resolve to canonical catalog assets instead of creating generic imported dataset rows. |
| `test_roadmap_package.py` | The roadmap package: bad files are refused with a reason, imperfect ones import with warnings (never silent fixes), matching only suggests and ranks the right catalog use case first, a new version's diff names what was added/changed/dropped, and the roadmap's value keeps its base exactly. |
| `test_aitr_deck.py` | Importing an AITR deck: only allow-listed roadmap content is taken, value is gross to the organization (any attribution model is never applied), in-flight and enabler tiles are left out, attribution sentences are removed from prose, the page is read as data and never run, and a deck that cannot be cleaned is refused. |
| `test_confirm.py` | Propose/confirm token lifecycle — single use, TTL expiry, payload integrity. |
| `test_taxonomy.py` | Taxonomy dimension vocabularies and effective-dating. |
| `test_migrator.py` | Migrations apply **at most once**, in order, and drift aborts before applying anything. Also that `startup_check` never executes DDL. |
| `test_logging.py` | JSON log shape, per-request correlation ids under concurrency, secret redaction, and an AST check banning `print()` in `server/`. |
| `test_ci.py` | The workflow references files that exist, tests the deployed Python version and the declared floor, and no gate has been silently dropped from `check.py`. |
| `test_limits.py` | Rate limits are per-actor and per-class, the limiter fails open, query budgets stay isolated across concurrent requests, and every expensive endpoint declares a limit. |
| `test_docs.py` | Docs make no claim the code contradicts: links resolve, documented flags exist, every setting the code reads is documented, and nothing still says migrations apply on startup. |
| `test_console_nav.py` | Every menu item routes somewhere real, no view is orphaned, menus carry the right ARIA roles, and the two CSS invariants that made the dropdowns invisible (nav clipping, header z-index) stay fixed. |
| `test_knowledge.py` | KB slugs (reserved-word and collision handling), folder paths (subtree matching, LIKE escaping, circular moves), **attachment validation against forged MIME types and path traversal**, the search SQL's parameter binding across all 32 filter combinations, and the two new migrations' DDL. |
| `test_whatif.py` | The what-if simulator and account scoping, which share `ready_assets()`: overrides win over stored state, the simulator reuses the real readiness logic instead of reimplementing it, it writes nothing, and concurrent requests never share an account. |
| `test_snapshots.py` | The trend: snapshots store computed FIGURES not foreign keys (a view would rewrite history when an assumption is recalibrated), they de-duplicate per minute, automatic triggers use `capture_quietly` so a charting failure never reports a successful change as failed, and the status WRITE path is account-scoped. |
| `test_account_scoping.py` | Regression guards for customer-owned tables: CRUD routes, derived surfaces, research/profile writes, and the hardening migration must carry `account_id` rather than producing globally visible rows. |
| `test_dependency_editing.py` | Hand-editing the dependency graph: cycles are refused BEFORE the insert (a two-use-case loop is the easy accident, and `compute_all_phases` survives it — so the graph goes quietly meaningless rather than loudly broken), the 422 names the chain without repeating a title, edits set `requires_locked` so a later automated pass cannot revert a human, and phase is recomputed on create AND delete. |
| `test_extractor_push.py` | The extractor's `--push` mode: it paces uploads to stay inside the server's `sweep` rate limit (three posted in a loop 429 on the third, every time), honours `Retry-After`, does not retry a 502 that names a permanent cause, keeps the manual CSV path intact for air-gapped estates, and reports failure with an exit code instead of raising after an hour-long sweep. |
| `test_value_plausibility.py` | What the portfolio claims IN AGGREGATE, which no per-formula test can see: every multiplier was individually defensible while 28 use cases together claimed 67% of the distribution capital plan and the total reached 28% of revenue. Caps the share of each denominator the whole catalog may claim, and the size of any single use case. |
| `test_genie_provision.py` | Genie space creation, where nothing fails loudly: the space is configured over the tables `mirror_to_uc()` actually builds (derived from its DDL, not a second copy of the list), the payload keeps the probed `serialized_space` shape, the instructions state the units and forbid joining two tables that both have an `id`, and an existing space is never overwritten. |
| `test_proposals.py` | The proposal agent: the prompt actually carries real instance values (company, computed value, domain gaps, prerequisite build state), and output that is missing, thin, or stubbed with TODO is rejected rather than stored. |
| `test_no_redundancy.py` | One definition per rule: no module restates `READY_STATUSES`, copies the cost table, or evaluates value models outside `value_engine`. |
| `test_app_wiring.py` | Every router is mounted, and no literal route is shadowed by a parameterized one declared before it. |
| `test_llm_negotiation.py` | Optional-parameter negotiation (`temperature` / `response_format` rejection) and that every model call goes through a negotiating helper. |
| `test_authoring.py` | The use-case authoring agent's rules: only catalog ids survive validation (and dropped ones are reported), enums are coerced, a use case can't be both a prerequisite and enabled, and no accepted dependency edge can close a cycle in the enables graph. |
| `test_storage_schema.py` | The Postgres baseline, the generated Delta schema, and `server/storage/schema_meta.json` describe the same tables and columns; every table has a primary key; Delta ids are 64-bit; and the schema invariants (knowledge-base uniqueness, cascades, snapshots not foreign-keyed) hold. |
| `test_research.py` | Assumption parsing: invented keys rejected, unit misreads flagged, `"3.6M"` coerced, confidence downgraded. |
| `test_rules.py` | Classification rules — first-match-wins per dimension, regex support. |
| `test_enrichment.py` | The staged `ai_query()` enrichment pipeline. |
| `test_setup.py` | The `/api/setup/*` permission probes and the GRANT statements they emit. |
| `test_extractor_download.py` | The downloadable cross-workspace schema extractor is served intact and runnable. |

## Why a fake DB instead of a real one

`readiness.py` reads the requirement structure with static SQL and does the
counting in Python, which is where the interesting logic lives: which path a use
case scores on, and how domain satisfaction folds into `classify()`.
`tests/fakedb.py` implements just enough of the `db.fetch` interface to return
canned rows per query, so the tests assert on real branching behaviour rather than
mocking out the function under test. The SQL itself runs for real in
`tests/integration/smoke.py` (against a running app, either backend) and
`tests/integration/check_delta_sql.py` (every statement EXPLAINed on a warehouse).
