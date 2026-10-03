"""LINE webhook, setup status, and test push."""
import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

import alerts
import line_client
from routers import error_response

router = APIRouter()


@router.post("/api/line/webhook")
async def line_webhook(request: Request):
    """
    Endpoint registered in the LINE Developers Console.

    Every request is signature-checked before it can touch the recipient list,
    and LINE retries on anything but a fast 200, so failures here stay quiet
    and never raise.
    """
    body = await request.body()
    signature = request.headers.get("X-Line-Signature", "")
    if not line_client.verify_signature(body, signature):
        return error_response("invalid signature", 403)
    try:
        events = json.loads(body.decode("utf-8")).get("events", [])
        # Handling may call the LINE API; keep that off the event loop.
        await run_in_threadpool(line_client.handle_webhook_events, events)
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError) as error:
        print(f"Ignored malformed LINE webhook: {error}")
    return {"status": "ok"}


@router.get("/api/line/status")
def line_status():
    return {
        "data": {
            "configured": line_client.enabled(),
            "recipients": line_client.list_recipients(),
            "active_alerts": len(alerts.list_alerts(status="active", limit=500)),
            "deliveries": line_client.delivery_counts(),
        }
    }


@router.post("/api/line/test")
def line_test():
    """Send a test push so setup can be verified without waiting for a breach."""
    sent, error = line_client.send_text(
        "Test notification from the lab environment monitor. "
        "Alerts will arrive here."
    )
    if error:
        return JSONResponse({"error": error, "sent": sent}, status_code=502)
    return {"data": {"sent": sent}}
