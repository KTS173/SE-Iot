"""Admin-only: approve sign-ups, change roles, disable or remove accounts."""
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends

import auth
from db import get_db
from routers import error_response

router = APIRouter(prefix="/api/users", dependencies=[Depends(auth.admin_user)])


@router.get("")
def list_users():
    """Pending sign-ups first, so they are what an admin sees on opening the page."""
    with get_db() as connection:
        rows = connection.execute(
            "SELECT * FROM users ORDER BY status != 'pending', created_at"
        ).fetchall()
    return {"data": [auth.public_user(row) for row in rows]}


@router.put("/{user_id}")
def update_user(
    user_id: int,
    admin=Depends(auth.admin_user),
    payload: dict[str, Any] | None = Body(None),
):
    """Body may set `role` (admin/member) and/or `status` (active/disabled)."""
    payload = payload or {}
    role = payload.get("role")
    status = payload.get("status")
    if role is not None and role not in auth.ROLES:
        return error_response("role must be admin or member", 400)
    if status is not None and status not in ("active", "disabled"):
        return error_response("status must be active or disabled", 400)
    if user_id == admin["id"]:
        # Stops the last admin from locking everyone out of user management.
        return error_response("You cannot change your own role or status", 400)

    with get_db() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            return error_response("User not found", 404)
        approved_at = row["approved_at"]
        if status == "active" and approved_at is None:
            approved_at = datetime.now(timezone.utc).isoformat()
        connection.execute(
            "UPDATE users SET role = ?, status = ?, approved_at = ? WHERE id = ?",
            (role or row["role"], status or row["status"], approved_at, user_id),
        )
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if status == "disabled":
        auth.revoke_user_sessions(user_id)
    return {"data": auth.public_user(row)}


@router.delete("/{user_id}")
def delete_user(user_id: int, admin=Depends(auth.admin_user)):
    if user_id == admin["id"]:
        return error_response("You cannot delete your own account", 400)
    auth.revoke_user_sessions(user_id)
    with get_db() as connection:
        deleted = connection.execute("DELETE FROM users WHERE id = ?", (user_id,)).rowcount
    if not deleted:
        return error_response("User not found", 404)
    return {"data": {"id": user_id}}
