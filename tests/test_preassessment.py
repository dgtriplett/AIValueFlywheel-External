"""The pre-assessment worksheet round-trip.

WHY THIS IS TESTED
------------------
The customer fills the workbook in Excel, offline, before the session; the SA then
uploads it and the wizard pre-fills from it. Nobody watches that hop. If a label the
customer picked doesn't resolve back to its value, the answer silently disappears and
the session starts from a blank question with no error anywhere.

THE PROPERTY THAT MATTERS MOST
------------------------------
Whatever the customer picks from a dropdown must parse back to the option's VALUE, and
a legacy 2-tab checklist (sent before the full worksheet existed) must still import.
"""
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import openpyxl  # noqa: F401
except ImportError:  # pragma: no cover
    openpyxl = None

from server import preassessment_template as tmpl  # noqa: E402

QUESTIONS = [
    {"section": "Profile", "key": "profile.companyName", "kind": "text",
     "question": "Company name", "current": "Example Power & Light"},
    {"section": "Profile", "key": "profile.utilityType", "kind": "single",
     "question": "What type of utility are you?",
     "options": [{"value": "electric", "label": "Electric Utility"},
                 {"value": "electric_gas", "label": "Electric & Gas"}]},
    {"section": "Profile", "key": "profile.strategicPriorities", "kind": "multi",
     "question": "Strategic priorities",
     "options": [{"value": "reliability", "label": "Grid Reliability"},
                 {"value": "safety", "label": "Worker & Public Safety"}],
     "current": ["safety"]},
    {"section": "Infrastructure", "key": "infrastructure.cloudPlatform", "kind": "single",
     "question": "Cloud platform?", "options": [{"value": "yes", "label": "Yes"},
                                                 {"value": "partial", "label": "Partial"},
                                                 {"value": "no", "label": "No"}]},
    {"section": "Capabilities", "group": "Data Engineering",
     "key": "capability.dataEngineering.team_size", "kind": "single",
     "question": "How many data engineers?",
     "options": [{"value": "1", "label": "0 — outsourced or none"}, {"value": "3", "label": "4–10"}]},
]


def _answer(wb, sheet, key, value, option=""):
    ws = wb[sheet]
    header = [c.value for c in ws[1]]
    k, a, o = header.index("Key"), header.index("Answer"), header.index("Option")
    for row in ws.iter_rows(min_row=2):
        if row[k].value == key and (row[o].value or "") == option:
            row[a].value = value
            return
    raise AssertionError(f"row {key}/{option} not in {sheet}")


@unittest.skipIf(openpyxl is None, "openpyxl not installed")
class TestPreassessmentWorksheet(unittest.TestCase):
    def test_full_worksheet_tabs_follow_wizard_order(self):
        wb = openpyxl.load_workbook(io.BytesIO(tmpl.build_template("electric", "X", QUESTIONS)))
        self.assertEqual(wb.sheetnames, ["Instructions", "Profile", "Infrastructure", "Use Cases",
                                         "Data Sources", "Capabilities", "Lists"])
        self.assertEqual(wb["Lists"].sheet_state, "hidden")

    def test_customer_answers_round_trip_to_values(self):
        wb = openpyxl.load_workbook(io.BytesIO(tmpl.build_template(None, "X", QUESTIONS)))
        _answer(wb, "Profile", "profile.utilityType", "Electric & Gas")
        _answer(wb, "Profile", "profile.strategicPriorities", "Yes", "reliability")
        _answer(wb, "Infrastructure", "infrastructure.cloudPlatform", "Partial")
        _answer(wb, "Capabilities", "capability.dataEngineering.team_size", "4–10")
        uc_id = next(r[2] for r in wb["Use Cases"].iter_rows(min_row=2, values_only=True))
        _set_first_yes(wb["Use Cases"], 6)
        buf = io.BytesIO()
        wb.save(buf)

        out = tmpl.parse_completed(buf.getvalue())
        a = out["answers"]
        self.assertEqual(a["profile.companyName"], "Example Power & Light")  # prefilled current
        self.assertEqual(a["profile.utilityType"], "electric_gas")
        self.assertEqual(sorted(a["profile.strategicPriorities"]), ["reliability", "safety"])
        self.assertEqual(a["infrastructure.cloudPlatform"], "partial")
        self.assertEqual(a["capability.dataEngineering.team_size"], "3")
        self.assertEqual(out["useCaseIds"], [uc_id])
        self.assertEqual(out["warnings"], [])

    def test_unlisted_answer_is_warned_not_guessed(self):
        wb = openpyxl.load_workbook(io.BytesIO(tmpl.build_template(None, "", QUESTIONS)))
        _answer(wb, "Infrastructure", "infrastructure.cloudPlatform", "Sort of")
        buf = io.BytesIO()
        wb.save(buf)
        out = tmpl.parse_completed(buf.getvalue())
        self.assertNotIn("infrastructure.cloudPlatform", out["answers"])
        self.assertTrue(any("Sort of" in w for w in out["warnings"]))

    def test_legacy_two_tab_checklist_still_parses(self):
        wb = openpyxl.load_workbook(io.BytesIO(tmpl.build_template("electric", "")))
        self.assertEqual(wb.sheetnames, ["Instructions", "Use Cases", "Data Sources"])
        _set_first_yes(wb["Data Sources"], 5)
        buf = io.BytesIO()
        wb.save(buf)
        out = tmpl.parse_completed(buf.getvalue())
        self.assertEqual(out["answers"], {})
        self.assertEqual(len(out["dataSourceIds"]), 1)


def _set_first_yes(ws, col):
    ws.cell(row=2, column=col, value="Yes")


if __name__ == "__main__":
    unittest.main()
