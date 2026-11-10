
import type { Dataset, Interval, Sample } from "./analyzer"

export const modeLabels = {
    low: "Низкий",
    normal: "Нормальный",
    high: "Высокий",
    stopped: "Остановка",
    gap: "Пропуск",
    invalid: "Недостоверно",
}

export function isReliable(sample: Sample): boolean {
    return (
        sample.valid === true &&
        typeof sample.pressure_mpa === "number" &&
        Number.isFinite(sample.pressure_mpa) &&
        typeof sample.rpm === "number" &&
        Number.isFinite(sample.rpm)
    )
}

export function clipIntervals(
    intervals: Interval[],
    start: number,
    end: number,
): Interval[] {
    if (end <= start) return []

    return intervals.flatMap((interval) => {
        const clippedStart = Math.max(interval.start, start)
        const clippedEnd = Math.min(interval.end, end)

        if (clippedEnd <= clippedStart) return []

        return [{
            ...interval,
            start: clippedStart,
            end: clippedEnd,
        }]
    })
}

export function problemEvents(intervals: Interval[]): Interval[] {
    const problems = intervals
        .filter(
            (interval) =>
                interval.mode === "gap" ||
                interval.mode === "invalid",
        )
        .slice()
        .sort((a, b) => a.start - b.start)

    const events: Interval[] = []

    for (const current of problems) {
        const last = events[events.length - 1]

        if (
            last &&
            last.mode === current.mode &&
            current.start <= last.end + 0.000001
        ) {
            events[events.length - 1] = {
                ...last,
                end: Math.max(last.end, current.end),
            }
        } else {
            events.push(current)
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
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU")

    return samples
        .map((sample, index) => {
            const interval = intervals.find(
                (item) =>
                    sample.t_s >= item.start &&
                    sample.t_s < item.end,
            )

            return {
                sample,
                index,
                mode: interval?.mode,
            }
        })
        .filter((row) => {
            if (mode !== "all" && row.mode !== mode) {
                return false
            }

            if (!normalizedQuery) return true

            const sample = row.sample

            const reliabilityText = isReliable(sample)
                ? "достоверно да true reliable"
                : "недостоверно нет false unreliable"

            const modeText = row.mode
                ? modeLabels[row.mode]
                : "конец записи"

            const searchable = [
                String(row.index + 1),
                String(sample.t_s),
                String(sample.pressure_mpa ?? "null"),
                String(sample.rpm ?? "null"),
                reliabilityText,
                modeText,
                row.mode ?? "",
            ].join(" ").toLocaleLowerCase("ru-RU")

            return searchable.includes(normalizedQuery)
        })
}
