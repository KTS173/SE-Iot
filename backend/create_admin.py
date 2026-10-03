"""
Create the first admin, or promote an existing account to an approved admin.

    docker exec -it se-iot-backend python create_admin.py
"""
import config  # noqa: F401  loads .env first

import getpass
import sys
from datetime import datetime, timezone

import auth
from db import get_db, init_db


def main():
    init_db()
    username = input("Username: ").strip()
    with get_db() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            connection.execute(
                "UPDATE users SET role = 'admin', status = 'active', "
                "approved_at = COALESCE(approved_at, ?) WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), existing["id"]),
            )
            print(f"{username} is now an approved admin.")
            return 0

    values, error = auth.read_profile({
        "username": username,
        "name": input("Full name: "),
        "email": input("Email: "),
    })
    password = getpass.getpass("Password: ")
    error = error or auth.password_error(password)
    if not error and password != getpass.getpass("Repeat password: "):
        error = "Passwords do not match"
    if not error:
        _, error = auth.create_user(**values, password=password, role="admin", status="active")
    if error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(f"Admin {username} created.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
