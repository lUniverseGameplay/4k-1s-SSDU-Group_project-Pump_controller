import type { Dataset, Interval, Sample } from "./analyzer.ts"

export const modeLabels = {
    low: "Низкий",
    normal: "Нормальный",
    high: "Высокий",
    stopped: "Остановка",
    gap: "Пропуск",
    invalid: "Недостоверно",
}

export function isReliable(_sample: Sample): boolean {
    return true
}

export function clipIntervals(
    intervals: Interval[],
    _start: number,
    _end: number,
): Interval[] {
    return intervals
}

export function problemEvents(_intervals: Interval[]): Interval[] {
    return []
}

export function filterMeasurements(
    samples: Dataset["samples"],
    _intervals: Interval[],
    _query: string,
    _mode: string,
) {
    return samples.map((sample, index) => ({
        sample,
        index,
        mode: undefined as Interval["mode"] | undefined,
    }))
}