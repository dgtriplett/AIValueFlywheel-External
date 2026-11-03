"""App-state database: one facade over the configured storage backend.

Every query in the app goes through `db` (fetch / fetchrow / fetchval / execute /
executemany / transaction / run_script) written in Postgres SQL with $n
parameters. STORAGE_BACKEND selects where it runs:

  lakebase (default)  Lakebase Postgres — the SQL runs as written.
  delta               Delta tables via a SQL warehouse — the SQL is translated
                      (server/storage/translate.py).

With no backend configured the app runs read-empty / write-no-op so the UI and the
Setup page still load and can explain what is missing.
"""
from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)


def _charge_budget() -> None:
    """Count this query against the current request's budget, if it set one.

    Charged HERE because these methods are the only way a query reaches storage,
    so counting at this choke point measures real queries instead of estimating.
    Imported lazily to keep limits.py free of a db dependency (a cycle otherwise).
    """
    from .limits import current_budget

    budget = current_budget.get()
    if budget is not None:
        budget.charge()


def storage_backend() -> str:
    value = (os.environ.get("STORAGE_BACKEND") or "lakebase").strip().lower()
    return value if value in ("lakebase", "delta") else "lakebase"


def _make_backend():
    if storage_backend() == "delta":
        from .storage.delta import DeltaBackend
        return DeltaBackend()
    from .storage.lakebase import LakebaseBackend
    return LakebaseBackend()


class Database:
    def __init__(self) -> None:
        self._backend = None

    @property
    def backend(self):
        if self._backend is None:
            self._backend = _make_backend()
        return self._backend

    @property
    def backend_name(self) -> str:
        return self.backend.name

    @property
    def is_demo_mode(self) -> bool:
        return self.backend.is_demo_mode

    async def get_pool(self):
        """Truthy when a database is reachable (kept for connectivity checks)."""
        return await self.backend.get_pool()

    async def fetch(self, sql: str, *args):
        _charge_budget()
        return await self.backend.fetch(sql, *args)

    async def fetchrow(self, sql: str, *args):
        rows = await self.fetch(sql, *args)
        return rows[0] if rows else None

    async def fetchval(self, sql: str, *args):
        row = await self.fetchrow(sql, *args)
        return row[0] if row else None

    async def execute(self, sql: str, *args):
        _charge_budget()
        return await self.backend.execute(sql, *args)

    async def executemany(self, sql: str, rows: list[tuple]):
        _charge_budget()
        return await self.backend.executemany(sql, rows)

    def transaction(self):
        return self.backend.transaction()

    async def run_script(self, sql: str) -> None:
        await self.backend.run_script(sql)

    async def refresh_token(self) -> None:
        await self.backend.refresh_token()

    async def close(self) -> None:
        if self._backend is not None:
            await self._backend.close()


db = Database()


async def token_refresh_loop(interval_seconds: int = 45 * 60) -> None:
    """Proactively refresh the backend's OAuth credentials before they expire."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await db.backend.periodic()
        except Exception as exc:  # noqa: BLE001
            # Not fatal: the next query's auth-error path reconnects.
            logger.warning("credential refresh failed (%s: %s) — will retry on the "
                           "next query", type(exc).__name__, exc)
