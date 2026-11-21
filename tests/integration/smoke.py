"""End-to-end smoke test against a RUNNING app (either storage backend).

Not part of the unit suite — it needs a live app with a seeded database:

    python tests/integration/smoke.py --base http://localhost:8000 --email admin@example.com
    AIVR_TOKEN="$(databricks auth token -p <profile> | jq -r .access_token)" \
        python tests/integration/smoke.py --base https://<app-url>

1. Sweeps every parameter-free GET route the app registers and fails on any 5xx.
2. Runs the core journey: business unit -> import the example roadmap package
   (preview -> apply -> re-import) -> roadmap summary and drawer data -> Explore ->
   add from catalog -> what-if -> author a use case with the agent -> confirm ->
   readiness / detail -> delete (FK cascade) -> cleanup.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

SKIP_GET = {
    "/api/health", "/api/runtime", "/api/docs", "/openapi.json", "/docs", "/redoc",
    "/docs/oauth2-redirect", "/console",
}
# GETs that legitimately call slow external services (warehouse sweeps / LLM) or
# stream files; exercised elsewhere or not meaningful without data.
SLOW_GET_PREFIXES = ("/api/live", "/api/genie", "/api/inventory/artifacts", "/api/agents/customer-enhancements",
                     "/api/setup", "/api/lineage", "/api/ingestion/extractor")


class Smoke:
    def __init__(self, base: str, email: str | None, token: str | None):
        headers = {}
        if email:
            headers["X-Forwarded-Email"] = email
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.c = httpx.Client(base_url=base.rstrip("/"), headers=headers, timeout=180)
        self.failures: list[str] = []
        self.timings: list[tuple[str, float]] = []

    def call(self, method: str, path: str, expect=(200,), **kw):
        t = time.monotonic()
        try:
            r = self.c.request(method, path, **kw)
        except httpx.TransportError:
            # The server drops a keep-alive connection after an unhandled error;
            # retry once on a fresh connection so the sweep reports every failure.
            r = self.c.request(method, path, **kw)
        dt = time.monotonic() - t
        self.timings.append((f"{method} {path}", dt))
        ok = r.status_code in expect
        print(f"{'ok ' if ok else 'BAD'} {r.status_code} {dt:6.2f}s {method} {path}")
        if not ok:
            self.failures.append(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        try:
            return r.json()
        except ValueError:
            return r.content

    def sweep(self):
        spec = self.call("GET", "/openapi.json")
        for path, ops in sorted(spec.get("paths", {}).items()):
            if "get" not in ops or "{" in path or path in SKIP_GET or path.startswith(SLOW_GET_PREFIXES):
                continue
            params = [p for p in ops["get"].get("parameters", []) if p.get("required")]
            if params:
                continue
            self.call("GET", path, expect=(200, 400, 403, 404, 409, 422))

    def journey(self):
        me = self.call("GET", "/api/me")
        acct = self.call("POST", "/api/accounts", json={
            "name": f"Smoke Test BU {int(time.time())}", "utility_type": "electric"}, expect=(200, 201))
        acct_id = acct.get("id") or acct.get("account", {}).get("id")
        self.c.headers["X-AIVR-Account"] = str(acct_id)
        print("   business unit", acct_id, "user", me.get("email"))

        # Roadmap import: preview, apply the suggested decisions, re-import (no changes).
        pkg = json.loads((Path(__file__).resolve().parents[2] / "reference"
                          / "example-roadmap-package.json").read_text())
        pkg["roadmap"]["id"] = f"smoke-{int(time.time())}"
        prev = self.call("POST", "/api/roadmap-import/preview", json={"package": pkg})
        decisions = [{"external_id": m["external_id"], "action": m["suggestion"]["action"],
                      "use_case_id": m["suggestion"]["use_case_id"]} for m in prev.get("matches", [])]
        applied = self.call("POST", "/api/roadmap-import/apply", json={"package": pkg, "decisions": decisions})
        created = [applied.get("use_case_ids", {}).get(d["external_id"]) for d in decisions
                   if d["action"] == "create"] if isinstance(applied, dict) else []
        again = self.call("POST", "/api/roadmap-import/preview", json={"package": pkg})
        if again.get("diff", {}).get("changed") or again.get("diff", {}).get("added"):
            self.failures.append(f"re-import of an unchanged roadmap reported changes: {again.get('diff')}")
        summary = self.call("GET", "/api/roadmap/summary")
        if len(summary.get("pillars", [])) != len(pkg["pillars"]):
            self.failures.append("roadmap summary is missing pillars")
        self.call("GET", "/api/roadmap-import/history")
        first = (summary.get("use_cases") or [{}])[0].get("use_case_id")
        if first:
            self.call("GET", f"/api/roadmap/use-cases/{first}")
        self.call("GET", "/api/explore/portfolio")
        catalog = self.call("GET", "/api/use-cases?scope=all&limit=1000")
        catalog = catalog if isinstance(catalog, list) else catalog.get("items", [])
        ids = [u["id"] for u in catalog[:3]]
        self.call("POST", "/api/use-cases/portfolio/bulk", json={"ids": ids, "in_portfolio": True})
        roadmap = self.call("GET", "/api/operate/roadmap")
        if len(roadmap.get("use_cases", [])) < len(ids):
            self.failures.append(f"portfolio has {len(roadmap.get('use_cases', []))} use cases after adding {len(ids)}")
        cand = self.call("GET", "/api/whatif/candidates")
        asset_ids = [c.get("id") or c.get("data_asset_id") for c in (cand.get("candidates") or cand.get("assets") or [])][:2] \
            if isinstance(cand, dict) else []
        if asset_ids:
            self.call("POST", "/api/whatif/simulate", json={"data_asset_ids": asset_ids})
        self.call("GET", "/api/whatif/graph")

        # Author a use case with the agent (heuristic fallback when no LLM is reachable).
        prop = self.call("POST", "/api/use-cases/author/propose", json={
            "title": f"Smoke Transformer Overload Prediction {int(time.time())}",
            "description": "Predict distribution transformer overloads from AMI interval reads and weather."})
        proposal = prop.get("proposal") if isinstance(prop, dict) else None
        if proposal:
            card = self.call("POST", "/api/use-cases/author/commit", json={"proposal": proposal})
            done = self.call("POST", f"/api/confirm/{card['token']}", json={})
            uc_id = done.get("use_case_id")
            if uc_id:
                self.call("GET", f"/api/use-cases/{uc_id}/detail")
                self.call("GET", f"/api/use-cases/{uc_id}/readiness")
                self.call("GET", f"/api/use-cases/{uc_id}/network")
                self.call("DELETE", f"/api/use-cases/{uc_id}", expect=(200, 204))
                self.call("GET", f"/api/use-cases/{uc_id}/detail", expect=(404,))
        # Use cases the import created are shared rows: remove them before the unit.
        for uc_id in filter(None, created):
            self.call("DELETE", f"/api/use-cases/{uc_id}", expect=(200, 204))
        self.call("DELETE", f"/api/accounts/{acct_id}?hard=true", expect=(200, 204))

    def report(self) -> int:
        slow = sorted(self.timings, key=lambda t: -t[1])[:8]
        print("\nslowest:", ", ".join(f"{n} {t:.1f}s" for n, t in slow))
        if self.failures:
            print(f"\n{len(self.failures)} FAILURE(S):")
            for f in self.failures:
                print("  -", f)
            return 1
        print("\nall smoke checks passed")
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--email")
    ap.add_argument("--token", help="bearer token; defaults to $AIVR_TOKEN")
    ap.add_argument("--skip-sweep", action="store_true")
    a = ap.parse_args()
    s = Smoke(a.base, a.email, a.token or os.environ.get("AIVR_TOKEN"))
    if not a.skip_sweep:
        s.sweep()
    s.journey()
    return s.report()


if __name__ == "__main__":
    sys.exit(main())
