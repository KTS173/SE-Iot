"""Alert incidents and LINE delivery log."""
from fastapi import APIRouter, Depends, Query

import alerts
import auth
import line_client
import timestamps
from routers import error_response

router = APIRouter(dependencies=[Depends(auth.approved_user)])


@router.get("/api/alerts")
def list_alerts(status: str = "active", limit: int = 50):
    """Active alerts by default; ?status=all for the incident history."""
    return {"data": alerts.list_alerts(status=status, limit=max(1, min(limit, 500)))}


@router.get("/api/notifications")
def list_notifications(
    limit: int = 50,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    status: str | None = None,
):
    """Delivery log: one row per alert message, with attempts and outcome."""
    try:
        lower, upper = timestamps.bounds(from_, to)
    except ValueError:
        return error_response("from and to must be ISO timestamps", 400)
    return {"data": line_client.list_deliveries(
        limit=max(1, min(limit, 500)), from_=lower, to=upper, status=status
    )}


@router.get("/api/notifications/days")
def notification_days(offset: int = 0):
    """Local dates that have messages, so the log's date picker can mark them."""
    offset = max(-14 * 3600, min(offset, 14 * 3600))
    return {"data": line_client.delivery_days(offset=offset)}
