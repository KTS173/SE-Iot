import create_admin
from conftest import PASSWORD


def run(monkeypatch, answers, passwords):
    answers, passwords = iter(answers), iter(passwords)
    monkeypatch.setattr("builtins.input", lambda prompt: next(answers))
    monkeypatch.setattr(create_admin.getpass, "getpass", lambda prompt: next(passwords))
    return create_admin.main()


def test_creates_first_admin(get_db, new_client, monkeypatch):
    assert run(monkeypatch, ["root", "Root User", "root@lab.test"], ["supersecret", "supersecret"]) == 0
    me = new_client().post("/api/auth/login", json={"identifier": "root", "password": "supersecret"})
    assert (me.json()["data"]["role"], me.json()["data"]["status"]) == ("admin", "active")


def test_promotes_existing_user(get_db, make_user, new_client, monkeypatch):
    make_user("jane", status="pending")
    assert run(monkeypatch, ["jane"], []) == 0
    me = new_client("jane").get("/api/auth/me").json()["data"]
    assert (me["role"], me["status"]) == ("admin", "active")


def test_rejects_mismatched_or_short_password(get_db, monkeypatch, capsys):
    assert run(monkeypatch, ["root", "Root", "root@lab.test"], ["supersecret", "different"]) == 1
    assert "Passwords do not match" in capsys.readouterr().err
    assert run(monkeypatch, ["root", "Root", "root@lab.test"], ["short"]) == 1
    assert run(monkeypatch, ["root", "Root", "not-email"], [PASSWORD, PASSWORD]) == 1
