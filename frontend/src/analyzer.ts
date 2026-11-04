export type Sample = {
    t_s: number
    pressure_mpa: number | null
    rpm: number | null
    valid: boolean | null
}
export type Dataset = {
    schema_version: string
    dataset_id: string
    synthetic: boolean
    samples: Sample[]
}
export type Mode = "low" | "normal" | "high" | "stopped" | "gap" | "invalid"
export type Interval = {
    start: number
    end: number
    mode: Mode
    sample: Sample
}
export class FormatError extends Error {
    category: string
    constructor(category: string, message: string) {
        super(message)
        this.category = category
    }
}
export function validate(input: unknown): Dataset {
    const fail = (category: string, message: string): never => {
        throw new FormatError(category, message)
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
        return fail("wrong_type", "Корень JSON должен быть объектом.")
    const d = input as Record<string, unknown>
    for (const key of ["schema_version", "dataset_id", "synthetic", "samples"])
        if (!(key in d))
            fail("missing_field", `Отсутствует обязательное поле «${key}».`)
    if (d.schema_version !== "1.0")
        fail("unsupported_version", "Поддерживается только schema_version «1.0».")
    if (
        typeof d.dataset_id !== "string" ||
        typeof d.synthetic !== "boolean" ||
        !Array.isArray(d.samples)
    )
        fail(
            "wrong_type",
            "Проверьте типы dataset_id (строка), synthetic (boolean) и samples (массив).",
        )
    const samples = (d.samples as unknown[]).map((item, i) => {
        if (!item || typeof item !== "object")
            return fail("wrong_type", `samples[${i}]: ожидается объект.`)
        const s = item as Record<string, unknown>
        for (const key of ["t_s", "pressure_mpa", "rpm", "valid"])
            if (!(key in s))
                fail("missing_field", `samples[${i}]: отсутствует поле «${key}».`)
        if (typeof s.t_s !== "number" || !Number.isFinite(s.t_s))
            fail("wrong_type", `samples[${i}].t_s: требуется конечное число.`)
        if (s.t_s as number < 0)
            fail(
                "non_increasing_time",
                `samples[${i}].t_s: время не может быть отрицательным.`,
            )
        for (const key of ["pressure_mpa", "rpm"])
            if (
                s[key] !== null &&
                (typeof s[key] !== "number" || !Number.isFinite(s[key]))
            )
                fail(
                    "wrong_type",
                    `samples[${i}].${key}: требуется конечное число или null.`,
                )
        // The consolidated specification permits boolean-like sensor flags.
        const valid = [true, 1, "true", "1"].includes(s.valid as never)
            ? true
            : [false, 0, "false", "0"].includes(s.valid as never)
                ? false
                : null
        return { ...s, valid } as Sample
    })
    samples.forEach((s, i) => {
        if (i && s.t_s <= samples[i - 1].t_s)
            fail(
                "non_increasing_time",
                `samples[${i}].t_s: время должно строго возрастать (предыдущее: ${samples[i - 1].t_s}).`,
            )
    })
    return { ...d, samples } as Dataset
}
export function analyze(d: Dataset) {
    const totals = { low: 0, normal: 0, high: 0, stopped: 0, gap: 0, invalid: 0 }
    const intervals: Interval[] = d.samples.slice(0, -1).map((s, i) => {
        const end = d.samples[i + 1].t_s,
            dt = end - s.t_s
        const mode: Mode =
            dt > 1.5
                ? "gap"
                : s.valid !== true ||
                    s.pressure_mpa === null ||
                    s.rpm === null ||
                    s.pressure_mpa < 0 ||
                    s.rpm < 0
                    ? "invalid"
                    : s.rpm < 50 || s.pressure_mpa < 1
                        ? "stopped"
                        : s.pressure_mpa < 5
                            ? "low"
                            : s.pressure_mpa < 10
                                ? "normal"
                                : "high"
        totals[mode] += dt
        return { start: s.t_s, end, mode, sample: s }
    })
    const working = totals.low + totals.normal + totals.high
    const span = working + totals.stopped + totals.gap + totals.invalid
    const ratio = (n: number, base = span) => (base ? n / base : 0)
    let lowRun = 0,
        maxLowRun = 0,
        switches = 0,
        stops = 0,
        recoveries = 0,
        correlation = 0
    const workModes = ["low", "normal", "high"]
    intervals.forEach((x, i) => {
        lowRun = x.mode === "low" ? lowRun + x.end - x.start : 0
        maxLowRun = Math.max(maxLowRun, lowRun)
        const prev = intervals[i - 1]
        if (
            prev &&
            workModes.includes(prev.mode) &&
            workModes.includes(x.mode) &&
            prev.mode !== x.mode
        )
            switches++
        if (prev && workModes.includes(prev.mode) && x.mode === "stopped") stops++
        if (prev?.mode === "gap" && x.mode === "high") recoveries++
        if (
            workModes.includes(x.mode) &&
            x.sample.rpm! >= 100 &&
            x.sample.pressure_mpa! < 5
        )
            correlation += x.end - x.start
    })
    const midpoint = (d.samples[0]?.t_s ?? 0) + span / 2
    const groups = new Map<number, [number[], number[]]>()
    intervals
        .filter((x) => workModes.includes(x.mode))
        .forEach((x) => {
            const group = groups.get(x.sample.rpm!) ?? [[], []]
            group[x.start < midpoint ? 0 : 1].push(x.sample.pressure_mpa!)
            groups.set(x.sample.rpm!, group)
        })
    const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length
    let decline = 0
    groups.forEach(([a, b]) => {
        if (a.length && b.length)
            decline = Math.max(decline, (mean(a) - mean(b)) / mean(a))
    })
    const invalidStarts = intervals
        .filter(
            (x, i) => x.mode === "invalid" && intervals[i - 1]?.mode !== "invalid",
        )
        .map((x) => x.start)
    const diffs = invalidStarts.slice(1).map((v, i) => v - invalidStarts[i])
    const period = diffs.find(
        (n) => diffs.filter((v) => Math.abs(v - n) < n * 0.1).length >= 3,
    )
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`
    const hypotheses = [
        {
            title: "Промывка системы",
            description: "Низкое давление при работающем насосе более 5 минут.",
            active: maxLowRun >= 300,
            detail: `Непрерывный режим low: ${maxLowRun} с. Порог: 300 с.`,
        },
        {
            title: "Аномальные остановки",
            description: "Насос остановлен больше половины времени записи.",
            active: ratio(totals.stopped) > 0.5,
            detail: `Доля остановок: ${pct(ratio(totals.stopped))}. Переходов работа → остановка: ${stops}.`,
        },
        {
            title: "Возможный износ оборудования",
            description: "Высокая доля остановок или потерянных данных.",
            active: ratio(totals.stopped) > 0.7 || ratio(totals.gap) > 0.2,
            detail: `Остановки: ${pct(ratio(totals.stopped))} (порог 70%). Пропуски: ${pct(ratio(totals.gap))} (порог 20%).`,
        },
        {
            title: "Недостоверные данные",
            description: "Более 20% записи содержат некорректные измерения.",
            active: ratio(totals.invalid) > 0.2,
            detail: `Недостоверно: ${totals.invalid} с, ${pct(ratio(totals.invalid))} записи.`,
        },
        {
            title: "Деградация производительности",
            description: "Снижение давления при одинаковых оборотах.",
            active: decline > 0.1,
            detail: `Максимальное снижение среднего давления: ${pct(decline)}. Принятый значимый порог: 10%.`,
        },
        {
            title: "Частые переключения режимов",
            description: "Более 10 переходов между режимами в час.",
            active: ratio(switches) * 3600 > 10,
            detail: `${switches} переходов; ${(ratio(switches) * 3600).toFixed(1)} в час. Порог: 10.`,
        },
        {
            title: "Корреляция давления и оборотов",
            description: "Низкое давление при высоких оборотах насоса.",
            active: correlation > 0,
            detail: `Давление < 5 МПа при ≥ 100 об/мин: ${correlation} с (${pct(ratio(correlation, working))} наработки).`,
        },
        {
            title: "Длительный режим high",
            description: "Высокое давление более 50% времени работы.",
            active: ratio(totals.high, working) > 0.5,
            detail: `Режим high: ${totals.high} с, ${pct(ratio(totals.high, working))} наработки.`,
        },
        {
            title: "Восстановление после пропусков",
            description: "Переход в высокий режим сразу после потери данных.",
            active: recoveries > 0,
            detail: `Случаев восстановления в high: ${recoveries}.`,
        },
        {
            title: "Периодичность недостоверных данных",
            description: "Повторяющийся паттерн ошибок измерений.",
            active: period !== undefined,
            detail: period
                ? `Период около ${period} с, не менее 3 повторений с отклонением < 10%.`
                : "Устойчивый периодический паттерн не найден.",
        },
    ]
    return {
        totals,
        span,
        working,
        unknown: totals.gap + totals.invalid,
        intervals,
        hypotheses,
        result: {
            status: "ok",
            sample_count: d.samples.length,
            span_s: span,
            working_s: working,
            stopped_s: totals.stopped,
            gap_s: totals.gap,
            invalid_s: totals.invalid,
            unknown_s: totals.gap + totals.invalid,
            modes_s: { low: totals.low, normal: totals.normal, high: totals.high },
        },
    }
}
export function demoDataset(kind = "long"): Dataset {
    const samples: Sample[] = []
    const length = kind === "small" ? 12 : kind === "empty" ? 0 : 1800
    if (kind !== "empty")
        for (let t = 0; t <= length; t++) {
            if (kind === "long" && t > 900 && t < 960) continue
            let pressure =
                kind === "small"
                    ? t < 3
                        ? 0
                        : t < 6
                            ? 3
                            : t < 9
                                ? 7
                                : 11
                    : t < 180
                        ? 0
                        : t < 500
                            ? 3.4
                            : t < 700
                                ? 7.5
                                : t < 900
                                    ? 11.2
                                    : t < 1150
                                        ? 11.5
                                        : t < 1260
                                            ? 7.3
                                            : t < 1380
                                                ? 3
                                                : 0
            if (pressure && kind !== "small")
                pressure += Math.sin(t * 0.12) * 0.21 + Math.sin(t * 0.53) * 0.11
            samples.push({
                t_s: t,
                pressure_mpa: pressure,
                rpm: pressure > 0 ? 118 + Math.sin(t * 0.07) * 3 : 0,
                valid: !(kind === "long" && t >= 600 && t < 610),
            })
        }
    return {
        schema_version: "1.0",
        dataset_id:
            kind === "small"
                ? "01_small"
                : kind === "empty"
                    ? "06_empty"
                    : "05_long_record",
        synthetic: true,
        samples,
    }
}
