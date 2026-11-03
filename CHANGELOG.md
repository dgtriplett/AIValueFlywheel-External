# Changelog

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
