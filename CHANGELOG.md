# Changelog

## 2.0.0 — 2026-11

Renamed **AI Value Realization (AIVR)**. The app now starts from a roadmap your
organization has already agreed and is where you build it out and measure it.

- **Import a roadmap.** *Operate → Roadmap → Import roadmap* takes an AI
  Transformation Roadmap deck (`.html`) or a roadmap package (`.json`, format in
  [ROADMAP_PACKAGE.md](ROADMAP_PACKAGE.md), example in `reference/`). Each use case is
  matched to the catalog, created new, or skipped, and a person confirms every row
  before anything is written (*Suggest matches with AI* helps with the hard ones).
  Pillars, priority (now / next / later), workstream, the roadmap's value estimate and
  its first-version plan come with it. Importing the next version shows what was
  added, changed and dropped; dropped use cases stay in the portfolio, flagged.
- **Operate** shows pillar progress (live vs on the roadmap, value live vs planned), a
  priority column in roadmap order, and a *Roadmap* tab on every use case. Tabs are now
  Roadmap · Data · Value calibration · What-if · Discover & reconcile: *Coverage* and
  the shared-funding list are gone, and Reconciliation and Discovery are one tab that
  compares discovered data with what the team recorded in *Data*.
- **One value per business unit.** A use case on the unit's roadmap is valued at the
  roadmap's estimate everywhere (table, drawer, Value tab, analytics, what-if); a
  value set on the use case applies to that unit only and survives a re-import.
- **Explore** replaces Assess: the catalog as a dependency map with each use case's
  blast radius, your portfolio highlighted, and *Add to portfolio* on any use case.
- **Removed:** the maturity assessment (wizard, scoring, results dashboard,
  pre-assessment worksheet, compare, scenarios, assessment AI insights and decks) and
  *Promote to Operate*. Their tables stay in the schema, unused, so an upgraded
  install keeps its history.
- **Viewer** members can no longer import roadmaps or add use cases from Explore.
- Schema migration `002_roadmap_import` (additive).
- `GET /api/sync/catalog` (was `/api/sync/value-flywheel-catalog`, still served) for
  planning tools that align their roadmap to the catalog. The maturity-assessment
  package import (`/api/sync/maturity-roadmap/*`) is removed.
- Headers `X-AIVR-Account` / `X-AIVR-User` (the 1.x names are still accepted); backup
  files are `aivr-backup/1` (1.x backups still restore).

**Coming from 1.x:** the bundle, app, Lakebase project and schemas have new default
names (`ai-value-realization`). Deploy 2.0 from a **fresh clone**: the CLI keeps
deployment state in the checkout's `.databricks/` folder per target, so deploying from
a checkout that deployed 1.x plans to delete the 1.x app and replace its Lakebase
project (the CLI stops and asks first — do not approve it). From a fresh clone, 2.0
installs next to 1.x. Move your data with *Admin → Download backup* on the old app and
`scripts/restore.py` into the new one, then remove the old install with
`databricks bundle destroy` from the 1.x checkout.

## 1.0.0 — 2026-11

First release as a customer-deployable application.

- **Two storage backends.** `lakebase` (Lakebase Postgres, recommended) and `delta`
  (Delta tables through a SQL warehouse), with the same features. Pick one with the
  bundle target.
- **One-command deploy.** `databricks bundle deploy -t <target>` creates the app and
  its storage, runs an idempotent setup job (migrations, reference catalog, first
  business unit, admins, grants) and starts the app.
- **Add use case with an agent.** Describe a use case and the agent maps it to data
  assets, data domains, prerequisites, enabled use cases and a value model. Every
  mapping is reviewed before it is saved. Custom use cases can be re-mapped later.
- **Pre-assessment worksheet** covers every assessment step, so stakeholders can
  answer ahead of the session and the upload pre-fills the whole wizard.
- **Backup and restore** of all app data from Admin, restorable into either backend.
- **Admin → Setup** shows install health with exact fixes and GRANT statements.
- Reference catalog `2026.11`: 240 use cases, 164 data assets, 31 data sources, 66
  data domains, dependency edges and default value assumptions. It is seeded on
  install, and no business-unit data ships with it.
- No calls outside your workspace; fonts are system fonts.
