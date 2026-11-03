"""Accounts — which customer this instance is showing.

    GET    /api/accounts            list, with the current one marked
    POST   /api/accounts            create
    PATCH  /api/accounts/{id}       rename, retype, activate, make default
    DELETE /api/accounts/{id}       archive (or ?hard=true to delete)
    GET    /api/accounts/current    the resolved account for this request

WHY DELETE ARCHIVES BY DEFAULT
------------------------------
An account owns a customer's calibrated assumptions, their research, their proposals,
and their source positions — months of someone's work, and the FK cascade would take
all of it. Archiving removes it from the switcher and leaves the record; `?hard=true`
is the explicit escape hatch and says what it will destroy.

WHY THERE IS NO "ALL ACCOUNTS" VIEW
-----------------------------------
A portfolio total summed across tenants is not a number anyone wants: it adds two
utilities' unrelated capital plans. Every read is scoped to exactly one account, and
comparing them is a separate, deliberate feature rather than a default that silently
produces a meaningless figure.
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import accounts as acct
from ..common import current_user, rows_to_list, write_audit
from ..db import db
from ..limits import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["accounts"])

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    return _SLUG_RE.sub("-", (name or "").strip().lower()).strip("-")[:60] or "account"


async def _seed_assumptions_for_account(account_id: int, actor: str) -> int:
    """Give a new account its own baseline assumptions from the shipped seed.

    A new customer's assumptions must not inherit whichever utility happened to be
    the default account, because that account may already be research-calibrated.
    The reference bundle (reference/catalog.json) is the product baseline.
    """
    try:
        from .. import reference
        assumptions = reference.default_assumptions()
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not initialize seeded assumptions for account %s (%s)",
                       account_id, type(exc).__name__)
        return 0

    have = {r["key"] for r in await db.fetch(
        "SELECT key FROM value_assumptions WHERE account_id = $1", account_id)}
    rows = [(account_id, item.get("key"), item.get("label"), item.get("value"),
             item.get("unit"), item.get("category"))
            for item in assumptions if item.get("key") not in have]
    await db.executemany("""
        INSERT INTO value_assumptions
            (account_id, key, label, value, unit, category, source, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,'seed',now())
        ON CONFLICT (account_id, key) DO NOTHING
    """, rows)
    inserted = len(rows)
    await write_audit("account", account_id, "seed_assumptions", actor,
                      {"count": inserted})
    return inserted


class AccountIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    utility_type: str | None = Field(default=None, max_length=60)
    slug: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=2000)
    # Company profile — static per customer, captured once at account creation so an
    # assessment never has to ask for it again.
    geography: str | None = Field(default=None, max_length=60)
    territory_size: str | None = Field(default=None, max_length=60)
    strategic_priorities: list[str] = Field(default_factory=list)


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    utility_type: str | None = Field(default=None, max_length=60)
    notes: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None
    make_default: bool = False
    geography: str | None = Field(default=None, max_length=60)
    territory_size: str | None = Field(default=None, max_length=60)
    strategic_priorities: list[str] | None = None


@router.get("")
async def list_accounts(request: Request, include_inactive: bool = False):
    """The accounts the SIGNED-IN USER belongs to, with per-account counts so the
    switcher is informative. Membership-gated: a user never sees another user's
    accounts."""
    email = current_user(request)
    active = "" if include_inactive else "AND a.is_active"
    try:
        rows = rows_to_list(await db.fetch(f"""
            SELECT a.id, a.slug, a.name, a.utility_type, a.is_active, a.is_default,
                   a.notes, a.created_at, m.role,
                   (SELECT count(*) FROM account_asset_status s
                     WHERE s.account_id = a.id
                       AND s.ingestion_status IN ('curated','governed')) AS sources_ready,
                   (SELECT count(*) FROM account_asset_status s
                     WHERE s.account_id = a.id) AS sources_tracked,
                   (SELECT count(*) FROM account_portfolio_use_cases p
                     WHERE p.account_id = a.id) AS portfolio_use_cases
            FROM account_members m JOIN accounts a ON a.id = m.account_id
            WHERE lower(m.user_email) = lower($1) {active}
            ORDER BY a.is_default DESC, lower(a.name)
        """, email))
    except Exception as exc:  # noqa: BLE001
        # Pre-migration installs have no accounts/members table. Report plainly.
        logger.info("accounts unavailable (%s)", type(exc).__name__)
        return {"accounts": [], "current_account_id": None,
                "note": "Run migrations 009 + 016 to enable accounts."}
    return {"accounts": rows, "current_account_id": await acct.current()}


@router.get("/current")
async def current_account():
    """The account this request resolved to, and how."""
    account_id = await acct.current()
    if account_id is None:
        return {"account": None,
                "note": "No accounts table — run the setup job (databricks bundle run setup)."}
    row = await db.fetchrow(
        "SELECT id, slug, name, utility_type, is_default FROM accounts "
        "WHERE id = $1", account_id)
    return {"account": dict(row) if row else None}


@router.post("", dependencies=[Depends(limiter("write"))])
async def create_account(body: AccountIn, request: Request):
    """Add an account. It starts with the shared reference library and no answers.

    Deliberately NOT copied from an existing account: a new customer's assumptions
    should start at the seeded defaults, not at another utility's calibrated figures.
    Inheriting them would be the kind of error that produces a confident wrong number
    with no visible cause.
    """
    actor = current_user(request)
    slug = slugify(body.slug or body.name)
    existing = await db.fetchrow("SELECT id FROM accounts WHERE slug = $1", slug)
    if existing is not None:
        raise HTTPException(
            409, f"An account with the slug {slug!r} already exists. Give a "
                 "different name, or pass an explicit slug.")

    # is_default only when this is the first account, so creating one never silently
    # switches what an existing unscoped request resolves to. The profile fields are
    # stored here — this account creation IS the company-profile capture.
    profile_complete = bool(body.utility_type and body.territory_size and body.geography)
    row = await db.fetchrow("""
        INSERT INTO accounts (slug, name, utility_type, notes, created_by, is_default,
                              geography, territory_size, strategic_priorities, profile_complete)
        VALUES ($1,$2,$3,$4,$5, NOT EXISTS (SELECT 1 FROM accounts), $6,$7,$8,$9)
        RETURNING id, slug, name, utility_type, is_default, geography, territory_size,
                  strategic_priorities, profile_complete
    """, slug, body.name.strip(), body.utility_type, body.notes, actor,
        body.geography, body.territory_size, list(body.strategic_priorities or []),
        profile_complete)

    acct.invalidate_default()
    # Enroll the creator as owner and make this their active account, so a new account
    # is immediately theirs and the switcher lands on it.
    await db.execute("""
        INSERT INTO account_members (account_id, user_email, role, added_by)
        VALUES ($1,$2,'owner',$2)
        ON CONFLICT (account_id, user_email) DO UPDATE SET role='owner'
    """, row["id"], actor)
    await db.execute("""
        INSERT INTO user_active_account (user_email, account_id) VALUES ($1,$2)
        ON CONFLICT (user_email) DO UPDATE SET account_id=EXCLUDED.account_id, updated_at=now()
    """, actor, row["id"])
    seeded_assumptions = await _seed_assumptions_for_account(row["id"], actor)
    await write_audit("account", row["id"], "create", actor,
                      {"slug": slug, "name": body.name})
    return {**dict(row), "note": "Starts on the shared reference library with the "
                                 "seeded assumptions. You are its owner.",
            "seeded_assumptions": seeded_assumptions}


@router.post("/{account_id}/switch", dependencies=[Depends(limiter("write"))])
async def switch_account(account_id: int, request: Request):
    """Set the signed-in user's active account. Membership-gated — a user can only
    switch to an account they belong to. Persisted so they land back here next time."""
    actor = current_user(request)
    if not await acct.is_member(actor, account_id):
        raise HTTPException(403, "You are not a member of that account.")
    await db.execute("""
        INSERT INTO user_active_account (user_email, account_id) VALUES ($1,$2)
        ON CONFLICT (user_email) DO UPDATE SET account_id=EXCLUDED.account_id, updated_at=now()
    """, actor, account_id)
    row = await db.fetchrow(
        "SELECT id, slug, name, utility_type FROM accounts WHERE id = $1", account_id)
    return {"active_account": dict(row) if row else None}


# ---------------------------------------------------------------------------
# Sharing / membership — who can see and manage this account
# ---------------------------------------------------------------------------
_ROLES = ("owner", "editor", "viewer")
_ROLE_LABEL = {"owner": "Owner", "editor": "Editor (can manage)", "viewer": "Viewer (view only)"}


class MemberIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    role: str = Field(default="viewer")


@router.get("/{account_id}/members")
async def list_members(account_id: int, request: Request):
    """The people who can see this account, with their role. Visible to any member
    (or admin) — everyone on the account can see who else has access."""
    actor = current_user(request)
    if not (await acct.is_member(actor, account_id) or await acct.is_admin(actor)):
        raise HTTPException(403, "You are not a member of that account.")
    rows = rows_to_list(await db.fetch(
        "SELECT user_email, role, added_by, added_at FROM account_members "
        "WHERE account_id = $1 ORDER BY (role='owner') DESC, added_at", account_id))
    return {"members": rows, "can_manage": await acct.can_manage_members(actor, account_id),
            "me": actor}


@router.post("/{account_id}/members", dependencies=[Depends(limiter("write"))])
async def add_member(account_id: int, body: MemberIn, request: Request):
    """Share the account with someone (or change their role). Only an owner (the creator
    or a co-owner) — or a global admin — may manage who has access."""
    actor = current_user(request)
    if not await acct.can_manage_members(actor, account_id):
        raise HTTPException(403, "Only an account owner can share this account.")
    if body.role not in _ROLES:
        raise HTTPException(422, f"role must be one of {_ROLES}")
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Enter a valid email address.")
    exists = await db.fetchrow("SELECT id FROM accounts WHERE id = $1", account_id)
    if exists is None:
        raise HTTPException(404, "Account not found")
    await db.execute("""
        INSERT INTO account_members (account_id, user_email, role, added_by)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (account_id, user_email) DO UPDATE SET role = EXCLUDED.role
    """, account_id, email, body.role, actor)
    await write_audit("account", account_id, "share", actor,
                      {"email": email, "role": body.role})
    return {"ok": True, "email": email, "role": body.role}


@router.delete("/{account_id}/members/{email}", dependencies=[Depends(limiter("write"))])
async def remove_member(account_id: int, email: str, request: Request):
    """Revoke someone's access. Owner/admin only. The last owner can't be removed (that
    would orphan the account — only admins would see it), and you can't remove yourself
    if you are the only owner."""
    actor = current_user(request)
    if not await acct.can_manage_members(actor, account_id):
        raise HTTPException(403, "Only an account owner can manage access.")
    target = email.strip().lower()
    row = await db.fetchrow(
        "SELECT role FROM account_members WHERE account_id=$1 AND lower(user_email)=lower($2)",
        account_id, target)
    if row is None:
        raise HTTPException(404, "That person is not a member of this account.")
    if row["role"] == "owner":
        owners = await db.fetchrow(
            "SELECT count(*) AS n FROM account_members WHERE account_id=$1 AND role='owner'",
            account_id)
        if int(owners["n"]) <= 1:
            raise HTTPException(409, "This is the last owner — add another owner before removing.")
    await db.execute(
        "DELETE FROM account_members WHERE account_id=$1 AND lower(user_email)=lower($2)",
        account_id, target)
    await write_audit("account", account_id, "unshare", actor, {"email": target})
    return {"ok": True, "removed": target}


@router.patch("/{account_id}", dependencies=[Depends(limiter("write"))])
async def update_account(account_id: int, body: AccountPatch, request: Request):
    actor = current_user(request)
    # Membership gate (IDOR guard): a user may only modify an account they belong to.
    # Without this, any signed-in user could rename, re-home, deactivate, or make-default
    # another customer's account by guessing its id.
    if not (await acct.is_member(actor, account_id) or await acct.is_admin(actor)):
        raise HTTPException(403, "You are not a member of that account.")
    row = await db.fetchrow("SELECT id, is_default FROM accounts WHERE id = $1",
                            account_id)
    if row is None:
        raise HTTPException(404, "Account not found")

    if body.is_active is False and row["is_default"]:
        raise HTTPException(
            422, "This is the default account, so deactivating it would leave "
                 "unscoped requests with nowhere to resolve. Make another account "
                 "the default first.")

    if body.make_default:
        # Two statements, and the clear MUST come first: the partial unique index
        # permits only one row with is_default = true, so setting the new one before
        # clearing the old would violate it.
        await db.execute("UPDATE accounts SET is_default = false WHERE is_default")
        await db.execute(
            "UPDATE accounts SET is_default = true, updated_at = now() WHERE id = $1",
            account_id)
        acct.invalidate_default()

    await db.execute("""
        UPDATE accounts SET
            name = COALESCE($2, name),
            utility_type = COALESCE($3, utility_type),
            notes = COALESCE($4, notes),
            is_active = COALESCE($5, is_active),
            geography = COALESCE($6, geography),
            territory_size = COALESCE($7, territory_size),
            strategic_priorities = COALESCE($8, strategic_priorities),
            profile_complete = (profile_complete OR ($3 IS NOT NULL AND $6 IS NOT NULL AND $7 IS NOT NULL)),
            updated_at = now()
        WHERE id = $1
    """, account_id, body.name.strip() if body.name else None,
        body.utility_type, body.notes, body.is_active,
        body.geography, body.territory_size,
        list(body.strategic_priorities) if body.strategic_priorities is not None else None)

    await write_audit("account", account_id, "update", actor, body.model_dump())
    updated = await db.fetchrow(
        "SELECT id, slug, name, utility_type, is_active, is_default FROM accounts "
        "WHERE id = $1", account_id)
    return dict(updated)


@router.delete("/{account_id}", dependencies=[Depends(limiter("write"))])
async def delete_account(account_id: int, request: Request, hard: bool = False):
    """Archive by default. `?hard=true` deletes the account and everything it owns."""
    actor = current_user(request)
    # Membership gate (IDOR guard): only a member (or admin) may archive/delete an
    # account. Without this any signed-in user could cascade-delete another customer's
    # months of work by guessing the id.
    if not (await acct.is_member(actor, account_id) or await acct.is_admin(actor)):
        raise HTTPException(403, "You are not a member of that account.")
    row = await db.fetchrow(
        "SELECT id, name, is_default FROM accounts WHERE id = $1", account_id)
    if row is None:
        raise HTTPException(404, "Account not found")
    if row["is_default"]:
        raise HTTPException(
            422, "This is the default account. Make another account the default "
                 "before removing it.")

    if not hard:
        await db.execute(
            "UPDATE accounts SET is_active = false, updated_at = now() "
            "WHERE id = $1", account_id)
        await write_audit("account", account_id, "archive", actor,
                          {"name": row["name"]})
        return {"archived": True, "id": account_id,
                "note": "Archived. Its data is intact; pass hard=true to delete it."}

    # Count what the cascade will take, so the response says what was destroyed
    # rather than just "ok".
    counts = {}
    for table in ("company_profile", "branding", "value_assumptions",
                  "research_runs", "kb_articles", "account_asset_status"):
        try:
            found = await db.fetchrow(
                f"SELECT count(*) AS n FROM {table} WHERE account_id = $1",
                account_id)
            counts[table] = found["n"] if found else 0
        except Exception:  # noqa: BLE001
            pass

    await db.execute("DELETE FROM accounts WHERE id = $1", account_id)
    acct.invalidate_default()
    await write_audit("account", account_id, "delete", actor,
                      {"name": row["name"], "cascaded": counts})
    logger.warning("account %s (%s) hard-deleted by %s; cascaded %s",
                   account_id, row["name"], actor, counts)
    return {"deleted": True, "id": account_id, "cascaded": counts}
