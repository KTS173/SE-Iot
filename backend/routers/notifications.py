"""Alert incidents and LINE delivery log."""
from fastapi import APIRouter, Depends

import alerts
import auth
import line_client

router = APIRouter(dependencies=[Depends(auth.approved_user)])


@router.get("/api/alerts")
def list_alerts(status: str = "active", limit: int = 50):
    """Active alerts by default; ?status=all for the incident history."""
    return {"data": alerts.list_alerts(status=status, limit=min(limit, 500))}


@router.get("/api/notifications")
def list_notifications(limit: int = 50):
    """Delivery log: one row per alert message, with attempts and outcome."""
    return {"data": line_client.list_deliveries(limit=min(limit, 500))}
