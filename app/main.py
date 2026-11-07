"""FastAPI application entry point."""

import logging
from time import perf_counter

from fastapi import FastAPI, Request

from app.endpoints import router as analysis_router

logger = logging.getLogger("pump_analyzer")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

app = FastAPI(
    title="Pump Analyzer API",
    description=(
        "Учебный API для проверки и анализа JSON-записей датчиков насоса. "
        "Результаты гипотез являются эвристическими и не предназначены "
        "для управления реальным оборудованием."
    ),
)

app.include_router(analysis_router)


@app.middleware("http")
async def log_http_requests(request: Request, call_next):
    """Log the method, path, response status and processing time."""
    started_at = perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled error while processing %s %s",
            request.method,
            request.url.path,
        )
        raise

    elapsed_ms = (perf_counter() - started_at) * 1000
    logger.info(
        "%s %s -> %s (%.1f ms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


@app.get(
    "/",
    tags=["health"],
    summary="Проверка доступности backend",
    response_description="Подтверждение, что приложение отвечает на запросы.",
)
def read_root() -> dict[str, str]:
    """Return a short response used to check that the API is available."""
    return {"message": "Hello, World! Hello Tiny Tim!"}
