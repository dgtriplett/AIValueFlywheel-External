"""AI Value Realization - FastAPI entry point.

Serves the REST API under /api/* and the built React SPA from frontend/dist.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from server import limits, logging_setup
from server.config import AI_QUERY_ENDPOINT, IS_DATABRICKS_APP, SERVING_ENDPOINT, GENIE_SPACE_ID
from server.db import db, token_refresh_loop
from server.routes import (
    lobs,
    data_assets,
    use_cases,
    dependencies,
    values,
    roadmap,
    comments,
    funding_requests,
    impact,
    value_assumptions,
    genie,
    agents,
    analytics,
    live,
    onboarding,
    joint_funding,
    source_recommendations,
    domains,
    ingestion,
    generate,
    setup,
    taxonomy,
    research,
    flow,
    inventory,
    chat,
    branding,
    knowledge,
    proposals,
    exports,
    explore,
    lifecycle,
    accounts as accounts_routes,
    whatif,
    snapshots as snapshot_routes,
    quality,
    sync_packages,
    feature_flags,
    admin_settings,
    authoring,
    roadmap_import,
)

# Install handlers before anything logs. JSON in Databricks Apps, text locally;
# LOG_LEVEL turns detail up on a deployed app without a code change.
logging_setup.configure()
logger = logging.getLogger("aivr.app")

APP_VERSION = (Path(__file__).parent / "VERSION").read_text().strip()

BASE_DIR = Path(__file__).parent
MIGRATIONS_DIR = BASE_DIR / "server" / "migrations"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
# Operator console: a dependency-free page for the discovery/agent workflows.
# Separate from the SPA because the SPA's TypeScript source isn't in this repo
# (see README) — this way the new screens ship without touching the built bundle.
CONSOLE_DIR = BASE_DIR / "frontend" / "console"


def app_env() -> str:
    value = (os.environ.get("APP_ENV") or "DEV").strip().upper()
    return value if value in {"DEV", "PROD"} else value[:12]


def env_pill_html() -> str:
    env = app_env()
    is_prod = env == "PROD"
    bg = "#123c2f" if is_prod else "#3b2c06"
    border = "#00a972" if is_prod else "#ffab00"
    color = "#9ed6c4" if is_prod else "#ffdb96"
    return (
        '<div id="app-env-pill" aria-label="Application environment" '
        f'style="position:fixed;right:14px;bottom:14px;z-index:2147483647;'
        f'padding:5px 10px;border-radius:999px;border:1px solid {border};'
        f'background:{bg};color:{color};font:700 11px DM Mono,ui-monospace,monospace;'
        'letter-spacing:.08em;box-shadow:0 8px 24px rgba(0,0,0,.35);'
        'pointer-events:none;">'
        f'{env}</div>'
    )


def spa_index_response() -> HTMLResponse:
    html = (FRONTEND_DIST / "index.html").read_text()
    pill = env_pill_html()
    html = html.replace("</body>", f"  {pill}\n  </body>")
    return HTMLResponse(html)


async def check_schema() -> None:
    """Report schema state at startup. Never applies migrations.

    The app authenticates as a service principal holding DML but NOT DDL, so it
    cannot apply migrations — and should not. Replaying SQL on every boot is how a
    non-idempotent migration silently destroys data on a restart nobody was watching.
    server/migrator.py owns the ledger; the bundle's setup job applies migrations.

    A pending migration is a state to report, not a crash.
    """
    from server.migrator import migrations_dir_for, startup_check

    if await db.get_pool() is None:
        logger.info("no app-state storage configured (STORAGE_BACKEND=%s) — the Setup "
                    "page lists what is missing", getattr(db, "backend_name", "?"))
        return
    try:
        await startup_check(db, migrations_dir_for(db, MIGRATIONS_DIR))
    except Exception as exc:  # noqa: BLE001 - never block startup on a status check
        logger.warning("schema check failed (%s) — continuing", type(exc).__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await check_schema()
    refresh_task = asyncio.create_task(token_refresh_loop())
    yield
    refresh_task.cancel()
    await db.close()


app = FastAPI(title="AI Value Realization", version=APP_VERSION, lifespan=lifespan)

# Correlates every log line emitted while handling a request, and emits one line per
# request with status + duration. Added before the routers so it wraps all of them.
logging_setup.install_middleware(app)

# Resolves which customer's data this request is about, into a ContextVar the value
# engine and readiness read. Added AFTER the logging middleware so account-resolution
# warnings carry a request id.
from server import accounts as _accounts  # noqa: E402
_accounts.install_middleware(app)

# --- API routers -----------------------------------------------------------
for module in (lobs, data_assets, use_cases, dependencies, values, roadmap,
               comments, funding_requests, impact, value_assumptions, genie, agents,
               analytics, live, onboarding, joint_funding, source_recommendations,
               domains, ingestion, generate, setup, taxonomy, research,
               flow, inventory, chat, branding, knowledge, proposals,
               exports, explore, lifecycle, accounts_routes, whatif, snapshot_routes, quality,
               feature_flags, admin_settings, authoring, roadmap_import):
    app.include_router(module.router, prefix="/api")

app.include_router(sync_packages.router, prefix="/api")

# Secondary routers whose paths don't sit under their module's own prefix:
#   domains.uc_router  — a use case's required domains belong under /use-cases
#   generate.confirm_router — /confirm is shared by every agent-proposed write
app.include_router(domains.uc_router, prefix="/api")
app.include_router(generate.confirm_router, prefix="/api")

@app.get("/api/health")
async def health():
    from server import reference
    connected = False
    counts: dict = {}
    if await db.get_pool() is not None:
        try:
            for table in ("lobs", "data_assets", "use_cases"):
                counts[table] = await db.fetchval(f"SELECT count(*) AS n FROM {table}")
            connected = True
        except Exception as exc:  # noqa: BLE001
            counts = {"error": str(exc)}
    return {
        "status": "healthy",
        "app": "ai-value-realization",
        "version": APP_VERSION,
        "reference_catalog": reference.version(),
        "app_env": app_env(),
        "environment": "databricks" if IS_DATABRICKS_APP else "local",
        "storage_backend": db.backend_name,
        "db_connected": connected,
        "serving_endpoint": SERVING_ENDPOINT,
        "ai_query_endpoint": AI_QUERY_ENDPOINT,
        "genie_space_configured": bool(GENIE_SPACE_ID),
        "counts": counts,
        # So a "why did I get a 429?" report can be answered without a redeploy.
        "rate_limits": limits.snapshot(),
    }


@app.get("/api/runtime")
async def runtime():
    return {
        "app": "ai-value-realization",
        "version": APP_VERSION,
        "app_env": app_env(),
        "databricks_app": bool(IS_DATABRICKS_APP),
    }


# --- Operator console ------------------------------------------------------
# Mounted BEFORE the SPA's catch-all, which matches every path and would
# otherwise return index.html for /console.
if CONSOLE_DIR.exists():
    # `/console` (no trailing slash) does NOT hit the mount below — it falls
    # through to the SPA catch-all, which serves index.html and silently shows the
    # portfolio instead. Redirecting makes both spellings work, so a typed URL or
    # a stale bookmark still lands on the console.
    @app.get("/console", include_in_schema=False)
    async def console_redirect():
        return RedirectResponse(url="/console/", status_code=308)

    app.mount("/console", StaticFiles(directory=str(CONSOLE_DIR), html=True),
              name="console")


# --- Static SPA ------------------------------------------------------------
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"error": "Not found"}, status_code=404)
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return spa_index_response()
else:
    @app.get("/")
    async def root():
        return {"message": "AI Value Realization API. Frontend build not found.",
                "console": "/console", "docs": "/docs"}
