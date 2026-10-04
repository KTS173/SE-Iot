"""Sign up, sign in, sign out, and the signed-in user's own profile."""
import ipaddress
from typing import Any

from fastapi import APIRouter, Body, Depends, Request, Response

import auth
from db import get_db
from routers import error_response

router = APIRouter(prefix="/api/auth")


def _is_https(request):
    # Behind nginx and the tunnel the app itself only sees plain HTTP.
    forwarded = request.headers.get("x-forwarded-proto", "")
    return request.url.scheme == "https" or forwarded.split(",")[0].strip() == "https"


def _start_session(request, response, user_id, remember):
    token, max_age = auth.create_session(user_id, remember)
    response.set_cookie(
        auth.SESSION_COOKIE, token, max_age=max_age, httponly=True,
        samesite="lax", secure=_is_https(request), path="/",
    )


# Only the frontend's nginx, on the Docker network, may say who the real client is.
_TRUSTED_PROXIES = ipaddress.ip_network("172.16.0.0/12")


def _client_address(request):
    peer = request.client.host if request.client else ""
    try:
        trusted = ipaddress.ip_address(peer) in _TRUSTED_PROXIES
    except ValueError:
        trusted = False
    return (trusted and request.headers.get("x-real-ip")) or peer


@router.post("/signup", status_code=201)
def signup(request: Request, response: Response, payload: dict[str, Any] | None = Body(None)):
    """New accounts start as pending members and are signed in straight away."""
    payload = payload or {}
    values, error = auth.read_profile(payload)
    password = str(payload.get("password") or "")
    error = error or auth.password_error(password)
    if error:
        return error_response(error, 400)

    user, error = auth.create_user(**values, password=password)
    if error:
        return error_response(error, 409)
    _start_session(request, response, user["id"], remember=False)
    return {"data": user}


@router.post("/login")
def login(request: Request, response: Response, payload: dict[str, Any] | None = Body(None)):
    payload = payload or {}
    identifier = str(payload.get("identifier") or "").strip()
    password = str(payload.get("password") or "")
    if not identifier or not password:
        return error_response("Enter your username or email and password", 400)

    throttle_key = f"{identifier.lower()}|{_client_address(request)}"
    wait = auth.login_locked_for(throttle_key)
    if wait:
        minutes = (wait + 59) // 60
        return error_response(f"Too many failed attempts. Try again in {minutes} minute(s)", 429)

    row = auth.authenticate(identifier, password)
    if row is None:
        auth.record_failed_login(throttle_key)
        # Same message whether the account exists or not.
        return error_response("Invalid username or password", 401)
    auth.clear_failed_logins(throttle_key)
    if row["status"] == "disabled":
        return error_response("This account has been disabled", 403)

    _start_session(request, response, row["id"], remember=bool(payload.get("remember")))
    return {"data": auth.public_user(row)}


@router.post("/logout")
def logout(request: Request, response: Response):
    auth.revoke_session(request.cookies.get(auth.SESSION_COOKIE))
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"status": "ok"}


@router.get("/me")
def me(user=Depends(auth.current_user)):
    return {"data": auth.public_user(user)}


@router.put("/me")
def update_me(user=Depends(auth.current_user), payload: dict[str, Any] | None = Body(None)):
    values, error = auth.read_profile(payload or {})
    if error:
        return error_response(error, 400)
    with get_db() as connection:
        error = auth.taken_error(connection, values["username"], values["email"], user["id"])
        if error:
            return error_response(error, 409)
        connection.execute(
            "UPDATE users SET name = ?, username = ?, email = ? WHERE id = ?",
            (values["name"], values["username"], values["email"], user["id"]),
        )
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return {"data": auth.public_user(row)}


@router.post("/password")
def change_password(
    request: Request,
    user=Depends(auth.current_user),
    payload: dict[str, Any] | None = Body(None),
):
    """
    Needs the current password, except for a Google-only account setting its
    first one. Signs out every other session.
    """
    payload = payload or {}
    current = str(payload.get("current_password") or "")
    new = str(payload.get("new_password") or "")
    has_password = user["password_hash"] != auth.NO_PASSWORD
    if has_password and not auth.verify_password(current, user["password_hash"]):
        return error_response("Current password is incorrect", 400)
    error = auth.password_error(new)
    if error:
        return error_response(error, 400)
    if new == current:
        return error_response("New password must be different", 400)

    with get_db() as connection:
        connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (auth.hash_password(new), user["id"]),
        )
    auth.revoke_user_sessions(user["id"], keep_token=request.cookies.get(auth.SESSION_COOKIE))
    return {"status": "ok"}
