"""Shared helpers for parsing structured Foundation Model replies.

`unwrap_list` is used by the taxonomy classifier and company research; the
DEFAULT_* values are the catalog's fallback effort / sub-vertical for a use case
the agents describe without one (mirroring the CHECK constraints in 001_init.sql).
"""
from __future__ import annotations

import json

DEFAULT_EFFORT = "M"
DEFAULT_SUB_VERTICAL = "cross"


def unwrap_list(payload: dict | None, key: str, max_depth: int = 8) -> list | None:
    """Pull a list out of `payload[key]`, undoing any stringified nesting.

    Observed against `databricks-claude-sonnet-5` with a strict `response_format`:
    the reply came back DOUBLY nested —

        {"use_cases": "{\\"use_cases\\": [ {...}, {...} ]}"}

    — i.e. the array was JSON-encoded as a string, and that string was itself a
    full copy of the response envelope. A single `json.loads` retry recovers the
    inner object but then finds a dict where a list belongs, so the candidates
    were being discarded even though the model had produced perfectly good ones.

    This unwraps repeatedly: parse a string, and if what comes back is an envelope
    carrying the same key, descend into it. Each level of nesting costs TWO
    iterations (parse the string, then step into the dict), so `max_depth` is set
    well above the observed depth of 2 — iterations are trivially cheap and the
    only real requirement is that a pathological reply terminates.
    Returns None when no list can be recovered.
    """
    if not payload:
        return None
    value = payload.get(key)
    for _ in range(max_depth):
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (ValueError, TypeError):
                return None
            continue
        if isinstance(value, dict):
            # An envelope: prefer the same key, else a lone list-valued key.
            if key in value:
                value = value[key]
                continue
            lists = [v for v in value.values() if isinstance(v, list)]
            if len(lists) == 1:
                return lists[0]
            return None
        return None
    return None
