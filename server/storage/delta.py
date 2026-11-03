"""Delta backend: app state in Unity Catalog Delta tables, through a SQL warehouse.

For workspaces where Lakebase is not approved. Every statement the app issues is
Postgres SQL; storage/translate.py turns it into a plan this module executes.

TRADE-OFFS (documented in CONFIGURATION.md)
-------------------------------------------
* Latency: each statement is a warehouse round trip (~0.1–0.5 s inside Databricks
  Apps; the first one after the warehouse auto-stops can take several seconds).
  Reads are cached in-process and invalidated by writes to the tables they read.
* Concurrency: Delta uses optimistic concurrency. Conflicting concurrent writes
  to the same table are retried; suited to one team's planning workload, not a
  high-write OLTP system.
* Integrity: Delta does not enforce foreign keys, so ON DELETE CASCADE / SET NULL
  are emulated here from server/storage/schema_meta.json.
* The warehouse must be running whenever the app is used.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import threading
import time
from datetime import timezone

from sqlglot import exp

from . import translate as tr
from .rows import Row

logger = logging.getLogger(__name__)

_CACHE_TTL_S = float(os.environ.get("DELTA_CACHE_TTL_S", "30"))
_POOL_SIZE = int(os.environ.get("DELTA_POOL_SIZE", "4"))
_RETRIES = 4
_CONFLICT = re.compile(r"Concurrent|DELTA_CONCURRENT|ConcurrentAppend|ConcurrentDelete|"
                       r"MetadataChanged|ProtocolChanged", re.I)


class _IdAllocator:
    """Unique ids for auto-increment columns. Time-based (ms * 1000 + counter) so
    ids stay ordered by creation, never collide with the reference catalog's small
    ids, and remain below 2**53 (safe as JavaScript numbers)."""

    def __init__(self) -> None:
        self._last = 0
        self._lock = threading.Lock()

    def next(self, n: int = 1) -> int:
        with self._lock:
            base = max(int(time.time() * 1000) * 1000, self._last + 1)
            self._last = base + n - 1
            return base


class DeltaBackend:
    name = "delta"
    dialect = "databricks"

    def __init__(self) -> None:
        self.catalog = os.environ.get("DELTA_CATALOG", "").strip()
        self.schema = os.environ.get("DELTA_SCHEMA", "").strip()
        self.warehouse_id = os.environ.get("DATABRICKS_WAREHOUSE_ID", "").strip()
        self._pool: list = []
        self._pool_lock = threading.Lock()
        self._sem = asyncio.Semaphore(_POOL_SIZE)
        self._ids = _IdAllocator()
        self._cache: dict[str, tuple[float, list, frozenset]] = {}
        self._demo_mode = not self.configured
        self._cfg = None

    # -- connection ---------------------------------------------------------
    @property
    def configured(self) -> bool:
        return bool(self.catalog and self.schema and self.warehouse_id)

    @property
    def is_demo_mode(self) -> bool:
        return self._demo_mode

    def _connect(self):
        from databricks import sql
        from databricks.sdk.core import Config

        if self._cfg is None:
            self._cfg = Config()
        cfg = self._cfg
        return sql.connect(
            server_hostname=cfg.host.replace("https://", "").rstrip("/"),
            http_path=f"/sql/1.0/warehouses/{self.warehouse_id}",
            credentials_provider=lambda: cfg.authenticate,
            catalog=self.catalog, schema=self.schema,
            session_configuration={"TIMEZONE": "UTC", "ANSI_MODE": "true"},
            user_agent_entry="ai-value-flywheel",
        )

    def _checkout(self):
        with self._pool_lock:
            if self._pool:
                return self._pool.pop()
        return self._connect()

    def _checkin(self, conn) -> None:
        with self._pool_lock:
            if len(self._pool) < _POOL_SIZE:
                self._pool.append(conn)
                return
        with contextlib.suppress(Exception):
            conn.close()

    def _run_sync(self, sql: str) -> tuple[list, list[str], list[str]]:
        """Run one statement; returns (rows, column names, column type codes)."""
        last_exc = None
        for attempt in range(_RETRIES):
            conn = None
            try:
                conn = self._checkout()
                with conn.cursor() as cur:
                    cur.execute(sql)
                    desc = cur.description or []
                    rows = cur.fetchall() if desc else []
                self._checkin(conn)
                self._demo_mode = False
                return rows, [d[0] for d in desc], [str(d[1]).lower() for d in desc]
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if conn is not None:
                    with contextlib.suppress(Exception):
                        conn.close()
                if _CONFLICT.search(str(exc)) and attempt < _RETRIES - 1:
                    time.sleep(0.2 * (2 ** attempt))
                    continue
                if "Invalid access token" in str(exc) or "401" in str(exc):
                    self._cfg = None
                    if attempt < _RETRIES - 1:
                        continue
                raise
        raise last_exc  # pragma: no cover

    async def _run(self, sql: str) -> tuple[list, list[str], list[str]]:
        logger.debug("delta sql: %s", sql[:500])
        async with self._sem:
            return await asyncio.to_thread(self._run_sync, sql)

    # -- result conversion --------------------------------------------------
    @staticmethod
    def _convert(value, type_code: str):
        if value is None:
            return None
        if type_code.startswith("timestamp") and getattr(value, "tzinfo", 1) is None:
            return value.replace(tzinfo=timezone.utc)
        if type_code in ("array", "map", "struct") and isinstance(value, str):
            with contextlib.suppress(ValueError):
                return json.loads(value)
        if hasattr(value, "tolist"):
            return value.tolist()
        return value

    def _rows(self, raw: list, names: list[str], types: list[str]) -> list[Row]:
        return [Row(names, [self._convert(v, t) for v, t in zip(r, types)]) for r in raw]

    # -- cache --------------------------------------------------------------
    def _invalidate(self, *tables: str) -> None:
        if not tables:
            self._cache.clear()
            return
        hit = set(tables)
        for key in [k for k, (_, _, ts) in self._cache.items() if ts & hit]:
            self._cache.pop(key, None)
        # Views read other tables; drop anything that reads one.
        for key in [k for k, (_, _, ts) in self._cache.items() if "asset_status_by_account" in ts]:
            self._cache.pop(key, None)

    @staticmethod
    def _tables_of(tree: exp.Expression) -> frozenset:
        return frozenset(t.name for t in tree.find_all(exp.Table))

    # -- public API ---------------------------------------------------------
    async def fetch(self, sql: str, *args) -> list[Row]:
        rows, _ = await self._execute(sql, args)
        return rows

    async def execute(self, sql: str, *args):
        _, status = await self._execute(sql, args)
        return status

    async def executemany(self, sql: str, rows: list[tuple]):
        """Batched insert/upsert: one statement per chunk instead of per row."""
        if not rows:
            return None
        p = tr.prepare(sql)
        params_in_update = any(v.find(exp.Placeholder) for _, v in p.update_set) or (
            p.update_where is not None and p.update_where.find(exp.Placeholder))
        if (p.kind not in ("insert", "merge") or p.rows is None or len(p.rows) != 1
                or params_in_update):
            for r in rows:
                await self.execute(sql, *r)
            return None
        for i in range(0, len(rows), 200):
            chunk = rows[i:i + 200]
            await self._insert_like(p, chunk)
        return None

    async def close(self) -> None:
        with self._pool_lock:
            pool, self._pool = self._pool, []
        for conn in pool:
            with contextlib.suppress(Exception):
                conn.close()

    async def refresh_token(self) -> None:
        self._cfg = None

    async def periodic(self) -> None:
        return None

    async def get_pool(self):
        """Compatibility shim for code that only checks connectivity."""
        return self if self.configured else None

    @contextlib.asynccontextmanager
    async def transaction(self):
        """Delta has no multi-statement transactions; statements apply in order."""
        yield self

    async def run_script(self, sql: str) -> None:
        sql = sql.replace("${catalog}", f"`{self.catalog}`").replace("${schema}", f"`{self.schema}`")
        for statement in _split_statements(sql):
            await self._run(statement)
        self._invalidate()

    # -- execution ----------------------------------------------------------
    async def _execute(self, sql: str, args: tuple) -> tuple[list[Row], str | None]:
        if not self.configured:
            return [], None
        p = tr.prepare(sql)
        if p.kind == "select":
            text = tr.render(tr.bind(p.tree, args))
            cached = self._cache.get(text)
            if cached and time.monotonic() - cached[0] < _CACHE_TTL_S:
                return cached[1], None
            raw, names, types = await self._run(text)
            rows = self._rows(raw, names, types)
            self._cache[text] = (time.monotonic(), rows, self._tables_of(p.tree))
            return rows, None
        if p.kind in ("insert", "merge"):
            return await self._insert_like(p, [args])
        if p.kind == "update":
            return await self._update(p, args)
        if p.kind == "delete":
            return await self._delete(p, args)
        raw, names, types = await self._run(tr.render(tr.bind(p.tree, args)))
        self._invalidate()
        return self._rows(raw, names, types), None

    def _key_filter(self, key_cols: list[str], key_rows: list[list[str]]) -> str:
        if not key_rows:
            return "FALSE"
        if len(key_cols) == 1:
            return f"{key_cols[0]} IN ({', '.join(r[0] for r in key_rows)})"
        return " OR ".join("(" + " AND ".join(f"{c} = {v}" for c, v in zip(key_cols, r)) + ")"
                           for r in key_rows)

    async def _select_returning(self, table: str, returning, where: str) -> list[Row]:
        cols = ", ".join(tr.render(e) for e in returning)
        raw, names, types = await self._run(f"SELECT {cols} FROM {table} WHERE {where}")
        return self._rows(raw, names, types)

    async def _insert_like(self, p: tr.Prepared, arg_rows: list[tuple]) -> tuple[list[Row], str]:
        meta = tr.table_meta(p.table)
        serial = meta["serial"]
        columns = list(p.columns)
        # Columns the statement omits get their declared default explicitly (Delta
        # cannot declare some defaults, e.g. on ARRAY columns).
        defaults = [c for c in meta["columns"]
                    if c["name"] not in columns and c["name"] != serial and c.get("default") is not None]
        default_sql = [tr.render(tr.default_expr(c)) for c in defaults]
        columns += [c["name"] for c in defaults]
        add_id = bool(serial and serial not in columns)
        if add_id:
            columns.append(serial)

        if p.rows is not None:
            value_rows: list[list[str]] = []
            for args in arg_rows:
                for row in p.rows:
                    value_rows.append([tr.render(tr.bind(v, args)) for v in row] + default_sql)
            if add_id:
                base = self._ids.next(len(value_rows))
                for i, row in enumerate(value_rows):
                    row.append(str(base + i))
            source = tr.values_source(columns, value_rows)
            n_rows = len(value_rows)
        else:
            sel = tr.render(tr.bind(p.source_select, arg_rows[0]))
            aliases = ", ".join(f"c{i}" for i in range(len(p.columns)))
            proj = ", ".join([f"q.c{i} AS {c}" for i, c in enumerate(p.columns)]
                             + [f"{v} AS {d['name']}" for v, d in zip(default_sql, defaults)])
            if add_id:
                base = self._ids.next(100_000)  # reserve a block for INSERT … SELECT
                proj += f", {base} + ROW_NUMBER() OVER (ORDER BY 1) - 1 AS {serial}"
            source = f"SELECT {proj} FROM ({sel}) AS q({aliases})"
            value_rows, n_rows = None, None

        pk = meta["primary_key"]
        returning = p.returning
        key_cols = (p.conflict_keys[0] if p.kind == "merge" and p.conflict_keys else pk)

        existing: set = set()
        if returning and p.kind == "merge" and p.do_nothing and value_rows is not None:
            idx = [columns.index(c) for c in key_cols if c in columns]
            if len(idx) == len(key_cols):
                where = self._key_filter(key_cols, [[r[i] for i in idx] for r in value_rows])
                raw, _, _ = await self._run(f"SELECT {', '.join(key_cols)} FROM {p.table} WHERE {where}")
                existing = {tuple(str(v) for v in r) for r in raw}

        if p.kind == "merge":
            # Parameters inside DO UPDATE SET / WHERE bind to the (single) call's args;
            # executemany() falls back to per-row calls when they reference any.
            bind_args = arg_rows[0]
            update_set = [(c, tr.bind(v, bind_args)) for c, v in p.update_set]
            update_where = tr.bind(p.update_where, bind_args) if p.update_where is not None else None
            stmt = tr.merge_sql(p.table, columns, source, p.conflict_keys, update_set,
                                update_where, p.do_nothing)
        else:
            stmt = f"INSERT INTO {p.table} ({', '.join(columns)}) {source}"
        raw, names, _types = await self._run(stmt)
        self._invalidate(p.table)
        affected = _affected(raw, names)
        status = f"INSERT 0 {affected if affected is not None else (n_rows or 0)}"

        if not returning:
            return [], status
        if value_rows is not None:
            idx = [columns.index(c) for c in key_cols if c in columns]
            if len(idx) != len(key_cols):
                return [], status
            keys = [[r[i] for i in idx] for r in value_rows
                    if tuple(_unquote(r[i]) for i in idx) not in existing]
            if not keys:
                return [], status
            rows = await self._select_returning(p.table, returning, self._key_filter(key_cols, keys))
            return rows, status
        if add_id:
            rows = await self._select_returning(
                p.table, returning, f"{serial} >= {base} AND {serial} < {base + 100_000}")
            return rows, status
        return [], status

    async def _update(self, p: tr.Prepared, args: tuple) -> tuple[list[Row], str]:
        tree = tr.bind(p.tree, args)
        where = tree.args.get("where")
        where_sql = tr.render(where.this) if where is not None else None
        pk = tr.table_meta(p.table)["primary_key"]
        keys = None
        if p.returning:
            raw, _, _ = await self._run(
                f"SELECT {', '.join(pk)} FROM {p.table}" + (f" WHERE {where_sql}" if where_sql else ""))
            keys = [[tr.render(tr.literal(v)) for v in r] for r in raw]
        raw, names, _ = await self._run(tr.render(tree))
        self._invalidate(p.table)
        status = f"UPDATE {_affected(raw, names) or 0}"
        if not p.returning:
            return [], status
        return await self._select_returning(p.table, p.returning, self._key_filter(pk, keys)), status

    async def _delete(self, p: tr.Prepared, args: tuple) -> tuple[list[Row], str]:
        tree = tr.bind(p.tree, args)
        where = tree.args.get("where")
        where_sql = tr.render(where.this) if where is not None else None
        returned: list[Row] = []
        if p.returning:
            returned = await self._select_returning(p.table, p.returning, where_sql or "TRUE")
        touched = {p.table}
        for stmt in tr.cascade_statements(p.table, where_sql):
            await self._run(stmt)
            touched.add(stmt.split()[2] if stmt.startswith("DELETE") else stmt.split()[1])
        raw, names, _ = await self._run(tr.render(tree))
        self._invalidate(*touched)
        return returned, f"DELETE {_affected(raw, names) or 0}"


def _affected(raw: list, names: list[str]) -> int | None:
    if not raw or not names:
        return None
    row = dict(zip(names, raw[0]))
    for key in ("num_affected_rows", "num_inserted_rows"):
        if row.get(key) is not None:
            return int(row[key])
    return None


def _unquote(sql_literal: str) -> str:
    s = sql_literal.strip()
    if len(s) >= 2 and s[0] == s[-1] == "'":
        return s[1:-1].replace("\\'", "'")
    return s


def _split_statements(sql: str) -> list[str]:
    """Split a DDL script on semicolons outside quotes and comments."""
    out, buf, quote = [], [], None
    lines = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not quote and stripped.startswith("--"):
            continue
        lines.append(line)
    text = "\n".join(lines)
    for ch in text:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"', "`"):
            quote = ch
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out

