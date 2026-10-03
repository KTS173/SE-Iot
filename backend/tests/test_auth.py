from datetime import datetime, timedelta, timezone

import pytest

import auth
from conftest import PASSWORD, count

SIGNUP = {"name": "Jane Doe", "username": "jane", "email": "Jane@Lab.test", "password": "longenough"}


# --- passwords ------------------------------------------------------------------

def test_password_hash_is_salted_and_verifies():
    first, second = auth.hash_password("secret-pw"), auth.hash_password("secret-pw")
    assert first != second
    assert "secret-pw" not in first
    assert auth.verify_password("secret-pw", first)
    assert not auth.verify_password("wrong", first)
    assert not auth.verify_password("secret-pw", "garbage")


# --- sign up --------------------------------------------------------------------

def test_signup_creates_pending_member_and_signs_in(new_client, get_db):
    browser = new_client()
    response = browser.post("/api/auth/signup", json=SIGNUP)

    assert response.status_code == 201
    user = response.json()["data"]
    assert (user["role"], user["status"], user["email"]) == ("member", "pending", "jane@lab.test")
    assert "password_hash" not in user
    assert browser.get("/api/auth/me").json()["data"]["username"] == "jane"
    with get_db() as connection:
        stored = connection.execute("SELECT password_hash FROM users").fetchone()[0]
    assert "longenough" not in stored


@pytest.mark.parametrize(
    "change, message",
    [
        ({"name": ""}, "Name is required"),
        ({"username": "ab"}, "Username must be 3-32 letters, numbers, dots, dashes or underscores"),
        ({"username": "has space"}, "Username must be 3-32 letters, numbers, dots, dashes or underscores"),
        ({"email": "not-an-email"}, "Enter a valid email address"),
        ({"password": "short"}, "Password must be at least 8 characters"),
    ],
)
def test_signup_validation(new_client, change, message):
    response = new_client().post("/api/auth/signup", json={**SIGNUP, **change})
    assert response.status_code == 400
    assert response.json() == {"error": message}


@pytest.mark.parametrize(
    "change, message",
    [
        ({"username": "JANE", "email": "other@lab.test"}, "This username is already taken"),
        ({"username": "other", "email": "jane@LAB.test"}, "This email is already registered"),
    ],
)
def test_signup_rejects_duplicates_case_insensitively(new_client, change, message):
    new_client().post("/api/auth/signup", json=SIGNUP)
    response = new_client().post("/api/auth/signup", json={**SIGNUP, **change})
    assert response.status_code == 409
    assert response.json() == {"error": message}


# --- sign in / out --------------------------------------------------------------

def test_login_by_username_or_email(make_user, new_client):
    make_user("bob")
    for identifier in ("bob", "BOB", "bob@lab.test"):
        response = new_client().post(
            "/api/auth/login", json={"identifier": identifier, "password": PASSWORD}
        )
        assert response.status_code == 200
        assert response.json()["data"]["username"] == "bob"


def test_wrong_password_and_unknown_user_look_the_same(make_user, new_client):
    make_user("bob")
    wrong = new_client().post("/api/auth/login", json={"identifier": "bob", "password": "nope-nope"})
    unknown = new_client().post("/api/auth/login", json={"identifier": "ghost", "password": "nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"error": "Invalid username or password"}


def test_login_requires_both_fields(new_client):
    response = new_client().post("/api/auth/login", json={"identifier": "bob"})
    assert response.status_code == 400


def test_repeated_failures_lock_the_account_briefly(make_user, new_client):
    make_user("bob")
    browser = new_client()
    for _ in range(auth.MAX_FAILED_LOGINS):
        browser.post("/api/auth/login", json={"identifier": "bob", "password": "wrong-pass"})

    locked = browser.post("/api/auth/login", json={"identifier": "bob", "password": PASSWORD})
    assert locked.status_code == 429
    assert "Try again in 15 minute(s)" in locked.json()["error"]


def test_session_cookie_is_http_only(make_user, new_client):
    make_user("bob")
    response = new_client().post("/api/auth/login", json={"identifier": "bob", "password": PASSWORD})
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "max-age" not in cookie  # browser-session cookie without "Remember me"
    assert "secure" not in cookie  # plain-HTTP test server


def test_remember_me_and_https_set_long_secure_cookie(make_user, new_client):
    make_user("bob")
    response = new_client().post(
        "/api/auth/login",
        json={"identifier": "bob", "password": PASSWORD, "remember": True},
        headers={"X-Forwarded-Proto": "https"},
    )
    cookie = response.headers["set-cookie"].lower()
    assert "max-age=2592000" in cookie
    assert "secure" in cookie


def test_logout_revokes_the_session_on_the_server(make_user, new_client, get_db):
    make_user("bob")
    browser = new_client("bob")
    token = browser.cookies[auth.SESSION_COOKIE]

    assert browser.post("/api/auth/logout").status_code == 200
    assert count(get_db, "sessions") == 0

    # Replaying the old cookie from somewhere else no longer works.
    thief = new_client()
    thief.cookies.set(auth.SESSION_COOKIE, token)
    assert thief.get("/api/auth/me").status_code == 401


def test_expired_session_is_rejected(make_user, new_client, get_db):
    make_user("bob")
    browser = new_client("bob")
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    with get_db() as connection:
        connection.execute("UPDATE sessions SET expires_at = ?", (past,))
    assert browser.get("/api/auth/me").status_code == 401


def test_missing_or_forged_cookie_is_rejected(new_client):
    assert new_client().get("/api/auth/me").json() == {"error": "Please sign in"}
    forged = new_client()
    forged.cookies.set(auth.SESSION_COOKIE, "made-up")
    assert forged.get("/api/auth/me").status_code == 401


def test_disabled_account_cannot_sign_in(make_user, new_client):
    make_user("bob", status="disabled")
    response = new_client().post("/api/auth/login", json={"identifier": "bob", "password": PASSWORD})
    assert response.status_code == 403
    assert response.json() == {"error": "This account has been disabled"}


# --- profile and password ---------------------------------------------------------

def test_update_own_profile(make_user, new_client):
    make_user("bob")
    make_user("carol")
    browser = new_client("bob")

    ok = browser.put("/api/auth/me", json={"name": "Bobby", "username": "bobby", "email": "b@lab.test"})
    assert ok.json()["data"]["name"] == "Bobby"

    taken = browser.put("/api/auth/me", json={"name": "B", "username": "carol", "email": "b@lab.test"})
    assert taken.status_code == 409

    bad = browser.put("/api/auth/me", json={"name": "B", "username": "bobby", "email": "nope"})
    assert bad.status_code == 400


def test_change_password_signs_out_other_sessions(make_user, new_client):
    make_user("bob")
    laptop, phone = new_client("bob"), new_client("bob")

    assert laptop.post("/api/auth/password", json={"current_password": "wrong", "new_password": "newpassword1"}).status_code == 400
    assert laptop.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "short"}).status_code == 400
    assert laptop.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": PASSWORD}).status_code == 400

    response = laptop.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "newpassword1"})
    assert response.status_code == 200
    assert laptop.get("/api/auth/me").status_code == 200
    assert phone.get("/api/auth/me").status_code == 401
    assert new_client().post("/api/auth/login", json={"identifier": "bob", "password": "newpassword1"}).status_code == 200


# --- permissions ----------------------------------------------------------------

MEMBER_READS = ["/api/devices", "/api/sensors", "/api/sensors/latest", "/api/alerts",
                "/api/notifications", "/api/line/status"]
ADMIN_ONLY = [("PUT", "/api/devices/001"), ("DELETE", "/api/devices/001"),
              ("POST", "/api/line/test"), ("GET", "/api/users")]


@pytest.mark.parametrize("path", MEMBER_READS)
def test_reads_need_an_approved_account(make_user, new_client, path):
    make_user("pending", status="pending")
    make_user("member")
    assert new_client().get(path).status_code == 401
    pending = new_client("pending").get(path)
    assert pending.status_code == 403
    assert pending.json() == {"error": "Your account is waiting for admin approval"}
    assert new_client("member").get(path).status_code == 200


@pytest.mark.parametrize("method, path", ADMIN_ONLY)
def test_admin_actions_are_refused_to_members(make_user, new_client, method, path):
    make_user("member")
    response = new_client("member").request(method, path, json={"name": "x", "location": "y"})
    assert response.status_code == 403
    assert response.json() == {"error": "Only admins can do this"}


def test_public_endpoints_need_no_sign_in(new_client):
    browser = new_client()
    assert browser.get("/api/health").status_code == 200
    assert browser.post("/api/line/webhook", content=b"{}").status_code == 403  # bad signature, not 401


# --- admin user management ----------------------------------------------------------

def test_admin_approves_a_pending_signup(client, new_client):
    jane = new_client()
    jane.post("/api/auth/signup", json=SIGNUP)
    assert jane.get("/api/devices").status_code == 403

    users = client.get("/api/users").json()["data"]
    assert users[0]["username"] == "jane"  # pending first
    approved = client.put(f"/api/users/{users[0]['id']}", json={"status": "active"}).json()["data"]
    assert approved["status"] == "active"
    assert approved["approved_at"] is not None

    assert jane.get("/api/devices").status_code == 200


def test_admin_changes_role_and_disables(client, make_user, new_client):
    bob = make_user("bob")
    bob_browser = new_client("bob")

    assert client.put(f"/api/users/{bob['id']}", json={"role": "admin"}).json()["data"]["role"] == "admin"
    assert client.put(f"/api/users/{bob['id']}", json={"role": "owner"}).status_code == 400
    assert client.put(f"/api/users/{bob['id']}", json={"status": "pending"}).status_code == 400

    client.put(f"/api/users/{bob['id']}", json={"status": "disabled"})
    assert bob_browser.get("/api/auth/me").status_code == 401


def test_admin_cannot_lock_themselves_out(client):
    me = client.get("/api/auth/me").json()["data"]
    assert client.put(f"/api/users/{me['id']}", json={"role": "member"}).status_code == 400
    assert client.delete(f"/api/users/{me['id']}").status_code == 400


def test_admin_deletes_a_user(client, make_user, new_client, get_db):
    bob = make_user("bob")
    bob_browser = new_client("bob")

    assert client.delete(f"/api/users/{bob['id']}").status_code == 200
    assert bob_browser.get("/api/auth/me").status_code == 401
    assert client.delete(f"/api/users/{bob['id']}").status_code == 404
    assert client.put("/api/users/999", json={"status": "active"}).status_code == 404
