"""Fail if any shipped file names a real company, a person, or an internal host.

This repo is published for customers to own. The reference catalog was curated
from real engagements, so it is the most likely place for a utility's name, a
case-study reference, or an employee's email to survive a copy. CI runs this over
every tracked file (scripts/check.py); run it directly after re-exporting the
catalog:

    python scripts/check_names.py [paths...]

Market operators and regulators (ERCOT, PJM, MISO, CAISO, FERC, NERC, ...) are
public institutions named in use-case descriptions and are NOT flagged.

Names that must not appear but must not be published either (organizations this
was built with, people, internal hosts) are checked as salted SHA-256 hashes of
normalized 1-4 word phrases (`PRIVATE_HASHES`). To add one, run
`python scripts/check_names.py --hash "Some Name"` and paste the result. A local,
untracked `.names-denylist` file (one name per line) is also honoured.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Utilities / energy companies (word-boundary, case-insensitive).
COMPANIES = [
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
    r"adb-\d{10,}",
    r"ep-[a-z]+-[a-z]+-[a-z0-9]{8}",  # Lakebase endpoint hosts
]

_SALT = "aivr-names-v1:"
PRIVATE_HASHES = frozenset({
    "019356b7beff02464f19",
    "1097ee71d4d8eb4a0745",
    "2016b9d1562661750cdf",
    "24e3acb72cab750e52c4",
    "41dafac453d738e1ef7c",
    "42f0856c25ee4bb0416d",
    "43967b37dfaa006385e0",
    "58955bed7a23b2973403",
    "6727f26c067b336a5f8f",
    "70f48bbc809b2bb08448",
    "7b6bcd6501839d8ca56d",
    "8858d15f26d509c215ec",
    "8b923b61a91d97563909",
    "8dfac852c716501686fa",
    "9cfae4d9c4a35839ad19",
    "a8d549de51e4601abc6c",
    "bebdfe146f55e679634f",
    "d5590d4723a72e42d117",
    "de3ff472989fffcb1404",
    "e2b8ba483511879929cd",
    "e33c67adfba949c0558c",
    "e92a40e3a976bd14b059",
    "ea02b4848d4e2390a8ec",
    "fa4ee639d9cdfdb7e820",
    "fdbd804b3d2638d7e4fb",
})


def _norm_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9&]+", text.lower())


def phrase_hash(phrase: str) -> str:
    return hashlib.sha256((_SALT + " ".join(_norm_words(phrase))).encode()).hexdigest()[:20]


def _local_denylist() -> frozenset[str]:
    f = ROOT / ".names-denylist"
    if not f.is_file():
        return frozenset()
    return frozenset(phrase_hash(x) for x in f.read_text().splitlines() if x.strip() and not x.startswith("#"))


def private_hits(line: str, hashes: frozenset[str]) -> list[str]:
    """Phrases of 1-4 words in `line` whose hash is on the private list."""
    words = _norm_words(line)
    found = []
    for n in (4, 3, 2, 1):
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i:i + n])
            if phrase_hash(phrase) in hashes:
                found.append(phrase)
    return found

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
    hashes = PRIVATE_HASHES | _local_denylist()
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
            for phrase in private_hits(line, hashes):
                hits.append(f"{rel}:{n}: private name '{phrase}'  …{line.strip()[:120]}")
    return hits


def main() -> int:
    if sys.argv[1:2] == ["--hash"]:
        for phrase in sys.argv[2:]:
            print(f'"{phrase_hash(phrase)}",  # {len(_norm_words(phrase))} word(s)')
        return 0
    paths = [Path(p).resolve() for p in sys.argv[1:]] or tracked_files()
    hits = scan(paths)
    for h in hits:
        print(h)
    print(f"{len(hits)} name hit(s)" if hits else "no customer, person, or internal-host names found")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
