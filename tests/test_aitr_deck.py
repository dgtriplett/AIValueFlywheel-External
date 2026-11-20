"""Importing an AI Transformation Roadmap deck (.html) as a roadmap package.

WHY THIS IS TESTED
------------------
The deck carries more than a business unit should receive: a partner value-
attribution model, staffing lanes, and tiles for work already in flight elsewhere.
The import must take only the allow-listed roadmap content, compute value as the
GROSS value to the organization, and refuse a deck it cannot clean. Synthetic deck
only; no real organization's data is in this file.
"""
import json
import unittest

from server import aitr_deck as ax
from server import roadmap_package as rp


def deck(**over) -> str:
    baseline = {
        "BUS": [{"id": "ops", "name": "Operations"}],
        "ceoPillars": [{"id": "rel", "name": "Reliability", "desc": "Keep the lights on."},
                       {"id": "cost", "name": "Affordability", "desc": "Lower bills."}],
        "buPillars": [{"id": "ops_rel", "name": "Field reliability", "desc": "Fewer truck rolls.", "bu": "ops"}],
        "useCases": [
            {"id": "veg", "name": "Vegetation risk", "desc": "Trim by risk.",
             "longDesc": "Trimming by risk avoids outages. It is worth $2M before attribution, $1M attributed.",
             "kpi": "Tree outages", "effort": "Medium", "ceo": ["rel"], "bu": ["ops_rel"],
             "top8": True, "ceoTop15": True, "buTop": {"ops": True}, "included": True, "inPipeline": False},
            {"id": "bill", "name": "Billing anomalies", "desc": "Catch bad bills.", "effort": "Low",
             "ceo": ["cost"], "bu": [], "top8": False, "ceoTop15": True, "included": True, "inPipeline": False},
            {"id": "pipe1", "name": "Live UCO from the pipeline", "desc": "Already running.",
             "ceo": ["rel"], "included": True, "inPipeline": True, "status": "live"},
            {"id": "hidden", "name": "Excluded", "ceo": ["rel"], "included": False},
        ],
    }
    consts = {
        "BASELINE": baseline,
        "BVA_SIZING": {
            "veg": {"formula": "miles x cost per mile x share x attribution",
                    "attribution": {"role": "primary", "low": 40, "base": 50, "high": 60},
                    "streams": [{"name": "Avoided restoration",
                                 "base": {"label": "Circuit miles x cost", "val": 1000000, "fmt": "usd",
                                          "src": "kb_internal_id"},
                                 "drivers": [{"label": "Share re-prioritised", "low": 20, "base": 40, "high": 60,
                                              "fmt": "pct", "src": "Public utility benchmark 2025"},
                                             {"label": "Databricks attribution", "low": 40, "base": 50,
                                              "high": 60, "fmt": "pct"}]}]},
            "pipe1": {"formula": "x", "attribution": {"base": 50},
                      "streams": [{"base": {"val": 9e9, "fmt": "usd"}, "drivers": []}]},
        },
        "VALUE_ASSUMPTIONS": {"veg": {"baseline": "1,000 miles at $1,000 a mile.",
                                      "impact": "Share 40%, primary attribution 50%."}},
        "USECASE_DETAIL": {"veg": {"burningPlatform": "Trees cause outages. BVA: $1M Databricks-attributable.",
                                   "whyDatabricks": "One governed platform.", "impact": "attributed"}},
        "PLAN_CONTENT": {"veg": {"p1head": "Trim by risk.", "pilot": "Two regions",
                                 "phases": [{"tag": "Crawl", "when": "Weeks 1-12", "title": "Score spans",
                                             "text": "Proves it.", "bullets": ["Join outages", "Score spans"]}],
                                 "team": [{"who": "Databricks", "title": "Dedicated team"}]}},
        "EFFORT_RATIONALES": {"veg": {"quadrant": "Quick Win", "reason": "Data exists."}},
        "STAGE_MAP": {"veg": "grid", "bill": "cust"},
        "VALUE_CHAIN": [{"id": "grid", "name": "Grid", "tagline": "Lines"}, {"id": "cust", "name": "Customer", "tagline": "Bills"}],
        "PLAYS": {"ceo": [{"id": "ws1", "name": "Storm-ready", "blurb": "Predict and prevent.", "ucs": ["veg", "pipe1"]}]},
        "DATA_CATEGORIES": [{"id": "assets", "name": "Assets", "tagline": "What we own"}],
        "DATA_BUCKETS": [{"id": "gis", "category": "assets", "name": "GIS", "desc": "Network"},
                         {"id": "unused", "category": "assets", "name": "Unused", "desc": "x"}],
        "UC_DATA_NEEDS": {"veg": {"buckets": ["gis"], "inferred": False}},
        "DATA_REQUIREMENTS": {"veg": {"assets": ["GIS"], "sources": ["GIS system"], "rationale": "Need the network."}},
    }
    consts.update(over)
    js = "\n".join(f"const {k} = {json.dumps(v)};" for k, v in consts.items())
    return f'<html><script>const PLAN_CUST = "Example Power & Light";\n{js}\n</script></html>'


class TestExport(unittest.TestCase):
    def setUp(self):
        self.pkg = ax.export_package(deck(), slug="example", version="2", industry="power_utilities",
                                     generated_at="2026-01-01T00:00:00+00:00")
        self.ucs = {u["id"]: u for u in self.pkg["use_cases"]}

    def test_envelope(self):
        self.assertEqual((self.pkg["format"], self.pkg["format_version"]), ("aivr.roadmap", 1))
        self.assertEqual(self.pkg["roadmap"]["id"], "example")
        self.assertEqual(self.pkg["roadmap"]["organization"], "Example Power & Light")

    def test_pipeline_and_excluded_tiles_are_left_out(self):
        self.assertEqual(set(self.ucs), {"veg", "bill"})
        self.assertEqual(self.pkg["workstreams"][0]["use_case_ids"], ["veg"])

    def test_value_is_gross_never_attributed(self):
        v = self.ucs["veg"]["value"]
        # 1,000,000 x share (20/40/60%); the attribution driver is never applied.
        self.assertEqual((v["annual_low"], v["annual_base"], v["annual_high"]), (200000, 400000, 600000))
        self.assertNotIn("attribution", json.dumps(v).lower())
        self.assertEqual(v["formula"], "miles × cost per mile × share")
        self.assertEqual(v["basis"], "1,000 miles at $1,000 a mile. Share 40%.")

    def test_internal_source_ids_are_dropped_public_names_kept(self):
        sources = [a["source"] for a in self.ucs["veg"]["value"]["assumptions"]]
        self.assertEqual(sources, [None, "Public utility benchmark 2025"])

    def test_attribution_sentences_are_removed_from_prose(self):
        self.assertEqual(self.ucs["veg"]["description"], "Trimming by risk avoids outages.")
        self.assertEqual(self.ucs["veg"]["business_problem"], "Trees cause outages.")

    def test_team_lanes_and_why_databricks_are_not_exported(self):
        s = json.dumps(self.pkg)
        self.assertNotIn("Dedicated team", s)
        self.assertNotIn("One governed platform", s)

    def test_tiers_ranks_and_effort(self):
        self.assertEqual((self.ucs["veg"]["priority_tier"], self.ucs["bill"]["priority_tier"]), ("now", "next"))
        self.assertEqual((self.ucs["veg"]["priority_rank"], self.ucs["bill"]["priority_rank"]), (1, 2))
        self.assertEqual((self.ucs["veg"]["effort"], self.ucs["bill"]["effort"]), ("M", "S"))

    def test_only_datasets_in_use_are_exported(self):
        self.assertEqual([d["id"] for d in self.pkg["datasets"]], ["gis"])

    def test_plan(self):
        p = self.ucs["veg"]["plan"]
        self.assertEqual(p["headline"], "Trim by risk.")
        self.assertEqual(p["phases"][0]["steps"], ["Join outages", "Score spans"])

    def test_business_unit_view(self):
        pkg = ax.export_package(deck(), slug="example", bu="ops")
        self.assertEqual(pkg["roadmap"]["id"], "example--ops")
        self.assertEqual([p["id"] for p in pkg["pillars"]], ["ops_rel"])
        self.assertEqual([u["id"] for u in pkg["use_cases"]], ["veg"])
        self.assertEqual(pkg["use_cases"][0]["pillar_ids"], ["ops_rel"])

    def test_unknown_bu_is_refused(self):
        with self.assertRaises(ValueError):
            ax.export_package(deck(), slug="example", bu="nope")

    def test_not_a_deck(self):
        with self.assertRaises(ValueError):
            ax.export_package("<html></html>", slug="x")

    def test_final_safety_check_catches_what_cleaning_misses(self):
        bad = deck(USECASE_DETAIL={"veg": {"burningPlatform": "Source: kb_secret_ref"}})
        with self.assertRaises(ax.UnsafeContent):
            ax.export_package(bad, slug="example")


class TestDeckToPackage(unittest.TestCase):
    def test_id_from_organization_and_version_from_file_name(self):
        pkg = ax.deck_to_package(deck(), file_name="example-power-aitr-v3.html")
        self.assertEqual((pkg["roadmap"]["id"], pkg["roadmap"]["version"]), ("example-power-light", "3"))

    def test_dated_file_name_gives_a_dated_version(self):
        pkg = ax.deck_to_package(deck(), file_name="example-aitr3-2026-11-16.html")
        self.assertEqual(pkg["roadmap"]["version"], "2026-11-16")

    def test_the_result_is_a_valid_package(self):
        norm, errors, warnings = rp.normalize(ax.deck_to_package(deck(), file_name="x-v1.html"))
        self.assertEqual((errors, warnings), ([], []))
        self.assertEqual([u["id"] for u in norm.use_cases], ["veg", "bill"])

    def test_detects_a_deck(self):
        self.assertTrue(ax.looks_like_deck(deck()))
        self.assertFalse(ax.looks_like_deck("<html><body>hello</body></html>"))

    def test_the_page_is_read_as_data_never_run(self):
        """A script in the page is just text to the reader."""
        html = deck().replace("<script>", "<script>throw new Error('ran');\n")
        self.assertEqual(len(ax.deck_to_package(html, file_name="x.html")["use_cases"]), 2)


class TestClean(unittest.TestCase):
    def test_sentence_starting_unsafe_is_dropped_whole(self):
        self.assertEqual(ax._clean("Keep this. Worth $2M before attribution, while growing."), "Keep this.")

    def test_list_keeps_safe_leading_clauses(self):
        self.assertEqual(ax._clean("Share 40%, margin 88%, primary attribution 50%."), "Share 40%, margin 88%.")

    def test_nothing_left_is_none(self):
        self.assertIsNone(ax._clean("All attributed."))


if __name__ == "__main__":
    unittest.main()
