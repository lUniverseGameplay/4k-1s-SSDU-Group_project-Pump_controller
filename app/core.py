"""Validation and analysis of pump sensor recordings."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from statistics import fmean
from typing import Any, NoReturn

MAX_INTERVAL_S = 1.5
WORKING_RPM_MIN = 50
WORKING_PRESSURE_MIN_MPA = 1
HYPOTHESIS_6_TRANSITIONS_PER_HOUR = 10
HYPOTHESIS_5_DROP_PERCENT = 10
HYPOTHESIS_5_SEGMENT_FRACTION = 0.2


class AnalysisError(ValueError):
    """A user-correctable error in the uploaded JSON recording."""

    def __init__(self, category: str, message: str) -> None:
        super().__init__(message)
        self.category = category


@dataclass(frozen=True)
class Sample:
    t_s: float
    pressure_mpa: float | None
    rpm: float | None
    valid: bool


@dataclass(frozen=True)
class Dataset:
    schema_version: str
    dataset_id: str
    synthetic: bool
    samples: list[Sample]


@dataclass(frozen=True)
class Interval:
    start_s: float
    end_s: float
    duration_s: float
    state: str
    mode: str | None
    pressure_mpa: float | None
    rpm: float | None


def _fail(category: str, message: str) -> NoReturn:
    raise AnalysisError(category, message)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _required(mapping: dict[str, Any], key: str, location: str) -> Any:
    if key not in mapping:
        _fail("missing_field", f"В {location} отсутствует поле {key}.")
    return mapping[key]


def _finite_number(value: Any, location: str) -> float:
    if not _is_number(value):
        _fail("wrong_type", f"В {location} записано значение неверного типа: ожидается число.")
    try:
        number = float(value)
    except OverflowError:
        _fail("wrong_type", f"В {location} должно быть конечное число.")
    if not math.isfinite(number):
        _fail("wrong_type", f"В {location} должно быть конечное число.")
    return number


def parse_dataset(payload: bytes | str) -> Dataset:
    """Decode and validate a UTF-8 JSON recording before any metrics are calculated."""
    try:
        text = payload.decode("utf-8-sig") if isinstance(payload, bytes) else payload
        raw = json.loads(
            text,
            parse_constant=lambda value: _fail(
                "wrong_type", f"Значение {value} не является допустимым числом JSON."
            ),
        )
    except UnicodeDecodeError as error:
        raise AnalysisError("invalid_json", "Файл должен быть сохранён в кодировке UTF-8.") from error
    except json.JSONDecodeError as error:
        raise AnalysisError(
            "invalid_json",
            f"Невалидный JSON: ошибка в строке {error.lineno}, столбце {error.colno}.",
        ) from error

    if not isinstance(raw, dict):
        _fail("wrong_type", "Корневое значение JSON должно быть объектом.")

    schema_version = _required(raw, "schema_version", "корневом объекте")
    if not isinstance(schema_version, str):
        _fail("wrong_type", "Поле schema_version должно быть строкой.")
    if schema_version != "1.0":
        _fail("unsupported_version", f"Версия schema_version {schema_version!r} не поддерживается.")

    dataset_id = _required(raw, "dataset_id", "корневом объекте")
    if not isinstance(dataset_id, str):
        _fail("wrong_type", "Поле dataset_id должно быть строкой.")

    synthetic = _required(raw, "synthetic", "корневом объекте")
    if not isinstance(synthetic, bool):
        _fail("wrong_type", "Поле synthetic должно быть логическим значением.")

    raw_samples = _required(raw, "samples", "корневом объекте")
    if not isinstance(raw_samples, list):
        _fail("wrong_type", "Поле samples должно быть массивом.")

    samples: list[Sample] = []
    previous_time: float | None = None
    for index, raw_sample in enumerate(raw_samples):
        location = f"samples[{index}]"
        if not isinstance(raw_sample, dict):
            _fail("wrong_type", f"{location} должно быть объектом.")

        t_s = _finite_number(_required(raw_sample, "t_s", location), f"{location}.t_s")
        if t_s < 0:
            _fail("non_increasing_time", f"{location}.t_s не может быть отрицательным.")
        if previous_time is not None and t_s <= previous_time:
            reason = "повторяет" if t_s == previous_time else "меньше предыдущей метки"
            _fail("non_increasing_time", f"{location}.t_s {reason} времени.")
        previous_time = t_s

        pressure = _required(raw_sample, "pressure_mpa", location)
        if pressure is not None:
            pressure = _finite_number(pressure, f"{location}.pressure_mpa")

        rpm = _required(raw_sample, "rpm", location)
        if rpm is not None:
            rpm = _finite_number(rpm, f"{location}.rpm")

        valid = _required(raw_sample, "valid", location)
        if not isinstance(valid, bool):
            _fail("wrong_type", f"В {location}.valid должно быть логическое значение.")

        samples.append(Sample(t_s, pressure, rpm, valid))

    return Dataset(schema_version, dataset_id, synthetic, samples)


def _classify_intervals(samples: list[Sample]) -> list[Interval]:
    intervals: list[Interval] = []
    for left, right in zip(samples, samples[1:]):
        duration = right.t_s - left.t_s
        mode: str | None = None
        if duration > MAX_INTERVAL_S:
            state = "gap"
        elif (
            not left.valid
            or left.pressure_mpa is None
            or left.rpm is None
            or left.pressure_mpa < 0
            or left.rpm < 0
        ):
            state = "invalid"
        elif left.rpm >= WORKING_RPM_MIN and left.pressure_mpa >= WORKING_PRESSURE_MIN_MPA:
            state = "working"
            if left.pressure_mpa < 5:
                mode = "low"
            elif left.pressure_mpa < 10:
                mode = "normal"
            else:
                mode = "high"
        else:
            state = "stopped"

        intervals.append(
            Interval(
                left.t_s,
                right.t_s,
                duration,
                state,
                mode,
                left.pressure_mpa,
                left.rpm,
            )
        )
    return intervals


def _hypothesis(
    number: int,
    title: str,
    detected: bool | None,
    details: dict[str, Any],
    message: str,
) -> dict[str, Any]:
    status = (
        "insufficient_data"
        if detected is None
        else "detected"
        if detected
        else "not_detected"
    )
    return {
        "id": number,
        "title": title,
        "status": status,
        "detected": detected,
        "message": message,
        "details": details,
    }


def _hypotheses(
    samples: list[Sample], intervals: list[Interval], totals: dict[str, Any]
) -> list[dict[str, Any]]:
    span = totals["span_s"]
    working_s = totals["working_s"]
    stopped_s = totals["stopped_s"]
    gap_s = totals["gap_s"]
    invalid_s = totals["invalid_s"]

    flush_events: list[dict[str, float]] = []
    run_start: float | None = None
    run_end = 0.0
    pressure_values: list[float] = []
    rpm_values: list[float] = []
    for interval in intervals:
        qualifies = (
            interval.state != "gap"
            and interval.state != "invalid"
            and interval.pressure_mpa is not None
            and interval.rpm is not None
            and interval.pressure_mpa < 5
            and interval.rpm >= WORKING_RPM_MIN
        )
        if qualifies:
            if run_start is None:
                run_start = interval.start_s
                pressure_values = []
                rpm_values = []
            run_end = interval.end_s
            pressure_values.append(interval.pressure_mpa)
            rpm_values.append(interval.rpm)
        elif run_start is not None:
            if run_end - run_start >= 300:
                flush_events.append(
                    {
                        "start_s": run_start,
                        "end_s": run_end,
                        "duration_s": run_end - run_start,
                        "mean_pressure_mpa": fmean(pressure_values),
                        "mean_rpm": fmean(rpm_values),
                    }
                )
            run_start = None
    if run_start is not None and run_end - run_start >= 300:
        flush_events.append(
            {
                "start_s": run_start,
                "end_s": run_end,
                "duration_s": run_end - run_start,
                "mean_pressure_mpa": fmean(pressure_values),
                "mean_rpm": fmean(rpm_values),
            }
        )

    run_stop_transitions: list[dict[str, Any]] = []
    previous_operating_state: str | None = None
    for interval in intervals:
        current = interval.state if interval.state in {"working", "stopped"} else None
        if current is None:
            previous_operating_state = None
        elif previous_operating_state is not None and current != previous_operating_state:
            run_stop_transitions.append(
                {
                    "t_s": interval.start_s,
                    "transition": f"{previous_operating_state}_to_{current}",
                }
            )
            previous_operating_state = current
        else:
            previous_operating_state = current

    stop_ratio = stopped_s / span if span else 0.0
    gap_ratio = gap_s / span if span else 0.0
    invalid_ratio = invalid_s / span if span else 0.0

    beginning: dict[float, list[float]] = {}
    ending: dict[float, list[float]] = {}
    if span:
        beginning_end = samples[0].t_s + span * HYPOTHESIS_5_SEGMENT_FRACTION
        ending_start = samples[0].t_s + span * (1 - HYPOTHESIS_5_SEGMENT_FRACTION)
        for sample in samples:
            if (
                not sample.valid
                or sample.pressure_mpa is None
                or sample.rpm is None
                or sample.pressure_mpa < WORKING_PRESSURE_MIN_MPA
                or sample.rpm < WORKING_RPM_MIN
            ):
                continue
            if sample.t_s <= beginning_end:
                beginning.setdefault(sample.rpm, []).append(sample.pressure_mpa)
            if sample.t_s >= ending_start:
                ending.setdefault(sample.rpm, []).append(sample.pressure_mpa)
    shared_rpms = sorted(beginning.keys() & ending.keys())
    if shared_rpms:
        pressure_begin = fmean(fmean(beginning[rpm]) for rpm in shared_rpms)
        pressure_end = fmean(fmean(ending[rpm]) for rpm in shared_rpms)
        drop_percent = (
            (pressure_begin - pressure_end) / pressure_begin * 100
            if pressure_begin > 0
            else 0.0
        )
        degradation_detected: bool | None = (
            drop_percent > HYPOTHESIS_5_DROP_PERCENT
        )
    else:
        pressure_begin = None
        pressure_end = None
        drop_percent = None
        degradation_detected = None

    mode_transitions: list[dict[str, Any]] = []
    previous_mode: str | None = None
    for interval in intervals:
        if interval.state != "working" or interval.mode is None:
            previous_mode = None
            continue
        if previous_mode is not None and interval.mode != previous_mode:
            mode_transitions.append(
                {
                    "t_s": interval.start_s,
                    "from": previous_mode,
                    "to": interval.mode,
                }
            )
        previous_mode = interval.mode
    transitions_per_hour = len(mode_transitions) / (span / 3600) if span else 0.0

    low_pressure_events = [
        interval
        for interval in intervals
        if interval.state == "working"
        and interval.rpm is not None
        and interval.pressure_mpa is not None
        and interval.rpm >= 100
        and interval.pressure_mpa < 5
    ]
    low_pressure_s = sum(interval.duration_s for interval in low_pressure_events)

    high_s = totals["modes_s"]["high"]
    high_ratio = high_s / working_s if working_s else 0.0

    gaps = [index for index, interval in enumerate(intervals) if interval.state == "gap"]
    post_gap_high = [
        index + 1
        for index in gaps
        if index + 1 < len(intervals)
        and intervals[index + 1].state == "working"
        and intervals[index + 1].mode == "high"
    ]

    invalid_starts: list[float] = []
    was_invalid = False
    for interval in intervals:
        is_invalid = interval.state == "invalid"
        if is_invalid and not was_invalid:
            invalid_starts.append(interval.start_s)
        was_invalid = is_invalid
    separations = [
        right - left for left, right in zip(invalid_starts, invalid_starts[1:])
    ]
    best_cluster: list[float] = []
    best_period = 0.0
    for candidate in separations:
        cluster = [
            separation
            for separation in separations
            if abs(separation - candidate) <= abs(candidate) * 0.1
        ]
        if len(cluster) > len(best_cluster):
            best_cluster = cluster
            best_period = fmean(cluster)
    periodic_pattern = len(best_cluster) >= 3

    return [
        _hypothesis(
            1,
            "Процесс промывки системы",
            bool(flush_events),
            {"minimum_duration_s": 300, "events": flush_events},
            "Найдены непрерывные интервалы низкого давления и высоких оборотов."
            if flush_events
            else "Подходящих непрерывных интервалов длительностью не менее 300 секунд нет.",
        ),
        _hypothesis(
            2,
            "Аномальные остановки",
            stop_ratio > 0.5 if span else False,
            {
                "transitions": run_stop_transitions,
                "transition_count": len(run_stop_transitions),
                "stopped_s": stopped_s,
                "stopped_fraction": stop_ratio,
                "threshold": 0.5,
            },
            "Доля остановок превышает 50% длительности записи."
            if span and stop_ratio > 0.5
            else "Доля остановок не превышает 50% длительности записи.",
        ),
        _hypothesis(
            3,
            "Предполагаемый износ оборудования",
            (stop_ratio > 0.7 or gap_ratio > 0.2) if span else False,
            {
                "stopped_s": stopped_s,
                "stopped_fraction": stop_ratio,
                "gap_s": gap_s,
                "gap_fraction": gap_ratio,
                "stopped_threshold": 0.7,
                "gap_threshold": 0.2,
            },
            "Доля остановок превышает 70% или доля пропусков превышает 20%."
            if span and (stop_ratio > 0.7 or gap_ratio > 0.2)
            else "Пороговые доли остановок и пропусков не превышены.",
        ),
        _hypothesis(
            4,
            "Недостоверные данные",
            invalid_ratio > 0.2 if span else False,
            {
                "invalid_s": invalid_s,
                "invalid_fraction": invalid_ratio,
                "threshold": 0.2,
            },
            "Недостоверные измерения занимают более 20% записи."
            if span and invalid_ratio > 0.2
            else "Доля недостоверных измерений не превышает 20%.",
        ),
        _hypothesis(
            5,
            "Деградация производительности",
            degradation_detected,
            {
                "beginning_pressure_mpa": pressure_begin,
                "ending_pressure_mpa": pressure_end,
                "drop_percent": drop_percent,
                "shared_rpm_values": shared_rpms,
                "segment_fraction": HYPOTHESIS_5_SEGMENT_FRACTION,
                "significant_drop_threshold_percent": HYPOTHESIS_5_DROP_PERCENT,
            },
            "Среднее давление при одинаковых оборотах снизилось более чем на 10%."
            if degradation_detected
            else "Достаточно общих значений оборотов нет для сравнения."
            if degradation_detected is None
            else "Снижение среднего давления при одинаковых оборотах не превысило 10%.",
        ),
        _hypothesis(
            6,
            "Частые переключения режимов",
            transitions_per_hour > HYPOTHESIS_6_TRANSITIONS_PER_HOUR,
            {
                "transition_count": len(mode_transitions),
                "transitions": mode_transitions,
                "transitions_per_hour": transitions_per_hour,
                "threshold_per_hour": HYPOTHESIS_6_TRANSITIONS_PER_HOUR,
            },
            "Частота переключений режимов превышает 10 переходов в час."
            if transitions_per_hour > HYPOTHESIS_6_TRANSITIONS_PER_HOUR
            else "Частота переключений режимов не превышает 10 переходов в час.",
        ),
        _hypothesis(
            7,
            "Низкое давление при высоких оборотах",
            bool(low_pressure_events),
            {
                "interval_count": len(low_pressure_events),
                "duration_s": low_pressure_s,
                "working_fraction": low_pressure_s / working_s if working_s else 0.0,
                "events": [
                    {
                        "start_s": interval.start_s,
                        "end_s": interval.end_s,
                        "duration_s": interval.duration_s,
                        "pressure_mpa": interval.pressure_mpa,
                        "rpm": interval.rpm,
                    }
                    for interval in low_pressure_events
                ],
            },
            "Во время работы обнаружены обороты не ниже 100 об/мин при давлении ниже 5 МПа."
            if low_pressure_events
            else "Таких рабочих интервалов не обнаружено.",
        ),
        _hypothesis(
            8,
            "Длительный режим high",
            high_ratio > 0.5 if working_s else False,
            {
                "high_s": high_s,
                "working_s": working_s,
                "fraction": high_ratio,
                "threshold": 0.5,
            },
            "Режим high занимает более 50% подтверждённого времени работы."
            if working_s and high_ratio > 0.5
            else "Режим high занимает не более 50% подтверждённого времени работы.",
        ),
        _hypothesis(
            9,
            "Восстановление после пропусков",
            bool(post_gap_high),
            {
                "gap_count": len(gaps),
                "high_after_gap_count": len(post_gap_high),
                "fraction": len(post_gap_high) / len(gaps) if gaps else 0.0,
                "high_after_gap_times_s": [
                    intervals[index].start_s for index in post_gap_high
                ],
            },
            "Первый интервал после части пропусков классифицирован как high."
            if post_gap_high
            else "Сразу после пропуска режим high не обнаружен.",
        ),
        _hypothesis(
            10,
            "Периодичность недостоверных данных",
            periodic_pattern,
            {
                "pattern_detected": periodic_pattern,
                "period_s": best_period if periodic_pattern else None,
                "repetitions": len(best_cluster),
                "invalid_start_times_s": invalid_starts,
                "tolerance_fraction": 0.1,
                "minimum_repetitions": 3,
            },
            "Начала недостоверных интервалов повторяются с устойчивым периодом."
            if periodic_pattern
            else "Устойчивый период недостоверных данных не обнаружен.",
        ),
    ]


def analyze_json(payload: bytes | str) -> dict[str, Any]:
    """Return duration totals, classified intervals, and the ten heuristic checks."""
    dataset = parse_dataset(payload)
    intervals = _classify_intervals(dataset.samples)
    modes_s = {
        mode: sum(
            interval.duration_s
            for interval in intervals
            if interval.state == "working" and interval.mode == mode
        )
        for mode in ("low", "normal", "high")
    }
    working_s = sum(modes_s.values())
    stopped_s = sum(
        interval.duration_s for interval in intervals if interval.state == "stopped"
    )
    gap_s = sum(interval.duration_s for interval in intervals if interval.state == "gap")
    invalid_s = sum(
        interval.duration_s for interval in intervals if interval.state == "invalid"
    )
    span_s = (
        dataset.samples[-1].t_s - dataset.samples[0].t_s
        if len(dataset.samples) > 1
        else 0
    )
    totals: dict[str, Any] = {
        "status": "ok",
        "schema_version": dataset.schema_version,
        "dataset_id": dataset.dataset_id,
        "synthetic": dataset.synthetic,
        "sample_count": len(dataset.samples),
        "span_s": span_s,
        "working_s": working_s,
        "stopped_s": stopped_s,
        "gap_s": gap_s,
        "invalid_s": invalid_s,
        "unknown_s": gap_s + invalid_s,
        "modes_s": modes_s,
    }
    totals["samples"] = [
        {
            "t_s": sample.t_s,
            "pressure_mpa": sample.pressure_mpa,
            "rpm": sample.rpm,
            "valid": sample.valid,
        }
        for sample in dataset.samples
    ]
    totals["intervals"] = [
        {
            "start_s": interval.start_s,
            "end_s": interval.end_s,
            "duration_s": interval.duration_s,
            "state": interval.state,
            "mode": interval.mode,
        }
        for interval in intervals
    ]
    totals["hypotheses"] = _hypotheses(dataset.samples, intervals, totals)
    totals["diagnostic_note"] = (
        "Гипотезы являются учебными эвристиками, а не подтверждённым диагнозом. "
        "Для реального насоса нужны размеченные данные и проверка специалистом."
    )
    if dataset.synthetic:
        totals["data_note"] = "Набор помечен как синтетический; реальные неисправности не подтверждает."
    return totals
