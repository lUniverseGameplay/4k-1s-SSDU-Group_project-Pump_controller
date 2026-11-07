"""Persistence and console reporting for pump analysis results."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.visualization import create_pressure_rpm_graph

logger = logging.getLogger("pump_analyzer")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "output"


def get_output_dir() -> Path:
    """Return the configured output directory.

    PUMP_ANALYZER_OUTPUT_DIR can override the project-level ``output/`` folder.
    Relative override paths are interpreted relative to the project root.
    """
    configured = os.getenv("PUMP_ANALYZER_OUTPUT_DIR")
    if not configured:
        return _DEFAULT_OUTPUT_DIR

    path = Path(configured).expanduser()
    return path if path.is_absolute() else PROJECT_ROOT / path


def _safe_dataset_slug(dataset_id: Any) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", str(dataset_id)).strip("_-")
    return (slug or "dataset")[:48]


def _new_result_id(dataset_id: Any) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{_safe_dataset_slug(dataset_id)}_{timestamp}_{uuid.uuid4().hex[:8]}"


def _write_json(path: Path, value: Any) -> None:
    """Write JSON atomically so interrupted writes do not leave partial files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    with temporary_path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2, allow_nan=False)
        file.write("\n")
    temporary_path.replace(path)


def _log_summary(result: dict[str, Any], result_dir: Path) -> None:
    modes = result.get("modes_s") or {}
    rows = [
        "",
        "========== РЕЗУЛЬТАТЫ АНАЛИЗА НАСОСА ==========",
        f"Набор данных:             {result.get('dataset_id', '—')}",
        f"ID результата:            {result.get('result_id', '—')}",
        f"Количество измерений:     {result.get('sample_count', 0)}",
        f"Общая продолжительность:  {result.get('span_s', 0)} с",
        f"Время работы:             {result.get('working_s', 0)} с",
        f"Время остановки:          {result.get('stopped_s', 0)} с",
        f"Время пропусков:          {result.get('gap_s', 0)} с",
        f"Недостоверные данные:     {result.get('invalid_s', 0)} с",
        f"Неизвестное состояние:    {result.get('unknown_s', 0)} с",
        (
            "Режимы:                  "
            f"low={modes.get('low', 0)} с, "
            f"normal={modes.get('normal', 0)} с, "
            f"high={modes.get('high', 0)} с"
        ),
        "",
        "Гипотезы:",
        "№  | Название | Статус | JSON-файл",
        "---|---|---|---",
    ]

    for hypothesis in result.get("hypotheses", []):
        number = hypothesis.get("id", "?")
        title = hypothesis.get("title", "Без названия")
        status = hypothesis.get("status", "unknown")
        relative_file = hypothesis.get("result_file", "—")
        rows.append(f"{number:>2} | {title} | {status} | {relative_file}")

    rows.extend(("", f"Файлы сохранены в: {result_dir}", "===============================================", ""))
    logger.info("\n%s", "\n".join(rows))


def save_analysis_result(
    analysis: dict[str, Any], output_root: str | Path | None = None
) -> dict[str, Any]:
    """Save analysis JSON, one JSON per hypothesis, and its PNG graph.

    The returned result contains a unique ``result_id`` and API URLs that the
    frontend can use to fetch the saved JSON files and graph.
    """
    root = Path(output_root) if output_root is not None else get_output_dir()
    result_id = _new_result_id(analysis.get("dataset_id", "dataset"))
    result_dir = root / result_id
    hypotheses_dir = result_dir / "hypotheses"
    graphs_dir = result_dir / "graphs"
    graph_path = graphs_dir / "pressure_rpm.png"

    result = dict(analysis)
    saved_at = datetime.now(timezone.utc).isoformat()
    hypotheses: list[dict[str, Any]] = []
    hypothesis_artifacts: list[dict[str, Any]] = []

    for item in analysis.get("hypotheses", []):
        hypothesis = dict(item)
        hypothesis_id = int(hypothesis.get("id", len(hypotheses) + 1))
        relative_file = f"{result_id}/hypotheses/hypothesis_{hypothesis_id:02d}.json"
        file_url = f"/api/results/{result_id}/hypotheses/{hypothesis_id}"
        hypothesis["result_file"] = relative_file
        hypothesis["result_file_url"] = file_url
        hypotheses.append(hypothesis)
        hypothesis_artifacts.append(
            {
                "id": hypothesis_id,
                "status": hypothesis.get("status", "unknown"),
                "file": relative_file,
                "url": file_url,
            }
        )

    result["hypotheses"] = hypotheses
    result["result_id"] = result_id
    result["generated_at"] = saved_at
    result["artifacts"] = {
        "analysis": {
            "file": f"{result_id}/analysis.json",
            "url": f"/api/results/{result_id}",
        },
        "graph": {
            "file": f"{result_id}/graphs/pressure_rpm.png",
            "url": f"/api/results/{result_id}/graph",
        },
        "hypotheses": hypothesis_artifacts,
    }

    try:
        result_dir.mkdir(parents=True, exist_ok=False)
        hypotheses_dir.mkdir(parents=True, exist_ok=True)
        graphs_dir.mkdir(parents=True, exist_ok=True)

        create_pressure_rpm_graph(result, graph_path)

        for hypothesis in hypotheses:
            hypothesis_id = int(hypothesis["id"])
            _write_json(
                hypotheses_dir / f"hypothesis_{hypothesis_id:02d}.json",
                hypothesis,
            )

        _write_json(result_dir / "analysis.json", result)
    except Exception:
        logger.exception("Could not save analysis artifacts for result %s", result_id)
        shutil.rmtree(result_dir, ignore_errors=True)
        raise

    _log_summary(result, result_dir)
    logger.info("Analysis artifacts saved: result_id=%s", result_id)
    return result


def _safe_result_directory(result_id: str, output_root: str | Path | None = None) -> Path | None:
    """Resolve a result directory while rejecting path traversal attempts."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", result_id):
        return None

    root = (Path(output_root) if output_root is not None else get_output_dir()).resolve()
    candidate = (root / result_id).resolve()
    if candidate.parent != root:
        return None
    return candidate


def get_analysis_file(result_id: str, output_root: str | Path | None = None) -> Path | None:
    directory = _safe_result_directory(result_id, output_root)
    return directory / "analysis.json" if directory is not None else None


def get_graph_file(result_id: str, output_root: str | Path | None = None) -> Path | None:
    directory = _safe_result_directory(result_id, output_root)
    return directory / "graphs" / "pressure_rpm.png" if directory is not None else None


def get_hypothesis_file(
    result_id: str, hypothesis_id: int, output_root: str | Path | None = None
) -> Path | None:
    if not 1 <= hypothesis_id <= 10:
        return None
    directory = _safe_result_directory(result_id, output_root)
    if directory is None:
        return None
    return directory / "hypotheses" / f"hypothesis_{hypothesis_id:02d}.json"
