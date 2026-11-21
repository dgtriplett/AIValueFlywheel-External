"""The roadmap package: validation, matching to the catalog, version diff, value.

WHY THIS IS TESTED
------------------
A roadmap package is a file someone uploads, produced by a tool this app does not
control. Three things must hold no matter what is in it:

  * a bad file is refused with a reason a person can act on, and a merely imperfect
    one is accepted with warnings rather than silently "fixed";
  * matching only ever SUGGESTS, and puts the right catalog use case at the top when
    the roadmap names it exactly (or says which one it is);
  * a re-import of the next version reports what actually changed, so the team can
    see the roadmap move instead of having it overwritten.
"""
import copy
import json
import unittest
from pathlib import Path

from server import roadmap_package as rp

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = json.loads((ROOT / "reference" / "example-roadmap-package.json").read_text())
SCHEMA = json.loads((ROOT / "reference" / "roadmap-package.schema.json").read_text())
CATALOG = [{"id": i, "title": u["title"], "description": u.get("description")}
           for i, u in enumerate(json.loads((ROOT / "reference" / "catalog.json").read_text())
                                 ["tables"]["use_cases"], 1)]


def pkg(**changes):
    p = copy.deepcopy(EXAMPLE)
    p.update(changes)
    return p


class TestShippedExample(unittest.TestCase):
    def test_example_is_valid_with_no_warnings(self):
        norm, errors, warnings = rp.normalize(EXAMPLE)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])
        self.assertEqual(len(norm.use_cases), len(EXAMPLE["use_cases"]))

    def test_example_uses_only_the_placeholder_organization(self):
        self.assertEqual(EXAMPLE["roadmap"]["organization"], "Example Power & Light")

    def test_schema_requires_what_the_validator_requires(self):
        self.assertEqual(set(SCHEMA["required"]), {"format", "format_version", "roadmap", "use_cases"})
        self.assertEqual(SCHEMA["properties"]["format"]["const"], rp.FORMAT)
        self.assertEqual(SCHEMA["properties"]["format_version"]["const"], rp.SUPPORTED_VERSIONS[-1])
        self.assertEqual(SCHEMA["properties"]["use_cases"]["maxItems"], rp.MAX_USE_CASES)
        self.assertEqual(SCHEMA["$defs"]["use_case"]["properties"]["priority_tier"]["enum"], list(rp.TIERS))

    def test_every_documented_use_case_field_is_read(self):
        """A field in the schema that normalize() drops is a promise the app breaks."""
        norm, _, _ = rp.normalize(EXAMPLE)
        kept = set(norm.use_cases[0])
        documented = set(SCHEMA["$defs"]["use_case"]["properties"])
        self.assertEqual(documented - kept, set())


class TestRefusals(unittest.TestCase):
    def assertRefused(self, package, fragment):
        norm, errors, _ = rp.normalize(package)
        self.assertIsNone(norm)
        self.assertTrue(any(fragment in e for e in errors), errors)

    def test_not_an_object(self):
        self.assertRefused([1, 2], "not a JSON object")

    def test_wrong_format(self):
        self.assertRefused(pkg(format="something.else"), "Not a roadmap package")

    def test_future_version(self):
        self.assertRefused(pkg(format_version=2), "Unsupported format_version")

    def test_missing_roadmap_id(self):
        p = pkg()
        del p["roadmap"]["id"]
        self.assertRefused(p, "roadmap.id is required")

    def test_no_use_cases(self):
        self.assertRefused(pkg(use_cases=[]), "non-empty list")

    def test_duplicate_use_case_ids(self):
        p = pkg()
        p["use_cases"].append(dict(p["use_cases"][0]))
        self.assertRefused(p, "duplicate id 'veg'")

    def test_use_case_without_a_name(self):
        p = pkg()
        p["use_cases"][0]["name"] = "  "
        self.assertRefused(p, "needs an id and a name")

    def test_too_many_use_cases(self):
        many = [{"id": f"u{i}", "name": f"Use case {i}"} for i in range(rp.MAX_USE_CASES + 1)]
        self.assertRefused(pkg(use_cases=many), "the limit is")


class TestWarningsNotSilentFixes(unittest.TestCase):
    def warnings_for(self, **uc_changes):
        p = pkg()
        p["use_cases"][0].update(uc_changes)
        norm, errors, warnings = rp.normalize(p)
        self.assertEqual(errors, [])
        return norm.use_cases[0], warnings

    def test_unknown_pillar_dropped_with_warning(self):
        uc, w = self.warnings_for(pillar_ids=["reliability", "moonshots"])
        self.assertEqual(uc["pillar_ids"], ["reliability"])
        self.assertTrue(any("moonshots" in x for x in w))

    def test_unknown_stage_dropped_with_warning(self):
        uc, w = self.warnings_for(stage_id="space")
        self.assertIsNone(uc["stage_id"])
        self.assertTrue(w)

    def test_unrecognised_effort_dropped_with_warning(self):
        uc, w = self.warnings_for(effort="enormous")
        self.assertIsNone(uc["effort"])
        self.assertTrue(any("effort" in x for x in w))

    def test_effort_words_map_to_tshirt_sizes(self):
        for word, size in (("Low", "S"), ("Medium", "M"), ("High", "L"), ("xl", "XL"), ("M", "M")):
            self.assertEqual(rp.effort(word), size, word)

    def test_value_range_out_of_order_is_sorted_and_reported(self):
        uc, w = self.warnings_for(value={"annual_low": 5, "annual_base": 1, "annual_high": 3})
        self.assertEqual((uc["value"]["annual_low"], uc["value"]["annual_base"], uc["value"]["annual_high"]), (1, 3, 5))
        self.assertTrue(any("out of order" in x for x in w))

    def test_negative_value_ignored_with_warning(self):
        uc, w = self.warnings_for(value={"annual_base": -10})
        self.assertIsNone(uc["value"])
        self.assertTrue(w)

    def test_value_without_range_uses_base_for_both_ends(self):
        uc, _ = self.warnings_for(value={"annual_base": "2,500,000"})
        self.assertEqual(uc["value"]["annual_low"], 2_500_000)
        self.assertEqual(uc["value"]["annual_high"], 2_500_000)

    def test_bad_tier_ignored(self):
        uc, w = self.warnings_for(priority_tier="someday")
        self.assertIsNone(uc["priority_tier"])
        self.assertTrue(w)


class TestBounds(unittest.TestCase):
    def test_long_text_is_truncated(self):
        p = pkg()
        p["use_cases"][0]["description"] = "x" * 50_000
        norm, _, _ = rp.normalize(p)
        self.assertEqual(len(norm.use_cases[0]["description"]), rp.MAX_TEXT)

    def test_ids_are_made_safe(self):
        p = pkg()
        p["use_cases"][0]["id"] = "veg <script>"
        norm, _, _ = rp.normalize(p)
        self.assertEqual(norm.use_cases[0]["id"], "veg-script")

    def test_non_numeric_value_is_not_a_value(self):
        for bad in (True, "lots", float("nan"), float("inf"), None, {"a": 1}):
            self.assertIsNone(rp._num(bad), bad)


class TestMatching(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        norm, _, _ = rp.normalize(EXAMPLE)
        cls.matches = {m["external_id"]: m for m in rp.match(norm.use_cases, CATALOG)}
        cls.title = {c["id"]: c["title"] for c in CATALOG}

    def test_exact_title_is_mapped(self):
        m = self.matches["veg"]
        self.assertEqual(m["suggestion"]["action"], "map")
        self.assertEqual(self.title[m["suggestion"]["use_case_id"]], "Predictive Vegetation Management")
        self.assertEqual(m["candidates"][0]["reason"], "same title")

    def test_the_roadmaps_own_hint_wins(self):
        m = self.matches["billing"]
        self.assertEqual(self.title[m["suggestion"]["use_case_id"]], "Billing Accuracy, Anomaly & Theft Detection")
        self.assertEqual(m["candidates"][0]["reason"], "catalog title given by the roadmap")

    def test_reworded_title_still_finds_the_catalog_use_case(self):
        m = self.matches["storm"]
        self.assertEqual(m["suggestion"]["action"], "map")
        self.assertEqual(self.title[m["suggestion"]["use_case_id"]], "Storm Impact Prediction & Crew Pre-Staging")

    def test_genuinely_new_use_case_is_suggested_as_new(self):
        for ext in ("queue", "crewassist"):
            self.assertEqual(self.matches[ext]["suggestion"]["action"], "create", ext)

    def test_related_but_different_is_shown_not_mapped(self):
        """Same topic is not the same use case: offered for review, never auto-mapped."""
        m = self.matches["wildfire"]
        self.assertEqual(m["suggestion"]["action"], "create")
        self.assertIn("Wildfire Risk & PSPS Optimization", [c["title"] for c in m["candidates"]])

    def test_candidates_are_bounded_and_ranked(self):
        for m in self.matches.values():
            self.assertLessEqual(len(m["candidates"]), 3)
            scores = [c["score"] for c in m["candidates"]]
            self.assertEqual(scores, sorted(scores, reverse=True))
            self.assertTrue(all(s >= rp.CANDIDATE_FLOOR for s in scores))

    def test_hint_by_id(self):
        norm, _, _ = rp.normalize(EXAMPLE)
        uc = dict(norm.use_cases[5], catalog_match={"id": "11", "title": None})
        m = rp.match([uc], CATALOG)[0]
        self.assertEqual(m["suggestion"], {"action": "map", "use_case_id": 11})
        self.assertEqual(m["candidates"][0]["reason"], "catalog id given by the roadmap")

    def test_empty_catalog_suggests_create(self):
        norm, _, _ = rp.normalize(EXAMPLE)
        self.assertTrue(all(m["suggestion"]["action"] == "create" for m in rp.match(norm.use_cases, [])))


class TestDiff(unittest.TestCase):
    def setUp(self):
        self.v1 = rp.normalize(EXAMPLE)[0].as_dict()

    def test_first_import_lists_everything_as_added(self):
        d = rp.diff(None, self.v1)
        self.assertTrue(d["first_import"])
        self.assertEqual(len(d["added"]), len(self.v1["use_cases"]))

    def test_same_version_has_no_changes(self):
        d = rp.diff(self.v1, self.v1)
        self.assertEqual((d["added"], d["removed"], d["changed"]), ([], [], []))

    def test_added_removed_and_changed(self):
        p = pkg()
        p["use_cases"] = [u for u in p["use_cases"] if u["id"] != "queue"]
        p["use_cases"].append({"id": "ev", "name": "EV charging load forecast"})
        p["use_cases"][0]["priority_tier"] = "later"
        p["use_cases"][1]["value"] = {"annual_base": 9_000_000}
        v2 = rp.normalize(p)[0].as_dict()
        d = rp.diff(self.v1, v2)
        self.assertEqual(d["added"], ["ev"])
        self.assertEqual(d["removed"], ["queue"])
        changed = {c["id"]: c["fields"] for c in d["changed"]}
        self.assertEqual(changed, {"veg": ["priority_tier"], "storm": ["value"]})


class TestValueFormula(unittest.TestCase):
    def test_keeps_the_base_exactly_even_for_a_lopsided_range(self):
        from server.value_engine import compute_value_range
        f = rp.value_formula({"annual_low": 1_000_000, "annual_base": 2_000_000, "annual_high": 8_000_000})
        self.assertEqual(compute_value_range(f, {}), {"low": 1.0, "mid": 2.0, "high": 8.0})
        self.assertEqual(f["source"], "roadmap")

    def test_no_value_no_formula(self):
        self.assertIsNone(rp.value_formula(None))
        self.assertIsNone(rp.value_formula({"annual_base": 0, "annual_low": 0, "annual_high": 0}))


if __name__ == "__main__":
    unittest.main()


class TestUniqueTitles(unittest.TestCase):
    """use_cases.title is unique app-wide; a second business unit creating a use case
    of the same name must get a distinct title, not crash the import half-way."""

    def run_titles(self, existing, names, unit="North"):
        import asyncio
        from unittest import mock
        from server.routes import roadmap_import as ri

        class DB:
            async def fetch(self, sql, *a):
                return [{"t": t.lower()} for t in existing]

            async def fetchrow(self, sql, *a):
                return {"name": unit}
        with mock.patch.object(ri, "db", DB()):
            return asyncio.run(ri._unique_titles(names, 1))

    def test_no_clash_keeps_the_name(self):
        self.assertEqual(self.run_titles([], ["Storm staging"]), ["Storm staging"])

    def test_clash_gets_the_business_unit_then_a_number(self):
        self.assertEqual(self.run_titles(["storm staging", "Storm staging (North)"], ["Storm staging"]),
                         ["Storm staging (North) 2"])

    def test_clash_inside_one_import(self):
        self.assertEqual(self.run_titles([], ["A", "a"]), ["A", "a (North)"])
