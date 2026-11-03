"""Full backup / restore of the app's state, independent of the storage backend.

A backup is one JSON document holding every row of every app table (except
short-lived confirm tokens and the migration ledger). It is what you keep before an
upgrade, and what moves an install between backends: back up from Delta, restore
into Lakebase (or the reverse) — scripts/restore.py.

Restore inserts in foreign-key order and keys every row on its primary key, so it
is safe to re-run; `replace=True` overwrites rows that already exist.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal

from .storage.translate import schema_meta

FORMAT = "ai-value-flywheel-backup/1"
SKIP = {"confirm_tokens", "schema_migrations"}


def _jsonable(v):
    if isinstance(v, Decimal):
        return float(v) if v != v.to_integral_value() else int(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return None  # binary attachments are not part of the JSON backup
    return v


def table_order() -> list[str]:
    """Tables with parents before children (foreign keys), deterministic."""
    meta = schema_meta()
    remaining = {t for t in meta if t not in SKIP}
    order: list[str] = []
    while remaining:
        ready = sorted(t for t in remaining
                       if all(f["ref_table"] == t or f["ref_table"] not in remaining
                              for f in meta[t]["foreign_keys"]))
        if not ready:  # a cycle: break it deterministically
            ready = [sorted(remaining)[0]]
        order += ready
        remaining -= set(ready)
    return order


async def export_all(db, *, app_version: str = "") -> dict:
    tables = {}
    for t in table_order():
        cols = [c["name"] for c in schema_meta()[t]["columns"]]
        rows = await db.fetch(f"SELECT {', '.join(cols)} FROM {t}")
        tables[t] = [{c: _jsonable(r[c]) for c in cols} for r in rows]
    return {"format": FORMAT, "app_version": app_version,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "storage_backend": getattr(db, "backend_name", "lakebase"), "tables": tables}


def _kinds(table: str) -> dict[str, str]:
    return {c["name"]: ("json" if c["pg_type"] in ("jsonb", "json")
                        else "array" if c["type"].startswith("ARRAY")
                        else "ts" if c["type"] == "TIMESTAMP" else "")
            for c in schema_meta()[table]["columns"]}


def _value(kind: str, v):
    if v is None:
        return None
    if kind == "json" and not isinstance(v, str):
        return json.dumps(v)
    if kind == "ts" and isinstance(v, str):
        return datetime.fromisoformat(v)
    return v


async def restore(db, backup: dict, *, replace: bool = False) -> dict[str, int]:
    if backup.get("format") != FORMAT:
        raise ValueError(f"not an AI Value Flywheel backup (format {backup.get('format')!r})")
    counts: dict[str, int] = {}
    meta = schema_meta()
    for t in table_order():
        rows = backup["tables"].get(t) or []
        if not rows:
            continue
        kinds = _kinds(t)
        cols = [c for c in rows[0] if c in kinds]
        pk = meta[t]["primary_key"]
        casts = {"json": "::jsonb", "array": "::text[]"}
        placeholders = ", ".join(f"${i + 1}{casts.get(kinds[c], '')}" for i, c in enumerate(cols))
        non_keys = [c for c in cols if c not in pk]
        action = ("DO UPDATE SET " + ", ".join(f"{c}=EXCLUDED.{c}" for c in non_keys)
                  if replace and non_keys else "DO NOTHING")
        sql = (f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({placeholders}) "
               f"ON CONFLICT ({', '.join(pk)}) {action}")
        await db.executemany(sql, [tuple(_value(kinds[c], r.get(c)) for c in cols) for r in rows])
        counts[t] = len(rows)
    if getattr(db, "backend_name", "lakebase") == "lakebase":
        for t, m in meta.items():
            if m.get("serial") and t not in SKIP:
                s = m["serial"]
                await db.execute(
                    f"SELECT setval(pg_get_serial_sequence('{t}', '{s}'), "
                    f"GREATEST((SELECT COALESCE(max({s}), 0) FROM {t}), 999999))")
    return counts
