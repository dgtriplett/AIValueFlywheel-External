"""The shipped reference catalog (reference/catalog.json) for tests that check its
content: value models evaluate, assumption keys exist, units agree."""
import json
from pathlib import Path

BUNDLE = Path(__file__).resolve().parent.parent / "reference" / "catalog.json"


def load() -> dict:
    """{'use_cases': [...], 'value_assumptions': [...], ...} — the bundle's tables."""
    return json.loads(BUNDLE.read_text())["tables"]
