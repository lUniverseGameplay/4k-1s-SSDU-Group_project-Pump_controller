"""HTTP endpoints for analyzing and retrieving pump recording results."""

import logging
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from app.core import AnalysisError, analyze_json
from app.output_manager import (
    get_analysis_file,
    get_graph_file,
    get_hypothesis_file,
    save_analysis_result,
)

logger = logging.getLogger("pump_analyzer")

router = APIRouter(prefix="/api", tags=["analysis"])


@router.post(
    "/analyze",
    summary="Анализ записи датчиков насоса",
    description=(
        "Принимает один JSON-файл в поле `file` формы `multipart/form-data`. "
        "Проверяет данные, рассчитывает метрики и гипотезы, строит график, "
        "сохраняет результаты в `output/` и возвращает JSON с URL артефактов."
    ),
    response_description="Результаты анализа и ссылки на сохранённые артефакты.",
)
async def analyze_file(
    file: UploadFile = File(
        ...,
        description="JSON-файл с показаниями датчиков насоса.",
    ),
) -> dict[str, Any]:
    """Analyze the uploaded JSON and persist its results and visualization."""
    try:
        payload = await file.read()
        logger.info("Received pump recording (%d bytes)", len(payload))

        # Анализ, отрисовка Matplotlib и запись файлов синхронные операции.
        # Выполняем их в thread pool, чтобы не блокировать event loop FastAPI.
        result = await run_in_threadpool(analyze_json, payload)
        result = await run_in_threadpool(save_analysis_result, result)

        logger.info(
            "Pump recording analyzed and saved: result_id=%s, samples=%d",
            result.get("result_id"),
            result.get("sample_count", 0),
        )
        return result
    except AnalysisError as error:
        # Ожидаемая ошибка входных данных: файл не анализируется и не сохраняется.
        logger.warning("Pump recording rejected: category=%s, message=%s", error.category, str(error))
        raise HTTPException(
            status_code=422,
            detail={
                "status": "format_error",
                "category": error.category,
                "message": str(error),
                "totals": None,
            },
        ) from error
    finally:
        await file.close()


@router.get(
    "/results/{result_id}/graph",
    summary="Получить график давления и оборотов",
    response_description="PNG-график с общей временной осью и выделенными gap/invalid участками.",
)
def get_result_graph(result_id: str) -> FileResponse:
    graph_path = get_graph_file(result_id)
    if graph_path is None or not graph_path.is_file():
        raise HTTPException(status_code=404, detail="График для указанного результата не найден.")
    return FileResponse(graph_path, media_type="image/png")


@router.get(
    "/results/{result_id}/hypotheses/{hypothesis_id}",
    summary="Получить JSON отдельной гипотезы",
    response_description="Сохранённый JSON с результатом выбранной гипотезы.",
)
def get_result_hypothesis(result_id: str, hypothesis_id: int) -> FileResponse:
    hypothesis_path = get_hypothesis_file(result_id, hypothesis_id)
    if hypothesis_path is None or not hypothesis_path.is_file():
        raise HTTPException(status_code=404, detail="Файл гипотезы не найден.")
    return FileResponse(hypothesis_path, media_type="application/json")


@router.get(
    "/results/{result_id}",
    summary="Получить сохранённый результат анализа",
    response_description="Полный JSON с метриками, интервалами, гипотезами и ссылками на артефакты.",
)
def get_saved_result(result_id: str) -> FileResponse:
    analysis_path = get_analysis_file(result_id)
    if analysis_path is None or not analysis_path.is_file():
        raise HTTPException(status_code=404, detail="Результат анализа не найден.")
    return FileResponse(analysis_path, media_type="application/json")
