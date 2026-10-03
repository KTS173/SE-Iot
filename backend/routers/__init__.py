from fastapi.responses import JSONResponse


def error_response(message, status_code):
    """Errors use {"error": "..."}, the shape the frontend already reads."""
    return JSONResponse({"error": message}, status_code=status_code)
