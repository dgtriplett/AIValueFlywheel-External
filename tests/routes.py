"""Flatten an app's routes in registration order, across FastAPI versions.

FastAPI >= 0.140 keeps an included router as a lazy `_IncludedRouter` entry in
`app.routes` instead of copying its routes in; older versions copy them. Tests that
assert on paths or on declaration order use this so they see the same list either way.
"""


def flat_routes(app_or_router, prefix: str = "") -> list:
    out = []
    for route in app_or_router.routes:
        inner = getattr(route, "original_router", None)
        if inner is not None:
            ctx = getattr(route, "include_context", None)
            out += flat_routes(inner, prefix + (getattr(ctx, "prefix", "") or ""))
            continue
        out.append(_Prefixed(route, prefix) if prefix else route)
    return out


class _Prefixed:
    def __init__(self, route, prefix):
        self._route, self._prefix = route, prefix

    @property
    def path(self):
        return self._prefix + getattr(self._route, "path", "")

    def __getattr__(self, name):
        return getattr(self._route, name)
