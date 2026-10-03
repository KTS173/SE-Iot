import base64
import json
import time
from urllib.parse import parse_qs, urlparse

import pytest

import auth
import config
from routers import google
from conftest import PASSWORD

CLIENT_ID = "client-123.apps.googleusercontent.com"


def jwt(claims):
    encode = lambda part: base64.urlsafe_b64encode(json.dumps(part).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{encode({'alg': 'RS256'})}.{encode(claims)}.signature"


class FakeTokenEndpoint:
    def __init__(self):
        self.claims = {}
        self.status = 200
        self.requests = []

    def post(self, url, data, timeout):
        self.requests.append(data)
        endpoint = self

        class Response:
            ok = endpoint.status == 200
            status_code = endpoint.status

            def json(self):
                return {"id_token": jwt(endpoint.claims)}

        return Response()


@pytest.fixture
def google_on(monkeypatch, get_db):
    monkeypatch.setattr(config, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(config, "google_client_secret", "secret")
    monkeypatch.setattr(config, "google_allowed_domains", set())
    monkeypatch.setattr(config, "public_url", "https://tempse.example.ts.net")
    fake = FakeTokenEndpoint()
    monkeypatch.setattr(google.requests, "post", fake.post)
    return fake


def sign_in_with_google(browser, fake, remember=False, **claims):
    """Run start -> (Google) -> callback; returns the callback response."""
    start = browser.get(f"/api/auth/google/start?remember={str(remember).lower()}", follow_redirects=False)
    assert start.status_code == 303
    query = parse_qs(urlparse(start.headers["location"]).query)
    fake.claims = {
        "iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": time.time() + 300,
        "sub": "google-1", "email": "Jane@Gmail.com", "email_verified": True,
        "name": "Jane Google", "nonce": query["nonce"][0], **claims,
    }
    return browser.get(
        f"/api/auth/google/callback?code=abc&state={query['state'][0]}", follow_redirects=False
    )


def test_providers_reports_whether_google_is_configured(new_client, google_on, monkeypatch):
    assert new_client().get("/api/auth/providers").json() == {"data": {"google": True}}
    monkeypatch.setattr(config, "google_client_secret", "")
    assert new_client().get("/api/auth/providers").json() == {"data": {"google": False}}


def test_start_redirects_to_google_with_exact_redirect_uri(new_client, google_on):
    response = new_client().get("/api/auth/google/start", follow_redirects=False)
    location = urlparse(response.headers["location"])
    query = parse_qs(location.query)
    assert location.netloc == "accounts.google.com"
    assert query["redirect_uri"] == ["https://tempse.example.ts.net/api/auth/google/callback"]
    assert query["scope"] == ["openid email profile"]
    assert "httponly" in response.headers["set-cookie"].lower()


def test_start_without_configuration_returns_to_signin(new_client, get_db):
    response = new_client().get("/api/auth/google/start", follow_redirects=False)
    assert response.headers["location"] == "/signin?error=google_unavailable"


def test_new_google_user_becomes_pending_member(new_client, google_on, get_db):
    browser = new_client()
    response = sign_in_with_google(browser, google_on)

    assert response.headers["location"] == "/"
    me = browser.get("/api/auth/me").json()["data"]
    assert (me["email"], me["username"], me["status"], me["role"]) == ("jane@gmail.com", "jane", "pending", "member")
    assert me["has_password"] is False
    assert me["google_linked"] is True
    assert google_on.requests[0]["redirect_uri"] == "https://tempse.example.ts.net/api/auth/google/callback"
    # A Google-only account has no password anyone could guess.
    assert new_client().post("/api/auth/login", json={"identifier": "jane", "password": "!"}).status_code == 401


def test_existing_account_with_same_email_is_linked(new_client, make_user, google_on):
    make_user("jane")  # email jane@lab.test
    browser = new_client()
    sign_in_with_google(browser, google_on, email="jane@lab.test", sub="google-9")
    me = browser.get("/api/auth/me").json()["data"]
    assert (me["username"], me["status"], me["google_linked"]) == ("jane", "active", True)

    # Next time the Google id alone finds the account, even if the email changed.
    again = new_client()
    sign_in_with_google(again, google_on, email="new@gmail.com", sub="google-9")
    assert again.get("/api/auth/me").json()["data"]["username"] == "jane"


def test_username_clash_gets_a_number(new_client, make_user, google_on):
    make_user("jane")
    browser = new_client()
    sign_in_with_google(browser, google_on)
    assert browser.get("/api/auth/me").json()["data"]["username"] == "jane2"


def test_remember_me_carries_through_google(new_client, google_on):
    response = sign_in_with_google(new_client(), google_on, remember=True)
    assert "max-age=2592000" in response.headers["set-cookie"].lower()


@pytest.mark.parametrize(
    "claims, error",
    [
        ({"email_verified": False}, "google_email"),
        ({"aud": "someone-else"}, "google_failed"),
        ({"iss": "https://evil.example"}, "google_failed"),
        ({"exp": time.time() - 10}, "google_failed"),
        ({"nonce": "replayed"}, "google_failed"),
    ],
)
def test_untrusted_tokens_are_rejected(new_client, google_on, claims, error):
    browser = new_client()
    response = sign_in_with_google(browser, google_on, **claims)
    assert response.headers["location"] == f"/signin?error={error}"
    assert browser.get("/api/auth/me").status_code == 401


def test_callback_without_matching_state_is_rejected(new_client, google_on):
    browser = new_client()
    browser.get("/api/auth/google/start", follow_redirects=False)
    response = browser.get("/api/auth/google/callback?code=abc&state=forged", follow_redirects=False)
    assert response.headers["location"] == "/signin?error=google_state"
    assert google_on.requests == []  # never asked Google


def test_user_cancelling_at_google(new_client, google_on):
    response = new_client().get("/api/auth/google/callback?error=access_denied", follow_redirects=False)
    assert response.headers["location"] == "/signin?error=google_cancelled"


def test_token_endpoint_failure(new_client, google_on):
    google_on.status = 400
    response = sign_in_with_google(new_client(), google_on)
    assert response.headers["location"] == "/signin?error=google_failed"


def test_allowed_domains(new_client, google_on, monkeypatch):
    monkeypatch.setattr(config, "google_allowed_domains", {"cmu.ac.th"})
    blocked = sign_in_with_google(new_client(), google_on)
    assert blocked.headers["location"] == "/signin?error=google_domain"
    allowed = sign_in_with_google(new_client(), google_on, email="jane@cmu.ac.th")
    assert allowed.headers["location"] == "/"


def test_disabled_account_cannot_use_google(new_client, make_user, google_on):
    make_user("jane", status="disabled")
    response = sign_in_with_google(new_client(), google_on, email="jane@lab.test")
    assert response.headers["location"] == "/signin?error=account_disabled"


def test_google_only_user_can_set_first_password(new_client, google_on):
    browser = new_client()
    sign_in_with_google(browser, google_on)
    response = browser.post("/api/auth/password", json={"new_password": PASSWORD})
    assert response.status_code == 200
    assert browser.get("/api/auth/me").json()["data"]["has_password"] is True
    login = new_client().post("/api/auth/login", json={"identifier": "jane@gmail.com", "password": PASSWORD})
    assert login.status_code == 200


def test_old_database_gains_google_column(tmp_path, monkeypatch, disk):
    import sqlite3

    import db
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, "
            "username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE, "
            "password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', "
            "status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, approved_at TEXT)"
        )
    monkeypatch.setattr(config, "database_path", str(path))
    db.init_db()
    _, error = auth.create_user("A", "aaa", "a@x.test", None, google_id="g-1")
    assert error is None
