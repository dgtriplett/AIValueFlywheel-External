"""The two storage backends describe the same schema, and its invariants hold.

WHY THIS IS TESTED
------------------
Postgres (server/migrations/) is the schema of record; the Delta schema
(server/migrations_delta/) and the metadata the Delta backend relies on
(server/storage/schema_meta.json — keys, auto-ids, foreign-key cascades) are
generated from it by scripts/gen_delta_schema.py. If someone adds a Postgres
migration and forgets to regenerate, the Delta backend runs against a schema that
is missing a column — and fails only on whichever endpoint touches it.

Also pins schema invariants that used to be asserted against individual migration
files (uniqueness, cascades, what is deliberately NOT foreign-keyed).
"""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PG_FILES = sorted((ROOT / "server" / "migrations").glob("[0-9][0-9][0-9]_*.sql"))
DELTA_FILES = sorted((ROOT / "server" / "migrations_delta").glob("[0-9][0-9][0-9]_*.sql"))
PG = "\n".join(f.read_text() for f in PG_FILES)
DELTA = "\n".join(f.read_text() for f in DELTA_FILES)
META = json.loads((ROOT / "server" / "storage" / "schema_meta.json").read_text())["tables"]


def pg_tables() -> dict[str, list[str]]:
    out = {}
    for m in re.finditer(r"CREATE TABLE public\.(\w+) \((.*?)\n\);", PG, re.S):
        cols = []
        for line in m.group(2).split("\n"):
            line = line.strip().rstrip(",")
            if not line or line.split()[0].upper() in ("CONSTRAINT", "CHECK", "PRIMARY", "UNIQUE", "FOREIGN"):
                continue
            if " GENERATED ALWAYS AS " in line and "tsvector" in line:
                continue  # full-text column, Postgres only
            cols.append(line.split()[0])
        out[m.group(1)] = cols
    return out


class TestBackendsDescribeTheSameSchema(unittest.TestCase):
    def test_every_postgres_migration_has_a_delta_counterpart(self):
        """The migrator applies each backend's files by name; a Postgres migration
        with no Delta twin leaves the Delta backend a version behind."""
        self.assertEqual([f.name for f in PG_FILES], [f.name for f in DELTA_FILES])

    def test_metadata_covers_every_postgres_table_and_column(self):
        for table, cols in pg_tables().items():
            with self.subTest(table=table):
                self.assertIn(table, META, f"{table} missing — re-run scripts/gen_delta_schema.py")
                self.assertEqual([c["name"] for c in META[table]["columns"]], cols)

    def test_delta_ddl_creates_every_table(self):
        for table in pg_tables():
            self.assertIn(f"${{catalog}}.${{schema}}.{table} (", DELTA, table)

    def test_every_table_has_a_primary_key(self):
        """MERGE, RETURNING emulation and cascades all key on it."""
        missing = [t for t, m in META.items() if not m["primary_key"]]
        self.assertEqual(missing, [])

    def test_auto_ids_are_wide_on_delta(self):
        """Delta-generated ids exceed 32 bits; an INT column would overflow."""
        self.assertNotRegex(DELTA, r"\bINT\b(?!>)")


class TestSchemaInvariants(unittest.TestCase):
    def test_knowledge_base_uniqueness(self):
        self.assertIn(["article_id", "version"], META["kb_article_versions"]["unique"])
        self.assertIn(["article_id", "entity_type", "entity_id", "relation"],
                      META["kb_links"]["unique"])
        self.assertIn(["slug"], META["kb_articles"]["unique"])

    def test_article_children_cascade(self):
        for child in ("kb_article_versions", "kb_links", "kb_attachments"):
            fks = [f for f in META[child]["foreign_keys"] if f["ref_table"] == "kb_articles"]
            with self.subTest(child=child):
                self.assertTrue(fks and all(f["on_delete"] == "cascade" for f in fks))

    def test_use_case_edges_cascade(self):
        """Deleting a use case must take its requirement and dependency edges with it
        (emulated on Delta from this metadata)."""
        for child in ("uc_requires_asset", "uc_requires_domain", "uc_enables_uc"):
            fks = [f for f in META[child]["foreign_keys"] if f["ref_table"] == "use_cases"]
            with self.subTest(child=child):
                self.assertTrue(fks and all(f["on_delete"] == "cascade" for f in fks))

    def test_snapshots_store_figures_not_references(self):
        """A value snapshot is a record of what the numbers WERE; it must survive the
        use cases and assets it summarized being edited or deleted."""
        refs = {f["ref_table"] for f in META["value_snapshots"]["foreign_keys"]}
        self.assertEqual(refs, {"accounts"})

    def test_title_uniqueness_is_case_insensitive(self):
        self.assertRegex(PG, r"CREATE UNIQUE INDEX \w+ ON public\.use_cases USING btree \(lower\(title\)\)")


if __name__ == "__main__":
    unittest.main()
