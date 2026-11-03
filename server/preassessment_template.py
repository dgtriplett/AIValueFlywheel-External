"""Pre-assessment Excel template generation + upload parsing.

Workflow:
  1. The assessment owner downloads a template from the first wizard step,
     before the meeting. It mirrors the whole wizard: Profile, Infrastructure,
     Use Cases, Data Sources and Capabilities tabs, each with dropdown answers.
  2. Customer answers every tab ahead of time and sends the file back.
  3. The owner uploads the completed file in the assessment UI; the API parses it
     into question answers + the IDs to pre-check, so the meeting is a review
     of the customer's answers instead of starting from a blank slate.

The Profile / Infrastructure / Capabilities questions are defined in the
frontend (frontend/src/data/preassessmentSpec.ts) and POSTed in as `questions`;
Use Cases and Data Sources come from the bundled catalog below. A workbook built
without `questions` is the legacy 2-tab checklist and still parses.
"""
from __future__ import annotations

import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Grid Compass: bundled under server/data/ (the survey catalog is the same 198-use-case
# P&U reference that generated the customer worksheets, kept byte-identical so uploads
# round-trip). DATA_SOURCES below is the canonical 31-source taxonomy.
USE_CASES_SEED = Path(__file__).resolve().parent / "data" / "use_cases_seed.json"


# Mirror of frontend/src/data/dataSources.ts. Kept inline rather than dual-
# sourced because the data sources catalog is small + stable, and this avoids
# the JS-import dance from Python.
DATA_SOURCES: list[dict] = [
    # Customer / billing
    {"id": "ds_meter_billing", "category": "Customer", "name": "Customer Information System (CIS) / billing", "description": "Account, premise, rate, billing transactions"},
    {"id": "ds_ami_meter", "category": "Customer", "name": "AMI / smart meter reads", "description": "Interval kWh / kW reads, voltage, events"},
    {"id": "ds_call_center", "category": "Customer", "name": "Call center / IVR / chat logs", "description": "Customer interaction records, call topics, AHT"},
    {"id": "ds_outage_notifications", "category": "Customer", "name": "Outage notifications / alerts", "description": "Customer-facing outage messages and acknowledgements"},
    {"id": "ds_program_enrollment", "category": "Customer", "name": "Demand response / program enrollment", "description": "Enrollment status in DR, EE, EV, TOU, NEM programs"},
    # Distribution
    {"id": "ds_outage_management", "category": "Distribution", "name": "Outage Management System (OMS)", "description": "Trouble tickets, momentary/sustained outages, restoration"},
    {"id": "ds_distribution_scada", "category": "Distribution", "name": "Distribution SCADA", "description": "Substation telemetry, switch states, feeder loading"},
    {"id": "ds_dms_adms", "category": "Distribution", "name": "DMS / ADMS state estimation", "description": "Network model state, FLISR, Volt-VAR, contingency"},
    {"id": "ds_dist_assets_gis", "category": "Distribution", "name": "GIS network model", "description": "Connectivity model, asset locations, line ratings"},
    {"id": "ds_transformer_records", "category": "Distribution", "name": "Transformer / asset records", "description": "Manufacturer, install date, ratings, condition assessments"},
    # Transmission
    {"id": "ds_trans_scada", "category": "Transmission", "name": "Transmission SCADA + EMS", "description": "Bus voltages, line flows, breaker / RTU status"},
    {"id": "ds_pmu", "category": "Transmission", "name": "Phasor measurement units (PMUs)", "description": "Synchrophasor data, oscillation events"},
    {"id": "ds_iso_market", "category": "Transmission", "name": "ISO/RTO market & operations data", "description": "LMP, congestion, capacity, ancillary, ICCP feeds"},
    {"id": "ds_weather", "category": "Transmission", "name": "Weather feeds (NOAA / vendor)", "description": "Forecasts, lightning, wind, fire-risk, ambient temp"},
    # Generation
    {"id": "ds_pi_historian", "category": "Generation", "name": "Plant historian (PI / IP.21 / Wonderware)", "description": "Continuous unit telemetry tags"},
    {"id": "ds_dcs_controls", "category": "Generation", "name": "DCS / unit-control / ICS data", "description": "Setpoints, alarms, sequence-of-events"},
    {"id": "ds_fuel_mgmt", "category": "Generation", "name": "Fuel management / coal-yard / gas-nominations", "description": "Inventory, BTU, deliveries, hedges"},
    {"id": "ds_emissions_cems", "category": "Generation", "name": "CEMS / emissions monitoring", "description": "NOx/SOx/CO2/Hg per unit, EPA reporting"},
    {"id": "ds_outage_planning", "category": "Generation", "name": "Outage / maintenance planning", "description": "Planned outage schedules, unit availability"},
    # Field & workforce
    {"id": "ds_work_management", "category": "Field & Workforce", "name": "Work management (Maximo / SAP PM / Oracle WAM)", "description": "Work orders, history, parts, labor"},
    {"id": "ds_mobile_workforce", "category": "Field & Workforce", "name": "Mobile workforce / dispatch", "description": "Crew location, ETAs, completed work"},
    {"id": "ds_safety_incidents", "category": "Field & Workforce", "name": "Safety / incident reporting", "description": "OSHA recordables, near-misses, JSAs"},
    {"id": "ds_hr_workforce", "category": "Field & Workforce", "name": "HR / workforce data", "description": "Headcount, retirement-eligible, certifications"},
    # Corporate / financial
    {"id": "ds_erp_financial", "category": "Corporate", "name": "ERP / financial (SAP / Oracle / Workday)", "description": "GL, cost centers, capex, opex"},
    {"id": "ds_procurement", "category": "Corporate", "name": "Procurement / supply chain", "description": "POs, vendors, contracts, spend categories"},
    {"id": "ds_capital_projects", "category": "Corporate", "name": "Capital project tracking", "description": "Project portfolio, milestones, EVM"},
    {"id": "ds_regulatory_filings", "category": "Corporate", "name": "Regulatory / rate-case workpapers", "description": "FERC Form 1, EIA-861, state-PUC filings"},
    # IT / OT / security
    {"id": "ds_it_observability", "category": "IT / OT / Security", "name": "IT logs / observability", "description": "Network, app, infrastructure logs"},
    {"id": "ds_ot_security", "category": "IT / OT / Security", "name": "OT security telemetry", "description": "ICS/SCADA security events, NERC CIP audit logs"},
    {"id": "ds_identity_iam", "category": "IT / OT / Security", "name": "Identity / IAM", "description": "Workforce + customer identity, SSO, entitlements"},
    {"id": "ds_geospatial", "category": "IT / OT / Security", "name": "Geospatial / drone / satellite imagery", "description": "Lidar, satellite, drone images for veg/asset inspection"},
]


def _utility_type_matches(uc_types: list[str] | None, utility_type: str | None) -> bool:
    """Match the same logic the frontend uses (questions.ts useCaseMatchesUtility)."""
    if not utility_type:
        return True
    if not uc_types:
        return True
    if "all" in uc_types:
        return True
    # Restricted: gen_only / nuclear must opt-in
    restricted = {"generation_only", "nuclear"}
    if utility_type in restricted:
        return utility_type in uc_types
    # Otherwise match any overlap
    return utility_type in uc_types or any(t in uc_types for t in ("electric", "gas", "electric_gas"))


def _filtered_use_cases(utility_type: str | None) -> list[dict]:
    raw = json.loads(USE_CASES_SEED.read_text())
    out = []
    for uc in raw:
        if _utility_type_matches(uc.get("utilityTypes"), utility_type):
            out.append(uc)
    # Stable order: phase, domain, name
    out.sort(key=lambda u: (int(u.get("phase", 1)), u.get("domain", ""), u.get("name", "")))
    return out


QUESTION_SHEETS = ("Profile", "Infrastructure", "Capabilities")
LISTS_SHEET = "Lists"


def build_template(utility_type: str | None, customer_name: str = "",
                   questions: list[dict] | None = None) -> bytes:
    """Build the Excel template. Always has Use Cases + Data Sources tabs with a
    Yes/No dropdown; when `questions` is given, also a tab per wizard section
    (Profile, Infrastructure, Capabilities) in wizard order."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.worksheet.datavalidation import DataValidation
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    # Remove default sheet
    default = wb.active
    wb.remove(default)

    # Brand-aligned styling
    HEADER_FILL = PatternFill("solid", fgColor="1B3139")
    HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="F9F7F4")
    BAND_FILL = PatternFill("solid", fgColor="EEEDE9")
    border = Border(left=Side(style="thin", color="DCE0E2"),
                    right=Side(style="thin", color="DCE0E2"),
                    top=Side(style="thin", color="DCE0E2"),
                    bottom=Side(style="thin", color="DCE0E2"))

    # ── Sheet 1: Instructions ────────────────────────────────────────────
    inst = wb.create_sheet("Instructions")
    inst["A1"] = "AI Value Flywheel — Pre-Assessment Worksheet"
    inst["A1"].font = Font(name="Calibri", size=18, bold=True, color="1B3139")
    if customer_name:
        inst["A2"] = f"Customer: {customer_name}"
        inst["A2"].font = Font(name="Calibri", size=12, color="1B3139")
    inst["A4"] = "How to use this workbook:"
    inst["A4"].font = Font(name="Calibri", size=12, bold=True, color="1B3139")
    by_section: dict[str, list[dict]] = {}
    for q in questions or []:
        if q.get("section") in QUESTION_SHEETS and q.get("key"):
            by_section.setdefault(q["section"], []).append(q)
    full = bool(by_section)
    if full:
        notes = [
            "Please complete each tab before our assessment session. Answer cells are highlighted in orange;",
            "every other column is reference. Most answers are dropdowns — pick the closest option.",
            "",
            "1. 'Profile' — company basics, the parts of the business you operate, and strategic priorities.",
            "",
            "2. 'Infrastructure' — Yes / Partial / No for each platform and data-access question.",
            "",
            "3. 'Use Cases' — set In Production to 'Yes' if the workload is live in production today",
            "   (not just a POC, not in pilot). Leave 'No' otherwise.",
            "",
            "4. 'Data Sources' — set Available to 'Yes' for each source ingested into a usable analytical",
            "   environment (e.g. Databricks / Snowflake / a warehouse, NOT just sitting in a source system).",
            "",
            "5. 'Capabilities' — pick the option that best describes your organization today.",
            "",
            "Send the completed file back to the person who sent it. They will upload it into the assessment",
            "app so the session is a review of your answers rather than filling them in live.",
            "",
            "Notes:",
            "  • If unsure, leave the answer blank (or 'No') and we will discuss it in the session.",
            "  • Don't rename tabs or edit the reference columns — the upload reads them.",
        ]
    else:
        notes = [
            "1. Open the 'Use Cases' tab. For each row, set the In Production column to 'Yes' if the workload is",
            "   live in production today (not just a POC, not in pilot). Leave 'No' otherwise.",
            "",
            "2. Open the 'Data Sources' tab. For each data source you have ingested into a usable analytical",
            "   environment (e.g. Databricks / Snowflake / a warehouse, NOT just sitting in a source system),",
            "   set Available to 'Yes'.",
            "",
            "3. Send this file back to the person who sent it, OR upload it directly in the assessment app.",
            "",
            "Notes:",
            "  • Only use cases relevant to your utility type are included to keep the list focused.",
            "  • A short description is provided for each row — if unsure, leave 'No' and it will be discussed in the session.",
            "  • The Y/N column is the only one you need to fill in. Other columns are reference.",
        ]
    for i, line in enumerate(notes, start=5):
        cell = inst.cell(row=i, column=1, value=line)
        cell.font = Font(name="Calibri", size=11, color="1B3139") if line and not line.startswith("  •") else Font(name="Calibri", size=10, color="5A6F77")
    inst.column_dimensions["A"].width = 110

    # Option lists for the question dropdowns live on a hidden sheet (Excel caps
    # inline list validations at 255 chars). Rows: key | label | value — the
    # parser resolves the chosen label back to its value from here.
    lists = wb.create_sheet(LISTS_SHEET) if full else None
    if lists is not None:
        lists.append(["Key", "Label", "Value"])
        lists.sheet_state = "hidden"

    def _question_sheet(section: str) -> None:
        rows = by_section.get(section) or []
        if not rows:
            return
        ws = wb.create_sheet(section)
        q_headers = ["Question", "Guidance", "Answer", "Key", "Option"]
        for col_idx, h in enumerate(q_headers, start=1):
            c = ws.cell(row=1, column=col_idx, value=h)
            c.font = HEADER_FONT
            c.fill = HEADER_FILL
            c.alignment = Alignment(horizontal="left", vertical="center")
            c.border = border
        ws.row_dimensions[1].height = 22
        yes_no = DataValidation(type="list", formula1='"Yes,No"', allow_blank=True, showDropDown=False)
        ws.add_data_validation(yes_no)

        def _row(question: str, guidance: str, answer, key: str, option: str = "") -> int:
            r = ws.max_row + 1
            for col_idx, val in enumerate([question, guidance, answer, key, option], start=1):
                c = ws.cell(row=r, column=col_idx, value=val)
                c.font = Font(name="Calibri", size=10, color="1B3139")
                c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
                c.border = border
            ans = ws.cell(row=r, column=3)
            ans.font = Font(name="Calibri", size=11, bold=True, color="FF3621")
            ans.fill = PatternFill("solid", fgColor="FFF1EC")
            return r

        group = None
        for q in rows:
            if q.get("group") and q["group"] != group:
                group = q["group"]
                r = ws.max_row + 1
                c = ws.cell(row=r, column=1, value=group)
                c.font = Font(name="Calibri", size=11, bold=True, color="1B3139")
                for col_idx in range(1, 4):
                    ws.cell(row=r, column=col_idx).fill = BAND_FILL
            kind = q.get("kind") or "single"
            opts = [o for o in (q.get("options") or []) if o.get("label") is not None]
            current = q.get("current")
            if kind == "multi":
                chosen = set(current or []) if isinstance(current, list) else set()
                for o in opts:
                    r = _row(f"{q.get('question', '')} — {o['label']}", q.get("help") or "",
                             "Yes" if o["value"] in chosen else "No", q["key"], str(o["value"]))
                    yes_no.add(f"C{r}")
            elif kind == "single" and opts:
                label_by_value = {str(o["value"]): o["label"] for o in opts}
                r = _row(q.get("question", ""), q.get("help") or "",
                         label_by_value.get(str(current)) if current is not None else None, q["key"])
                first = lists.max_row + 1
                for o in opts:
                    lists.append([q["key"], o["label"], str(o["value"])])
                dv = DataValidation(type="list", allow_blank=True, showDropDown=False,
                                    formula1=f"{LISTS_SHEET}!$B${first}:$B${lists.max_row}")
                dv.error = "Please pick one of the listed options"
                dv.errorTitle = "Invalid value"
                ws.add_data_validation(dv)
                dv.add(f"C{r}")
            else:
                _row(q.get("question", ""), q.get("help") or "",
                     current if isinstance(current, str) else None, q["key"])

        for c_idx, w in {1: 60, 2: 60, 3: 40}.items():
            ws.column_dimensions[get_column_letter(c_idx)].width = w
        # Key / Option are machine columns — hidden so customers don't edit them.
        ws.column_dimensions["D"].hidden = True
        ws.column_dimensions["E"].hidden = True
        ws.freeze_panes = "A2"

    _question_sheet("Profile")
    _question_sheet("Infrastructure")

    # ── Sheet: Use Cases ─────────────────────────────────────────────────
    uc_sheet = wb.create_sheet("Use Cases")
    headers = ["Phase", "Domain", "Use Case ID", "Use Case", "Description", "In Production?"]
    for col_idx, h in enumerate(headers, start=1):
        c = uc_sheet.cell(row=1, column=col_idx, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="left", vertical="center")
        c.border = border
    uc_sheet.row_dimensions[1].height = 22

    use_cases = _filtered_use_cases(utility_type)
    for row_idx, uc in enumerate(use_cases, start=2):
        cells = [
            uc.get("phase", ""),
            uc.get("domain", ""),
            uc.get("id", ""),
            uc.get("name", ""),
            (uc.get("description") or "")[:300],
            "No",
        ]
        for col_idx, val in enumerate(cells, start=1):
            c = uc_sheet.cell(row=row_idx, column=col_idx, value=val)
            c.font = Font(name="Calibri", size=10, color="1B3139")
            c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
            c.border = border
            if row_idx % 2 == 0:
                c.fill = BAND_FILL
        # Highlight the answer cell
        ans = uc_sheet.cell(row=row_idx, column=6)
        ans.font = Font(name="Calibri", size=11, bold=True, color="FF3621")
        ans.alignment = Alignment(horizontal="center", vertical="center")

    # Column widths
    widths = {1: 6, 2: 16, 3: 30, 4: 38, 5: 70, 6: 16}
    for c_idx, w in widths.items():
        uc_sheet.column_dimensions[get_column_letter(c_idx)].width = w
    uc_sheet.freeze_panes = "A2"

    # Y/N dropdown on column F
    dv = DataValidation(type="list", formula1='"Yes,No"', allow_blank=False, showDropDown=False)
    dv.error = "Please select Yes or No"
    dv.errorTitle = "Invalid value"
    dv.prompt = "Yes if this use case is live in production today"
    dv.promptTitle = "In Production?"
    uc_sheet.add_data_validation(dv)
    if len(use_cases) > 0:
        dv.add(f"F2:F{len(use_cases) + 1}")

    # ── Sheet: Data Sources ──────────────────────────────────────────────
    ds_sheet = wb.create_sheet("Data Sources")
    ds_headers = ["Category", "Data Source ID", "Data Source", "Description", "Available?"]
    for col_idx, h in enumerate(ds_headers, start=1):
        c = ds_sheet.cell(row=1, column=col_idx, value=h)
        c.font = HEADER_FONT
        c.fill = HEADER_FILL
        c.alignment = Alignment(horizontal="left", vertical="center")
        c.border = border
    ds_sheet.row_dimensions[1].height = 22

    for row_idx, ds in enumerate(DATA_SOURCES, start=2):
        cells = [
            ds.get("category", ""),
            ds.get("id", ""),
            ds.get("name", ""),
            ds.get("description", ""),
            "No",
        ]
        for col_idx, val in enumerate(cells, start=1):
            c = ds_sheet.cell(row=row_idx, column=col_idx, value=val)
            c.font = Font(name="Calibri", size=10, color="1B3139")
            c.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
            c.border = border
            if row_idx % 2 == 0:
                c.fill = BAND_FILL
        ans = ds_sheet.cell(row=row_idx, column=5)
        ans.font = Font(name="Calibri", size=11, bold=True, color="FF3621")
        ans.alignment = Alignment(horizontal="center", vertical="center")

    widths = {1: 22, 2: 28, 3: 42, 4: 70, 5: 14}
    for c_idx, w in widths.items():
        ds_sheet.column_dimensions[get_column_letter(c_idx)].width = w
    ds_sheet.freeze_panes = "A2"

    dv2 = DataValidation(type="list", formula1='"Yes,No"', allow_blank=False, showDropDown=False)
    dv2.error = "Please select Yes or No"
    dv2.errorTitle = "Invalid value"
    dv2.prompt = "Yes if this source is ingested into your analytical platform"
    dv2.promptTitle = "Available?"
    ds_sheet.add_data_validation(dv2)
    if len(DATA_SOURCES) > 0:
        dv2.add(f"E2:E{len(DATA_SOURCES) + 1}")

    _question_sheet("Capabilities")
    if lists is not None:
        # Keep the hidden lists sheet last so tab order matches the wizard.
        wb.move_sheet(LISTS_SHEET, offset=len(wb.sheetnames) - 1 - wb.sheetnames.index(LISTS_SHEET))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def parse_completed(file_bytes: bytes) -> dict:
    """Parse a completed pre-assessment workbook back into ID lists.

    Returns:
        {
          "useCaseIds": [...],
          "dataSourceIds": [...],
          "answers": {key: value | [values]},  # Profile/Infrastructure/Capabilities tabs
          "warnings": [...]   # rows skipped, IDs not found, etc.
        }
    """
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
    warnings: list[str] = []
    uc_ids: list[str] = []
    ds_ids: list[str] = []

    valid_uc_ids = {uc["id"] for uc in json.loads(USE_CASES_SEED.read_text())}
    valid_ds_ids = {ds["id"] for ds in DATA_SOURCES}

    # Use Cases tab
    if "Use Cases" in wb.sheetnames:
        ws = wb["Use Cases"]
        # Find header columns
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
        if not header_row:
            warnings.append("Use Cases tab has no header row — skipping.")
        else:
            try:
                id_col = next(i for i, h in enumerate(header_row) if h and "id" in str(h).lower())
                ans_col = next(i for i, h in enumerate(header_row) if h and ("production" in str(h).lower() or "in production" in str(h).lower()))
            except StopIteration:
                warnings.append("Couldn't locate ID + 'In Production?' columns in Use Cases tab — skipping.")
                id_col = ans_col = None
            if id_col is not None and ans_col is not None:
                for row in ws.iter_rows(min_row=2, values_only=True):
                    if not row or len(row) <= max(id_col, ans_col):
                        continue
                    uc_id = (row[id_col] or "").strip() if isinstance(row[id_col], str) else (str(row[id_col]).strip() if row[id_col] else "")
                    ans = (row[ans_col] or "").strip().lower() if isinstance(row[ans_col], str) else ""
                    if not uc_id:
                        continue
                    if ans in ("yes", "y", "true", "1"):
                        if uc_id in valid_uc_ids:
                            uc_ids.append(uc_id)
                        else:
                            warnings.append(f"Use case ID not in catalog: {uc_id}")
    else:
        warnings.append("No 'Use Cases' tab found.")

    # Data Sources tab
    if "Data Sources" in wb.sheetnames:
        ws = wb["Data Sources"]
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
        if not header_row:
            warnings.append("Data Sources tab has no header row — skipping.")
        else:
            try:
                id_col = next(i for i, h in enumerate(header_row) if h and "id" in str(h).lower())
                ans_col = next(i for i, h in enumerate(header_row) if h and "available" in str(h).lower())
            except StopIteration:
                warnings.append("Couldn't locate ID + 'Available?' columns in Data Sources tab — skipping.")
                id_col = ans_col = None
            if id_col is not None and ans_col is not None:
                for row in ws.iter_rows(min_row=2, values_only=True):
                    if not row or len(row) <= max(id_col, ans_col):
                        continue
                    ds_id = (row[id_col] or "").strip() if isinstance(row[id_col], str) else (str(row[id_col]).strip() if row[id_col] else "")
                    ans = (row[ans_col] or "").strip().lower() if isinstance(row[ans_col], str) else ""
                    if not ds_id:
                        continue
                    if ans in ("yes", "y", "true", "1"):
                        if ds_id in valid_ds_ids:
                            ds_ids.append(ds_id)
                        else:
                            warnings.append(f"Data source ID not in catalog: {ds_id}")
    else:
        warnings.append("No 'Data Sources' tab found.")

    return {
        "useCaseIds": uc_ids,
        "dataSourceIds": ds_ids,
        "answers": _parse_question_sheets(wb, warnings),
        "warnings": warnings,
    }


def _cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _parse_question_sheets(wb, warnings: list[str]) -> dict:
    """Read the Profile / Infrastructure / Capabilities tabs into {key: value}.
    Single-choice labels are resolved to values via the hidden Lists sheet;
    multi-choice questions (one Yes/No row per option) become a value list.
    Legacy 2-tab workbooks have none of these tabs and yield {}."""
    choices: dict[str, dict[str, str]] = {}
    if LISTS_SHEET in wb.sheetnames:
        for row in wb[LISTS_SHEET].iter_rows(min_row=2, values_only=True):
            if row and len(row) >= 3 and row[0]:
                key, label, value = _cell_text(row[0]), _cell_text(row[1]), _cell_text(row[2])
                choices.setdefault(key, {})[label.lower()] = value
                choices[key].setdefault(value.lower(), value)

    answers: dict = {}
    for section in QUESTION_SHEETS:
        if section not in wb.sheetnames:
            continue
        ws = wb[section]
        header = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None) or ()
        cols = {_cell_text(h).lower(): i for i, h in enumerate(header) if h}
        if not {"answer", "key"} <= cols.keys():
            warnings.append(f"Couldn't locate Answer + Key columns in {section} tab — skipping.")
            continue
        a_col, k_col, o_col = cols["answer"], cols["key"], cols.get("option")
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or len(row) <= max(a_col, k_col):
                continue
            key, ans = _cell_text(row[k_col]), _cell_text(row[a_col])
            if not key:
                continue
            option = _cell_text(row[o_col]) if o_col is not None and len(row) > o_col else ""
            if option:
                bucket = answers.setdefault(key, [])
                if ans.lower() in ("yes", "y", "true", "1"):
                    bucket.append(option)
                continue
            if not ans:
                continue
            if key in choices:
                value = choices[key].get(ans.lower())
                if value is None:
                    warnings.append(f"{section}: '{ans}' is not a listed option — skipped.")
                    continue
                answers[key] = value
            else:
                answers[key] = ans
    return answers
