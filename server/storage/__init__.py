"""Storage backends for app state.

`server.db.db` is the single entry point the app uses. It delegates to one of:

  lakebase  storage/lakebase.py — Lakebase (managed Postgres) over asyncpg.
            The default and the recommended choice.
  delta     storage/delta.py — Delta tables in Unity Catalog, through a SQL
            warehouse. For workspaces where Lakebase is not available; every
            statement is translated from Postgres by storage/translate.py.

Selected by the STORAGE_BACKEND setting (bundle variable `storage_backend`).
"""
