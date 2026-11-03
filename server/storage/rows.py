"""A result row that behaves like an asyncpg Record for the ways the app uses one:
`row["col"]`, `row.get("col")`, `dict(row)`, `row[0]`, iteration over keys."""
from __future__ import annotations


class Row(dict):
    __slots__ = ("_order",)

    def __init__(self, names: list[str], values: list):
        super().__init__(zip(names, values))
        self._order = list(names)

    def __getitem__(self, key):
        if isinstance(key, int):
            return dict.__getitem__(self, self._order[key])
        return dict.__getitem__(self, key)
