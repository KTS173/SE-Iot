"""SQLite connection, schema, and row conversion."""
import os
import sqlite3

import alerts
import config
import line_client


def get_db():
    connection = sqlite3.connect(config.database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    database_dir = os.path.dirname(config.database_path)
    if database_dir:
        os.makedirs(database_dir, exist_ok=True)
    with get_db() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                temperature REAL NOT NULL,
                humidity REAL NOT NULL,
                pressure REAL,
                received_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sensor_received_at "
            "ON sensor_readings(received_at DESC)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sensor_config (
                device_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                location TEXT NOT NULL,
                x REAL NOT NULL DEFAULT 50,
                y REAL NOT NULL DEFAULT 50,
                min_temp REAL NOT NULL DEFAULT 18,
                max_temp REAL NOT NULL DEFAULT 30,
                min_humidity REAL NOT NULL DEFAULT 35,
                max_humidity REAL NOT NULL DEFAULT 65
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                approved_at TEXT
            )
            """
        )
        # Signing out deletes the row, so a stolen cookie stops working at once.
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)"
        )
        alerts.init_alert_tables(connection)
        line_client.init_line_tables(connection)
    with get_db() as connection:
        if connection.execute("PRAGMA auto_vacuum").fetchone()[0] != 1:
            connection.execute("PRAGMA auto_vacuum=FULL")
            connection.execute("VACUUM")


def row_to_reading(row):
    if row is None:
        return None
    return {
        "device_id": row["device_id"],
        "temperature": row["temperature"],
        "humidity": row["humidity"],
        "pressure": row["pressure"],
        "received_at": row["received_at"],
    }
