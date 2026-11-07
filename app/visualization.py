"""Matplotlib charts for pump sensor analysis results."""

from __future__ import annotations

import math
from pathlib import Path
from threading import Lock
from typing import Any

import matplotlib

# The API usually runs without a graphical desktop (for example, on a server).
matplotlib.use("Agg")

import matplotlib.pyplot as plt
from matplotlib.patches import Patch


def _number_or_none(value: Any) -> float | None:
    """Return a finite numeric value, excluding bool, or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _merged_problem_intervals(
    intervals: list[dict[str, Any]],
) -> list[tuple[float, float, str]]:
    """Merge adjacent intervals of the same problematic state for cleaner shading."""
    merged: list[tuple[float, float, str]] = []
    for interval in intervals:
        state = interval.get("state")
        if state not in {"gap", "invalid"}:
            continue

        start = _number_or_none(interval.get("start_s"))
        end = _number_or_none(interval.get("end_s"))
        if start is None or end is None or end <= start:
            continue

        if merged and merged[-1][2] == state and math.isclose(
            merged[-1][1], start, rel_tol=0.0, abs_tol=1e-9
        ):
            previous_start, _, previous_state = merged[-1]
            merged[-1] = (previous_start, end, previous_state)
        else:
            merged.append((start, end, state))

    return merged


def _create_pressure_rpm_graph(
    analysis: dict[str, Any], destination: str | Path
) -> Path:
    """Create a two-panel time-series graph and save it as a PNG image.

    The values are drawn as horizontal interval segments because the analysis
    rules treat the left sample's values as constant over [start_s, end_s).
    Gap and invalid intervals are shaded and deliberately have no data line.
    """
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    samples = analysis.get("samples") or []
    intervals = analysis.get("intervals") or []
    dataset_id = str(analysis.get("dataset_id", "pump recording"))

    fig, (pressure_ax, rpm_ax) = plt.subplots(
        nrows=2,
        ncols=1,
        sharex=True,
        figsize=(12, 7),
        constrained_layout=True,
    )

    try:
        times = [
            value
            for sample in samples
            if (value := _number_or_none(sample.get("t_s"))) is not None
        ]

        pressure_values: list[float] = []
        rpm_values: list[float] = []
        for index, sample in enumerate(samples):
            # The final sample only closes the previous interval. It does not
            # define a new interval, so its value is not extended on the plot.
            if index >= len(intervals):
                pressure_values.append(math.nan)
                rpm_values.append(math.nan)
                continue

            state = intervals[index].get("state")
            if state in {"gap", "invalid"}:
                # NaN breaks the step line over the whole problematic interval.
                pressure_values.append(math.nan)
                rpm_values.append(math.nan)
                continue

            pressure = _number_or_none(sample.get("pressure_mpa"))
            rpm = _number_or_none(sample.get("rpm"))
            pressure_values.append(pressure if pressure is not None else math.nan)
            rpm_values.append(rpm if rpm is not None else math.nan)

        pressure_line = None
        rpm_line = None
        if times and len(times) == len(pressure_values):
            pressure_line = pressure_ax.step(
                times, pressure_values, where="post", linewidth=1.6, label="Давление"
            )[0]
            rpm_line = rpm_ax.step(
                times, rpm_values, where="post", linewidth=1.6, label="Обороты"
            )[0]

        # A one-point recording has no intervals, but the point itself is still
        # useful to show. Empty recordings are handled with an explanatory note.
        if len(samples) == 1 and not intervals:
            sample = samples[0]
            t_s = _number_or_none(sample.get("t_s"))
            if t_s is not None:
                pressure = _number_or_none(sample.get("pressure_mpa"))
                rpm = _number_or_none(sample.get("rpm"))
                if pressure is not None:
                    pressure_ax.plot([t_s], [pressure], marker="o", linestyle="None")
                if rpm is not None:
                    rpm_ax.plot([t_s], [rpm], marker="o", linestyle="None")

        problem_intervals = _merged_problem_intervals(intervals)
        has_gap = any(state == "gap" for _, _, state in problem_intervals)
        has_invalid = any(state == "invalid" for _, _, state in problem_intervals)

        for start, end, state in problem_intervals:
            if state == "gap":
                shade = "#9e9e9e"
                alpha = 0.25
            else:
                shade = "#e57373"
                alpha = 0.22
            pressure_ax.axvspan(start, end, color=shade, alpha=alpha, zorder=0)
            rpm_ax.axvspan(start, end, color=shade, alpha=alpha, zorder=0)

        for axis, label in (
            (pressure_ax, "Давление, МПа"),
            (rpm_ax, "Обороты, об/мин"),
        ):
            axis.set_ylabel(label)
            axis.grid(True, alpha=0.25)

        pressure_ax.set_title(f"Показания датчиков насоса — {dataset_id}")
        rpm_ax.set_xlabel("Время, с")

        problem_handles: list[Patch] = []
        if has_gap:
            problem_handles.append(
                Patch(facecolor="#9e9e9e", alpha=0.25, label="Пропуск (gap)")
            )
        if has_invalid:
            problem_handles.append(
                Patch(facecolor="#e57373", alpha=0.22, label="Недостоверные данные (invalid)")
            )

        if pressure_line is not None or problem_handles:
            pressure_handles, _ = pressure_ax.get_legend_handles_labels()
            pressure_ax.legend(handles=pressure_handles + problem_handles, loc="best")
        if rpm_line is not None or problem_handles:
            rpm_handles, _ = rpm_ax.get_legend_handles_labels()
            rpm_ax.legend(handles=rpm_handles + problem_handles, loc="best")

        if not samples:
            pressure_ax.text(
                0.5, 0.5, "Нет измерений для отображения",
                ha="center", va="center", transform=pressure_ax.transAxes,
            )
            rpm_ax.text(
                0.5, 0.5, "Нет измерений для отображения",
                ha="center", va="center", transform=rpm_ax.transAxes,
            )
        elif not intervals:
            pressure_ax.text(
                0.02, 0.90, "Недостаточно точек для построения интервалов",
                ha="left", va="top", transform=pressure_ax.transAxes,
            )
            rpm_ax.text(
                0.02, 0.90, "Недостаточно точек для построения интервалов",
                ha="left", va="top", transform=rpm_ax.transAxes,
            )

        if times:
            left, right = min(times), max(times)
            if math.isclose(left, right):
                pressure_ax.set_xlim(left - 0.5, right + 0.5)
            else:
                pressure_ax.set_xlim(left, right)

        fig.savefig(destination, format="png", dpi=160)
    finally:
        plt.close(fig)

    return destination


# Matplotlib uses shared global state; serialize rendering when API requests
# are handled concurrently by FastAPI's worker threads.
_PLOT_LOCK = Lock()


def create_pressure_rpm_graph(
    analysis: dict[str, Any], destination: str | Path
) -> Path:
    """Thread-safe public wrapper for graph generation."""
    with _PLOT_LOCK:
        return _create_pressure_rpm_graph(analysis, destination)
