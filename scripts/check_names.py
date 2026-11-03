"""Fail if any shipped file names a real company, a person, or an internal host.

This repo is published for customers to own. The reference catalog was curated
from real engagements, so it is the most likely place for a utility's name, a
case-study reference, or an employee's email to survive a copy. CI runs this over
every tracked file (scripts/check.py); run it directly after re-exporting the
catalog:

    python scripts/check_names.py [paths...]

Market operators and regulators (ERCOT, PJM, MISO, CAISO, FERC, NERC, ...) are
public institutions named in use-case descriptions and are NOT flagged.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Utilities / energy companies (word-boundary, case-insensitive).
COMPANIES = [
    "Eversource", "Geronimo", "CMS Energy", "Consumers Energy", "Lakeshore", "AusNet", "Ameren",
    "PG&E", "Pacific Gas", "BHE", "Berkshire Hathaway", "MidAmerican", "PacifiCorp", "NV Energy",
    "Xcel", "Duke Energy", "Dominion Energy", "Southern Company", "Georgia Power", "Exelon",
    "ComEd", "PSEG", "Con Edison", "ConEd", "National Grid", "Entergy", "FirstEnergy", "PPL Corp",
    "Avangrid", "Evergy", "DTE", "Sempra", "SDG&E", "Southern California Edison", "Edison International",
    "NextEra", "Florida Power", "Tennessee Valley", "Hydro One", "Hydro-Qu[eé]bec", "BC Hydro",
    "Ontario Power", "Enel(?! X)", "Iberdrola", "E\\.ON", "Vattenfall", "[OØ]rsted", "ScottishPower",
    "Octopus Energy", "AGL Energy", "Origin Energy", "Ausgrid", "Endeavour Energy", "Energex",
    "Powerlink", "TransGrid", "Puget Sound Energy", "Portland General", "Avista", "Idaho Power",
    "Alliant Energy", "We Energies", "NiSource", "CenterPoint", "Oncor", "Vistra", "Constellation Energy",
    "NRG Energy", "Calpine", "Talen", "AES Corp", "Pepco", "BGE", "Baltimore Gas", "Southwest Gas",
    "Spire", "Atmos", "ONE Gas", "Black Hills", "Otter Tail", "El Paso Electric", "Tucson Electric",
    "Arizona Public Service", "Salt River Project", "SMUD", "LADWP", "Seattle City Light",
]
PEOPLE_AND_HOSTS = [
    r"[A-Za-z0-9._%+-]+@databricks\.com",
    r"drew\.?triplett", r"jason\.?viel", r"Chris Allen", r"Alan Werner", r"Ravi Sakaria",
    r"adb-\d{10,}", r"fevm", r"fe-vm-", r"e2-demo", r"logfood", r"grid[-_]ops[-_]demo",
    r"ep-[a-z]+-[a-z]+-[a-z0-9]{8}",  # Lakebase endpoint hosts
]

# Company names are matched with their real capitalization (so minified JavaScript
# identifiers like `Dte` don't trip it); people and hosts case-insensitively.
_B, _E = r"(?<![A-Za-z0-9])(?:", r")(?![A-Za-z0-9])"
COMPANY_PATTERN = re.compile(_B + "|".join(COMPANIES) + _E)
PEOPLE_PATTERN = re.compile(_B + "|".join(PEOPLE_AND_HOSTS) + _E, re.IGNORECASE)

# Files allowed to contain the patterns (this file defines them).
ALLOW = {"scripts/check_names.py"}
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".xlsx", ".zip"}


def tracked_files() -> list[Path]:
    try:
        out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
        return [ROOT / p for p in out.splitlines() if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [p for p in ROOT.rglob("*") if p.is_file() and ".git" not in p.parts
                and "node_modules" not in p.parts]


def scan(paths: list[Path]) -> list[str]:
    hits = []
    for path in paths:
        rel = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)
        if rel in ALLOW or path.suffix.lower() in SKIP_SUFFIXES or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for m in [*COMPANY_PATTERN.finditer(line), *PEOPLE_PATTERN.finditer(line)]:
                hits.append(f"{rel}:{n}: '{m.group(0)}'  …{line.strip()[:120]}")
    return hits


def main() -> int:
    paths = [Path(p).resolve() for p in sys.argv[1:]] or tracked_files()
    hits = scan(paths)
    for h in hits:
        print(h)
    print(f"{len(hits)} name hit(s)" if hits else "no customer, person, or internal-host names found")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
