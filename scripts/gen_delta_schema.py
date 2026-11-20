"""MAINTAINER TOOL — derive the Delta schema + table metadata from the Postgres schema.

Postgres (server/migrations/) is the schema of record. This reads a database that
has every Postgres migration applied (a scratch local Postgres is fine) and writes:

  server/storage/schema_meta.json   per table: columns, primary key, unique keys,
                                    serial (auto-id) column, foreign keys + ON DELETE
                                    action, column defaults. The Delta backend uses it
                                    to turn upserts into MERGE, emulate RETURNING and
                                    ON DELETE CASCADE, and generate ids.
  server/migrations_delta/NNN_*.sql
                                    one file per Postgres migration: CREATE TABLE /
                                    CREATE VIEW statements for the tables it creates.

tests/test_storage_schema.py fails if the two drift apart, so after adding a
Postgres migration, add the matching Delta migration and re-run this.

    python scripts/gen_delta_schema.py --dsn postgresql://postgres@localhost:5432/app
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "server" / "storage" / "schema_meta.json"
PG_MIGRATIONS = ROOT / "server" / "migrations"
DELTA_MIGRATIONS = ROOT / "server" / "migrations_delta"

# Integers are BIGINT in Delta: the Delta backend generates time-based ids
# (storage/delta.py _IdAllocator) that exceed 32 bits.
TYPE_MAP = {
    "integer": "BIGINT", "bigint": "BIGINT", "smallint": "BIGINT", "boolean": "BOOLEAN",
    "text": "STRING", "character varying": "STRING", "uuid": "STRING", "jsonb": "STRING",
    "json": "STRING", "timestamp with time zone": "TIMESTAMP",
    "timestamp without time zone": "TIMESTAMP", "date": "DATE", "numeric": "DECIMAL(38,10)",
    "double precision": "DOUBLE", "real": "DOUBLE", "bytea": "BINARY",
}


def delta_type(data_type: str, udt: str) -> str:
    if data_type == "ARRAY":
        inner = {"_text": "STRING", "_int4": "BIGINT", "_int8": "BIGINT", "_varchar": "STRING"}[udt]
        return f"ARRAY<{inner}>"
    return TYPE_MAP[data_type]


def delta_default(default: str | None, dtype: str) -> str | None:
    """Translate a Postgres column default to a Delta literal (None = no default)."""
    if default is None or default.startswith("nextval("):
        return None
    d = default
    if d in ("now()", "CURRENT_TIMESTAMP"):
        return "current_timestamp()"
    d = re.sub(r"::[a-z ]+(\[\])?$", "", d)  # drop the trailing cast
    if dtype.startswith("ARRAY"):
        return "array()" if d.strip("'") in ("{}",) else None
    if d in ("true", "false") or re.fullmatch(r"-?\d+(\.\d+)?", d):
        return d
    if d.startswith("'") and d.endswith("'"):
        return d
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", required=True)
    ap.add_argument("--force", action="store_true",
                    help="also rewrite Delta migration files that already exist (never do this "
                         "for a file any installation has applied: the migrator checksums it)")
    args = ap.parse_args()
    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    cur.execute("""SELECT table_name FROM information_schema.tables
                   WHERE table_schema='public' AND table_type='BASE TABLE'
                   ORDER BY table_name""")
    tables = [r[0] for r in cur.fetchall()]
    meta: dict = {}
    for t in tables:
        cur.execute("""SELECT column_name, data_type, udt_name, is_nullable, column_default
                       FROM information_schema.columns WHERE table_schema='public' AND table_name=%s
                       ORDER BY ordinal_position""", (t,))
        cols, serial = [], None
        for name, dt, udt, nullable, default in cur.fetchall():
            if dt == "tsvector":
                # Postgres full-text index column; Delta search falls back to ILIKE
                # (server/knowledge.py), so the column has no Delta counterpart.
                continue
            dtype = delta_type(dt, udt)
            if default and default.startswith("nextval("):
                serial = name
            cols.append({"name": name, "type": dtype, "pg_type": dt if dt != "ARRAY" else udt,
                         "nullable": nullable == "YES", "default": delta_default(default, dtype)})
        cur.execute("""SELECT c.conname, c.contype, array_agg(a.attname ORDER BY k.ord)
                       FROM pg_constraint c
                       JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
                       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
                       WHERE c.conrelid=%s::regclass AND c.contype IN ('p','u')
                       GROUP BY c.conname, c.contype ORDER BY c.conname""", (t,))
        pk, uniques = [], []
        for _name, kind, colnames in cur.fetchall():
            (pk.extend(colnames) if kind == "p" else uniques.append(list(colnames)))
        # Unique INDEXES (not constraints) also back ON CONFLICT targets.
        cur.execute("""SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=%s
                       AND indexdef LIKE 'CREATE UNIQUE INDEX%%'""", (t,))
        for (indexdef,) in cur.fetchall():
            m = re.search(r"\((.+)\)(?: WHERE (.+))?$", indexdef)
            keycols = [c.strip() for c in m.group(1).split(",")]
            if all(re.fullmatch(r"[a-z_]+", c) for c in keycols) and keycols not in uniques and keycols != pk:
                uniques.append(keycols)
        cur.execute("""SELECT a.attname, cl.relname, af.attname, c.confdeltype
                       FROM pg_constraint c
                       JOIN pg_class cl ON cl.oid=c.confrelid
                       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
                       JOIN pg_attribute af ON af.attrelid=c.confrelid AND af.attnum=c.confkey[1]
                       WHERE c.conrelid=%s::regclass AND c.contype='f'
                       ORDER BY c.conname""", (t,))
        on_delete = {"c": "cascade", "n": "set_null", "a": "no_action", "r": "restrict", "d": "set_default"}
        fks = [{"column": col, "ref_table": rt, "ref_column": rc, "on_delete": on_delete[act]}
               for col, rt, rc, act in cur.fetchall()]
        meta[t] = {"columns": cols, "primary_key": pk, "unique": uniques, "serial": serial,
                   "foreign_keys": fks}

    cur.execute("SELECT viewname, definition FROM pg_views WHERE schemaname='public' ORDER BY viewname")
    views = cur.fetchall()

    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps({"tables": meta, "views": [v[0] for v in views]}, indent=1) + "\n")

    import sqlglot

    def table_ddl(t: str, m: dict) -> str:
        lines = []
        for c in m["columns"]:
            line = f"  {c['name']} {c['type']}"
            if not c["nullable"]:
                line += " NOT NULL"
            # Delta rejects DEFAULT on ARRAY columns; the backend fills every omitted
            # column's default explicitly on insert (storage/delta.py), so the
            # metadata keeps it even where the DDL cannot.
            if c["default"] is not None and not c["type"].startswith("ARRAY"):
                line += f" DEFAULT {c['default']}"
            lines.append(line)
        return (f"CREATE TABLE IF NOT EXISTS ${{catalog}}.${{schema}}.{t} (\n" + ",\n".join(lines)
                + "\n) TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported',"
                " 'delta.enableDeletionVectors' = 'true', 'delta.enableRowTracking' = 'true');")

    # One Delta file per Postgres migration, holding the tables (and views) that
    # migration creates. Applied Delta files are checksummed by the migrator, so a
    # later migration must never rewrite an earlier file's DDL.
    view_defs = dict(views)
    written = []
    for pg_file in sorted(PG_MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        sql = pg_file.read_text()
        created = re.findall(r"CREATE TABLE public\.(\w+) \(", sql)
        created_views = re.findall(r"CREATE (?:OR REPLACE )?VIEW public\.(\w+)", sql)
        if pg_file.name.startswith("001_"):
            out = ["-- Delta baseline schema. GENERATED by scripts/gen_delta_schema.py from the",
                   "-- Postgres schema of record (server/migrations/). Do not hand-edit; add a new",
                   "-- numbered file for later changes. ${catalog}.${schema} is substituted at apply time.",
                   ""]
        else:
            out = [f"-- Delta counterpart of server/migrations/{pg_file.name}. GENERATED by",
                   "-- scripts/gen_delta_schema.py. Do not hand-edit. ${catalog}.${schema} is",
                   "-- substituted at apply time.",
                   ""]
        for t in [t for t in meta if t in created and t != "schema_migrations"]:
            out.append(table_ddl(t, meta[t]))
            out.append("")
        for name in [v for v, _ in views if v in created_views]:
            body = sqlglot.transpile(view_defs[name].strip().rstrip(";"), read="postgres", write="databricks")[0]
            out.append(f"CREATE OR REPLACE VIEW ${{catalog}}.${{schema}}.{name} AS {body};")
            out.append("")
        target = DELTA_MIGRATIONS / pg_file.name
        if target.exists() and not args.force:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(out))
        written.append(target.name)
    print(f"wrote {META} ({len(meta)} tables, {len(views)} views) and "
          f"server/migrations_delta/{{{', '.join(written)}}}")


if __name__ == "__main__":
    main()
