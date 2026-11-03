"""The use-case authoring agent's rules (server/authoring.py).

WHY THESE ARE TESTED
--------------------
A person types one use case; the agent proposes every mapping; the reviewer
accepts. The write that follows inserts foreign keys and dependency edges into
the graph that readiness and phase are computed from. If a hallucinated id got
through, the confirm would 500 on an FK; if a cycle got through, phase would be
undefined for every use case on that loop — quietly, with no error.

THE PROPERTIES THAT MATTER MOST
-------------------------------
Only catalog ids survive validation (and the reviewer is told what was dropped),
and no accepted edge can close a cycle in the enables graph.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import authoring as au  # noqa: E402

CAT = dict(lob_ids={1, 2}, domain_names={"meter_reads", "work_orders"},
           asset_ids={10, 11, 12}, use_case_ids={100, 101, 102})


def _raw(**over):
    raw = {
        "title": "Transformer Overload Prediction",
        "description": "Predict overloads from AMI.",
        "sub_vertical": "cross", "effort_tshirt": "L", "lob_id": 1,
        "domains": [{"name": "meter_reads", "necessity": "required", "rationale": "AMI."}],
        "data_assets": [{"id": 10, "criticality": "required", "rationale": "Interval reads."}],
        "prerequisites": [{"id": 100, "rationale": "Needs the meter model."}],
        "enables": [{"id": 101, "rationale": "Feeds planning."}],
    }
    raw.update(over)
    return raw


class TestValidation(unittest.TestCase):
    def test_happy_path_keeps_everything(self):
        p, w = au.validate_proposal(_raw(), {}, **CAT)
        self.assertEqual(w, [])
        self.assertEqual([a["id"] for a in p["data_assets"]], [10])
        self.assertEqual([e["id"] for e in p["prerequisites"]], [100])
        self.assertEqual(p["effort_tshirt"], "L")

    def test_hallucinated_ids_dropped_and_reported(self):
        p, w = au.validate_proposal(_raw(
            data_assets=[{"id": 999, "criticality": "required"}, {"id": "11"}],
            domains=[{"name": "made_up"}],
            enables=[{"id": 555}]), {}, **CAT)
        self.assertEqual([a["id"] for a in p["data_assets"]], [11])  # "11" coerced
        self.assertEqual(p["domains"], [])
        self.assertEqual(p["enables"], [])
        self.assertEqual(len(w), 3)

    def test_unknown_lob_cleared(self):
        p, w = au.validate_proposal(_raw(lob_id=77), {"lob_id": None}, **CAT)
        self.assertIsNone(p["lob_id"])
        self.assertTrue(w)

    def test_self_edge_dropped_on_remap(self):
        p, _ = au.validate_proposal(_raw(prerequisites=[{"id": 100}]), {"use_case_id": 100}, **CAT)
        self.assertEqual(p["prerequisites"], [])

    def test_edge_cannot_be_both_prerequisite_and_enabled(self):
        p, w = au.validate_proposal(_raw(prerequisites=[{"id": 101}], enables=[{"id": 101}]), {}, **CAT)
        self.assertEqual([e["id"] for e in p["prerequisites"]], [101])
        self.assertEqual(p["enables"], [])
        self.assertTrue(w)

    def test_enums_coerced(self):
        p, _ = au.validate_proposal(_raw(effort_tshirt="huge", sub_vertical="space"), {}, **CAT)
        self.assertEqual((p["effort_tshirt"], p["sub_vertical"]), ("M", "cross"))

    def test_duplicates_removed(self):
        p, _ = au.validate_proposal(_raw(data_assets=[{"id": 10}, {"id": 10}]), {}, **CAT)
        self.assertEqual(len(p["data_assets"]), 1)

    def test_falls_back_to_draft_title(self):
        p, _ = au.validate_proposal({"title": ""}, {"title": "My use case"}, **CAT)
        self.assertEqual(p["title"], "My use case")

    def test_garbage_payload_is_safe(self):
        p, w = au.validate_proposal("not a dict", {"title": "X"}, **CAT)
        self.assertEqual(p["data_assets"], [])
        self.assertEqual(p["title"], "X")


class TestCycles(unittest.TestCase):
    def test_enabling_an_ancestor_is_dropped(self):
        # 100 -> 101 exists. New node: prerequisite 101, enables 100 => 101->new->100->101.
        p = {"prerequisites": [{"id": 101}], "enables": [{"id": 100}]}
        w = au.drop_cycle_edges(p, [(100, 101)])
        self.assertEqual(p["enables"], [])
        self.assertEqual(len(w), 1)

    def test_independent_edges_kept(self):
        p = {"prerequisites": [{"id": 100}], "enables": [{"id": 102}]}
        self.assertEqual(au.drop_cycle_edges(p, [(100, 101)]), [])
        self.assertEqual(len(p["enables"]), 1)

    def test_remap_ignores_the_nodes_own_old_edges(self):
        # Old: 5 -> 100. Remap of 5 now says 100 is a prerequisite (100 -> 5): no cycle
        # once the old edge is replaced.
        p = {"prerequisites": [{"id": 100}], "enables": []}
        self.assertEqual(au.drop_cycle_edges(p, [(5, 100)], node_id=5), [])
        self.assertEqual(len(p["prerequisites"]), 1)


class TestPromptAndFallback(unittest.TestCase):
    def test_prompt_lists_only_catalog_ids(self):
        prompt = au.build_prompt(
            {"title": "Leak detection", "description": "gas"},
            lobs=[{"id": 1, "name": "Gas"}],
            domains=[{"name": "meter_reads", "label": "Meter reads"}],
            assets=[{"id": 10, "source_category": "AMI", "module": "Interval reads"}],
            use_cases=[{"id": 100, "title": "Meter health", "phase": 1}])
        for needle in ("Leak detection", "1 | Gas", "meter_reads", "10 | AMI | Interval reads",
                       "100 | Meter health | phase 1", "never invent"):
            self.assertIn(needle, prompt)

    def test_heuristic_matches_keywords_and_adds_no_edges(self):
        p = au.heuristic_proposal(
            {"title": "Meter outage detection", "description": "Use interval reads"},
            domains=[{"name": "meter_reads", "label": "Meter reads"}],
            assets=[{"id": 10, "source_category": "AMI", "module": "Interval reads"},
                    {"id": 11, "source_category": "ERP", "module": "General ledger"}])
        self.assertEqual([a["id"] for a in p["data_assets"]], [10])
        self.assertEqual(p["prerequisites"] + p["enables"], [])


if __name__ == "__main__":
    unittest.main()
