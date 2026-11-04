import type { Dataset, Interval, Sample } from "./analyzer.ts"

export const modeLabels = {
    low: "Низкий",
    normal: "Нормальный",
    high: "Высокий",
    stopped: "Остановка",
    gap: "Пропуск",
    invalid: "Недостоверно",
}

export function isReliable(sample: Sample) {
    return (
        sample.valid === true &&
        sample.pressure_mpa !== null &&
        sample.pressure_mpa >= 0 &&
        sample.rpm !== null &&
        sample.rpm >= 0
    )
}

export function clipIntervals(
    intervals: Interval[],
    start: number,
    end: number,
) {
    return intervals
        .filter((interval) => interval.end > start && interval.start < end)
        .map((interval) => ({
            ...interval,
            start: Math.max(start, interval.start),
            end: Math.min(end, interval.end),
        }))
}

export function problemEvents(intervals: Interval[]) {
    const events: Interval[] = []
    for (const interval of intervals) {
        if (interval.mode !== "gap" && interval.mode !== "invalid") continue
        const previous = events[events.length - 1]
        if (previous?.mode === interval.mode && previous.end === interval.start) {
            previous.end = interval.end
        } else {
            events.push({ ...interval })
        }
    }
    return events
}

export function filterMeasurements(
    samples: Dataset["samples"],
    intervals: Interval[],
    query: string,
    mode: string,
) {
    const text = query.trim().toLocaleLowerCase("ru").replace(/,/g, ".")
    return samples
        .map((sample, index) => ({
            sample,
            index,
            mode: intervals[index]?.mode,
        }))
        .filter((row) => {
            if (mode !== "all" && row.mode !== mode) return false
            if (!text) return true
            const values = [
                row.sample.t_s,
                row.sample.pressure_mpa ?? "null",
                row.sample.rpm ?? "null",
                row.mode ? modeLabels[row.mode] : "Конец записи",
                row.mode ?? "",
            ]
            return values.some((value) =>
                String(value).toLocaleLowerCase("ru").includes(text),
            )
        })
}
