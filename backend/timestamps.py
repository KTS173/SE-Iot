"""Range filters over the ISO-8601 UTC strings stored in the database."""
from datetime import datetime, timedelta, timezone


def parse(value):
    """An aware UTC datetime from an ISO string ('Z' or an offset); ValueError otherwise."""
    moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _prefix(moment):
    # Stored values look like '2026-10-03T17:00:00.123456+00:00', or without the
    # fraction when it is zero. Leaving the suffix off the bound makes plain string
    # comparison chronological for both shapes, so the received_at index still applies.
    text = moment.strftime("%Y-%m-%dT%H:%M:%S")
    return f"{text}.{moment.microsecond:06d}" if moment.microsecond else text


def bounds(from_=None, to=None):
    """(lower, upper) for `column >= lower AND column < upper`; None leaves a side open."""
    lower = _prefix(parse(from_)) if from_ else None
    upper = _prefix(parse(to) + timedelta(microseconds=1)) if to else None
    return lower, upper
