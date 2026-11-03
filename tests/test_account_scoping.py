import inspect
import unittest
from pathlib import Path

import tests.stubs  # noqa: F401


ROOT = Path(__file__).resolve().parents[1]


class AccountScopingRegressionTests(unittest.TestCase):
    """Guards for the tables that must never leak across accounts."""

    def test_customer_owned_crud_routes_scope_by_account(self):
        from server.routes import chat, comments, funding_requests, roadmap, values

        modules = (chat, comments, funding_requests, roadmap, values)
        for module in modules:
            with self.subTest(module=module.__name__):
                source = inspect.getsource(module)
                self.assertIn("accounts.current()", source)
                self.assertIn("account_id", source)

    def test_derived_surfaces_scope_customer_owned_rows(self):
        from server.routes import analytics, onboarding, research, use_cases

        for module in (analytics, onboarding, research, use_cases):
            with self.subTest(module=module.__name__):
                source = inspect.getsource(module)
                self.assertIn("accounts.current()", source)
                self.assertIn("account_id", source)

    def test_new_accounts_get_seeded_assumptions(self):
        from server.routes import accounts

        source = inspect.getsource(accounts)
        self.assertIn("_seed_assumptions_for_account", source)
        self.assertIn("reference.default_assumptions()", source)
        self.assertIn("INSERT INTO value_assumptions", source)

    def test_customer_tables_require_an_account(self):
        """Business-unit data must never be unowned: account_id is NOT NULL on every
        per-account table, on both storage backends (schema_meta mirrors Postgres)."""
        import json
        meta = json.loads((ROOT / "server" / "storage" / "schema_meta.json").read_text())["tables"]
        for table in ("value_records", "roadmap_items", "funding_requests", "comments",
                      "research_runs", "assumption_research", "chat_conversations"):
            with self.subTest(table=table):
                col = next(c for c in meta[table]["columns"] if c["name"] == "account_id")
                self.assertFalse(col["nullable"])

    def test_research_profile_inserts_account_id_not_singleton_id(self):
        from server.routes import research

        source = inspect.getsource(research)
        self.assertIn("(account_id, company_name", source)
        self.assertNotIn("(id, company_name", source)


if __name__ == "__main__":
    unittest.main()
