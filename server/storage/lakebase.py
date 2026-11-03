"""Lakebase (managed Postgres) backend: asyncpg pool with OAuth token refresh.

- If ``PGHOST`` is unset, runs in no-database mode (reads return empty, writes are
  no-ops) so the app still renders and the Setup page can say what is missing.
- OAuth tokens expire (~1h); on an auth failure the pool is recreated with a fresh
  token. A background task also proactively refreshes every ~45 minutes.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from typing import Optional

import asyncpg

from ..config import get_oauth_token

logger = logging.getLogger(__name__)

# asyncpg error classes that indicate the OAuth token is stale/invalid.
_AUTH_ERRORS = (
    asyncpg.InvalidAuthorizationSpecificationError,
    asyncpg.InvalidPasswordError,
)


class LakebaseBackend:
    name = "lakebase"
    dialect = "postgres"

    def __init__(self) -> None:
        self._pool: Optional[asyncpg.Pool] = None
        self._demo_mode = False
        self._lock = asyncio.Lock()

    @property
    def is_demo_mode(self) -> bool:
        return self._demo_mode

    @property
    def configured(self) -> bool:
        return bool(os.environ.get("PGHOST"))

    async def get_pool(self) -> Optional[asyncpg.Pool]:
        if not self.configured:
            self._demo_mode = True
            return None
        if self._pool is not None:
            return self._pool
        async with self._lock:
            if self._pool is not None:
                return self._pool
            try:
                password = os.environ.get("PGPASSWORD") or get_oauth_token()
                self._pool = await asyncpg.create_pool(
                    host=os.environ["PGHOST"],
                    port=int(os.environ.get("PGPORT", "5432")),
                    database=os.environ.get("PGDATABASE", "app"),
                    user=os.environ["PGUSER"],
                    password=password,
                    # PGSSLMODE=disable is for a local Postgres in tests only.
                    ssl=None if os.environ.get("PGSSLMODE") == "disable" else "require",
                    min_size=2,
                    max_size=10,
                    command_timeout=30,
                )
                self._demo_mode = False
            except Exception as exc:  # noqa: BLE001
                # No-database mode is a legitimate state (Lakebase not configured),
                # but arriving here with PGHOST set is a real failure to surface.
                logger.warning(
                    "Lakebase connection failed (%s: %s) — running without a database; "
                    "reads return empty and writes are no-ops", type(exc).__name__, exc)
                self._demo_mode = True
                self._pool = None
        return self._pool

    async def refresh_token(self) -> None:
        async with self._lock:
            if self._pool is not None:
                await self._pool.close()
                self._pool = None
        await self.get_pool()

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def _run(self, method: str, sql: str, *args):
        pool = await self.get_pool()
        if pool is None:
            return None
        try:
            async with pool.acquire() as conn:
                return await getattr(conn, method)(sql, *args)
        except _AUTH_ERRORS:
            await self.refresh_token()
            pool = await self.get_pool()
            if pool is None:
                return None
            async with pool.acquire() as conn:
                return await getattr(conn, method)(sql, *args)

    async def fetch(self, sql: str, *args):
        return (await self._run("fetch", sql, *args)) or []

    async def execute(self, sql: str, *args):
        return await self._run("execute", sql, *args)

    async def executemany(self, sql: str, rows: list[tuple]):
        if not rows:
            return None
        return await self._run("executemany", sql, rows)

    @contextlib.asynccontextmanager
    async def transaction(self):
        """A connection-bound transaction. Yields an object with the same
        fetch/execute methods, so callers don't care which backend they're on."""
        pool = await self.get_pool()
        if pool is None:
            raise RuntimeError("no database connection")
        async with pool.acquire() as conn:
            async with conn.transaction():
                yield conn

    async def run_script(self, sql: str) -> None:
        """Run a multi-statement migration script in one transaction."""
        async with self.transaction() as conn:
            await conn.execute(sql)

    async def periodic(self) -> None:
        if self.configured and not self._demo_mode:
            await self.refresh_token()
            logger.info("Lakebase OAuth token refreshed")
