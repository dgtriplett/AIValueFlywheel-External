"""Account resolution — which customer's data a request is about.

WHY A CONTEXTVAR AND NOT A PARAMETER
------------------------------------
The account has to reach code that is a long way from the request: the value engine
loading assumptions, readiness resolving asset status, the proposal agent gathering
context. Threading an `account_id` argument through every one of those signatures
would be a large, mechanical change to code that is otherwise correct — and the first
function someone forgot to pass it to would silently read the default account's data
under another customer's name.

A ContextVar set once by middleware is invisible to the intermediate layers and
impossible to forget. It is the same mechanism the request id and the query budget
already use, for the same reason, and it is correct under async concurrency where a
module global would leak one request's account into another's.

RESOLUTION ORDER
----------------
  1. `X-AIVR-Account` header — set by the UI's business-unit switcher (the 1.x
     name, `X-Grid-Atlas-Account`, is still accepted).
  2. `account` query parameter — so a link can carry it (an exported report, a
     shared URL).
  3. The default account.

There is deliberately no "no account" state. Every read is scoped, and a request that
cannot resolve an account is a bug rather than a global view — a query silently
spanning tenants is exactly the failure this module exists to prevent.

WHAT THIS IS NOT
----------------
This is scoping, not authorization. It decides WHICH account's rows a request reads;
it does not decide whether the caller is allowed to. The app runs behind Databricks
Apps auth and every user of one instance is trusted with that instance's data. If
that ever stops being true — a shared instance across unrelated customers — this
module is where the check belongs, and the ContextVar already carries the identity
needed to make it.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar

from .db import db

logger = logging.getLogger(__name__)

# The account for the current request. None means "not yet resolved" — reads fall
# back to the default account, which is what an unscoped background task
# (token refresh, a migration check) should see.
current_account_id: ContextVar[int | None] = ContextVar(
    "current_account_id", default=None)

ACCOUNT_HEADER = "x-aivr-account"
LEGACY_ACCOUNT_HEADER = "x-grid-atlas-account"  # 1.x clients

# Cached default so the common path is not a query per request. Invalidated whenever
# an account is created, deleted, or made default.
_default_cache: dict[str, int | None] = {"id": None}


def invalidate_default() -> None:
    """Drop the cached default. Called after any write to `accounts`."""
    _default_cache["id"] = None


async def default_account_id() -> int | None:
    """The default account's id, or None on an un-migrated / empty database."""
    if _default_cache["id"] is not None:
        return _default_cache["id"]
    try:
        row = await db.fetchrow(
            "SELECT id FROM accounts WHERE is_default AND is_active LIMIT 1")
    except Exception:  # noqa: BLE001 - table absent before migration 009
        return None
    if row is None:
        # An install where the default was archived. Fall back to the lowest active
        # id rather than returning None, which would make every scoped read empty.
        try:
            row = await db.fetchrow(
                "SELECT id FROM accounts WHERE is_active ORDER BY id LIMIT 1")
        except Exception:  # noqa: BLE001
            return None
    if row is None:
        return None
    _default_cache["id"] = row["id"]
    return row["id"]


async def is_member(email: str | None, account_id: int) -> bool:
    """True if this user belongs to the account. Membership is authorization: a user
    may only resolve to accounts they are enrolled in (account_members)."""
    if not email or account_id is None:
        return False
    try:
        row = await db.fetchrow(
            "SELECT 1 FROM account_members WHERE account_id = $1 "
            "AND lower(user_email) = lower($2)", account_id, email)
        return row is not None
    except Exception:  # noqa: BLE001 - table absent before migration 016
        return True  # pre-migration: fall back to unscoped-by-account behaviour


async def role_for(email: str | None, account_id: int) -> str | None:
    """This user's role on the account (owner|editor|viewer), or None if not a member."""
    if not email or account_id is None:
        return None
    row = await db.fetchrow(
        "SELECT role FROM account_members WHERE account_id = $1 "
        "AND lower(user_email) = lower($2)", account_id, email)
    return row["role"] if row else None


async def can_edit(email: str | None, account_id: int | None) -> bool:
    """Owners and editors may change an account's data; viewers may only look.
    A global admin may edit any account. With no account (pre-setup), editing is
    allowed, matching the unscoped fallback everywhere else."""
    if account_id is None:
        return True
    if await is_admin(email):
        return True
    return (await role_for(email, account_id)) in ("owner", "editor")


async def require_editor(request) -> tuple[str, int | None]:
    """(actor, account_id) for a write, or 403 for a viewer."""
    from fastapi import HTTPException

    from .common import current_user
    actor = current_user(request)
    account_id = await current()
    if not await can_edit(actor, account_id):
        raise HTTPException(403, "You have view-only access to this business unit. "
                                 "Ask an owner to make you an editor.")
    return actor, account_id


async def can_manage_members(email: str | None, account_id: int) -> bool:
    """Only an account OWNER (the creator, or a co-owner they promoted) or a global
    admin may share an account and manage who can see it."""
    if await is_admin(email):
        return True
    return (await role_for(email, account_id)) == "owner"


async def is_admin(email: str | None) -> bool:
    """True if this user is in the admins allow-list. Admin is orthogonal to account
    membership: it grants the cross-account Admin portal, not access to any one
    account's per-customer experience."""
    if not email:
        return False
    from .config import APP_ADMINS
    if email.strip().lower() in APP_ADMINS:
        return True
    try:
        row = await db.fetchrow(
            "SELECT 1 FROM admins WHERE lower(user_email) = lower($1)", email)
        return row is not None
    except Exception:  # noqa: BLE001 - table absent before migration 017
        return False


async def _preferred_account(email: str | None) -> int | None:
    """The account a user lands on with no explicit selection: their remembered active
    account if they still belong to it, else their first membership."""
    if not email:
        return await default_account_id()
    try:
        row = await db.fetchrow("""
            SELECT ua.account_id FROM user_active_account ua
            JOIN account_members m ON m.account_id = ua.account_id
                 AND lower(m.user_email) = lower(ua.user_email)
            JOIN accounts a ON a.id = ua.account_id AND a.is_active
            WHERE lower(ua.user_email) = lower($1)
        """, email)
        if row is not None:
            return row["account_id"]
        row = await db.fetchrow("""
            SELECT a.id FROM account_members m JOIN accounts a ON a.id = m.account_id
            WHERE lower(m.user_email) = lower($1) AND a.is_active
            ORDER BY a.id LIMIT 1
        """, email)
        if row is not None:
            return row["id"]
    except Exception:  # noqa: BLE001 - tables absent before migration 016
        return await default_account_id()
    # A user with no memberships: nothing scoped to them yet. The UI prompts them to
    # create an account; fall back to the default only if one exists (single-tenant).
    return await default_account_id()


async def resolve(request) -> int | None:
    """Resolve the account for a request, GATED BY MEMBERSHIP.

    A request may select an account (header or ?account=) only if the signed-in user
    belongs to it; otherwise it falls back to the user's preferred account. Returns
    None only pre-migration / for a user with no accounts and no default.
    """
    from .common import current_user
    email = current_user(request)
    raw = (request.headers.get(ACCOUNT_HEADER)
           or request.headers.get(LEGACY_ACCOUNT_HEADER)
           or request.query_params.get("account"))
    if raw:
        requested = None
        try:
            requested = int(raw)
        except (TypeError, ValueError):
            row = await db.fetchrow(
                "SELECT id FROM accounts WHERE slug = $1 AND is_active",
                str(raw).strip().lower())
            requested = row["id"] if row else None
        if requested is not None:
            row = await db.fetchrow(
                "SELECT id FROM accounts WHERE id = $1 AND is_active", requested)
            if row is not None and await is_member(email, requested):
                return requested
            logger.warning("account %r not permitted for %s — using preferred",
                           raw, email)
    return await _preferred_account(email)


async def current() -> int | None:
    """The current account, resolving the default if middleware has not run.

    Callers deep in the stack use this rather than reading the ContextVar directly,
    so a background task or a test that never went through middleware still gets a
    sensible account instead of None.
    """
    account_id = current_account_id.get()
    if account_id is not None:
        return account_id
    return await default_account_id()


def install_middleware(app) -> None:
    """Resolve the account once per request and put it in the ContextVar."""
    from starlette.middleware.base import BaseHTTPMiddleware

    class AccountContextMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            token = None
            try:
                # Never fail a request on account resolution: a broken accounts
                # table should degrade to the default, not return 500 for the whole
                # app. The portfolio is still readable either way.
                account_id = await resolve(request)
                token = current_account_id.set(account_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("account resolution failed (%s) — unscoped",
                               type(exc).__name__)
            try:
                response = await call_next(request)
                if token is not None and current_account_id.get() is not None:
                    # Echoed so a client can confirm which account answered, which
                    # is the first question when a number looks wrong.
                    response.headers["X-AIVR-Account"] = str(
                        current_account_id.get())
                return response
            finally:
                if token is not None:
                    current_account_id.reset(token)

    app.add_middleware(AccountContextMiddleware)


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
async def scope_clause(alias: str = "") -> tuple[str, list]:
    """A WHERE fragment scoping a table to the current account.

    Returns (sql, params) with a single `$1` placeholder, e.g.
        clause, params = await scope_clause("b")
        await db.fetch(f"SELECT * FROM branding b WHERE {clause}", *params)

    NULL account_id is treated as visible to every account. That is what lets a
    shared row — a seeded KB folder, a global glossary term — serve all tenants
    without being copied per account.
    """
    prefix = f"{alias}." if alias else ""
    account_id = await current()
    if account_id is None:
        # Pre-migration: no accounts table, so nothing is scoped.
        return "true", []
    return f"({prefix}account_id = $1 OR {prefix}account_id IS NULL)", [account_id]


async def owned_clause(column: str = "account_id", *, param_index: int = 1) -> tuple[str, list]:
    """A WHERE fragment for tables whose rows are owned by exactly one account.

    Unlike `scope_clause`, this does NOT include `account_id IS NULL`. NULL means
    "shared/global" for reference-like content such as seeded KB folders and
    glossary terms; it is not appropriate for customer-owned work like roadmap
    items, value records, funding requests, comments, research runs, or chats.
    """
    account_id = await current()
    if account_id is None:
        return "true", []
    return f"{column} = ${param_index}", [account_id]
