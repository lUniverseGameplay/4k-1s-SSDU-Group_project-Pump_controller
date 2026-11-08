export type Sample = {
    t_s: number
    pressure_mpa: number | null
    rpm: number | null
    valid: boolean
}

export type Dataset = {
    schema_version: string
    dataset_id: string
    synthetic: boolean
    samples: Sample[]
}

export type Interval = {
    start: number
    end: number
    mode: "low" | "normal" | "high" | "stopped" | "gap" | "invalid"
    sample: Sample
}

export class FormatError extends Error {
    constructor(public category: string, message: string) {
        super(message)
        this.name = "FormatError"
    }
}

export function validate(raw: unknown): Dataset {
    return raw as Dataset
}

export function demoDataset(kind = "long"): Dataset {
    return {
        schema_version: "1.0",
        dataset_id: kind,
        synthetic: true,
        samples: [],
    }
}

export function analyze(_dataset: Dataset) {
    return {
        span: 0,
        working: 0,
        unknown: 0,
        totals: {
            low: 0,
            normal: 0,
            high: 0,
            stopped: 0,
            gap: 0,
            invalid: 0,
        },
        intervals: [] as Interval[],
        hypotheses: [] as Array<{
            title: string
            description: string
            active: boolean
            detail: string
        }>,
        result: {},
    }
}

export type BackendInterval = {
    start_s: number
    end_s: number
    duration_s: number
    state: "working" | "stopped" | "gap" | "invalid"
    mode: "low" | "normal" | "high" | null
}

export type BackendHypothesis = {
    id: number
    title: string
    status: "detected" | "not_detected" | "insufficient_data"
    detected: boolean | null
    message: string
    details: Record<string, unknown>
    result_file?: string
    result_file_url?: string
}

export type BackendAnalysis = {
    status: "ok"
    schema_version: string
    dataset_id: string
    synthetic: boolean
    sample_count: number

    span_s: number
    working_s: number
    stopped_s: number
    gap_s: number
    invalid_s: number
    unknown_s: number

    modes_s: {
        low: number
        normal: number
        high: number
    }

    samples: Sample[]
    intervals: BackendInterval[]
    hypotheses: BackendHypothesis[]

    diagnostic_note?: string
    data_note?: string

    result_id: string
    generated_at: string

    artifacts: {
        analysis: { file: string; url: string }
        graph: { file: string; url: string }
        hypotheses: Array<{
            id: number
            status: string
            file: string
            url: string
        }>
    }
}


// Тип гипотезы для отображения во Frontend
export type ViewHypothesis = {
    id: number
    title: string
    description: string
    active: boolean
    status: BackendHypothesis["status"]
    detail: string
}

export type ViewAnalysis = {
    span: number
    working: number
    unknown: number
    totals: {
        low: number
        normal: number
        high: number
        stopped: number
        gap: number
        invalid: number
    }
    intervals: Interval[]
    hypotheses: ViewHypothesis[]
    result: BackendAnalysis | null
}

export function emptyViewAnalysis(): ViewAnalysis {
    return {
        span: 0,
        working: 0,
        unknown: 0,
        totals: {
            low: 0,
            normal: 0,
            high: 0,
            stopped: 0,
            gap: 0,
            invalid: 0,
        },
        intervals: [],
        hypotheses: [],
        result: null,
    }
}

export function datasetFromResult(
    result: BackendAnalysis
): Dataset {
    return {
        schema_version: result.schema_version,
        dataset_id: result.dataset_id,
        synthetic: result.synthetic,
        samples: result.samples,
    }
}

export function toViewAnalysis(
    result: BackendAnalysis
): ViewAnalysis {

    const intervals: Interval[] = result.intervals.map(
        (interval, index) => ({
            start: interval.start_s,
            end: interval.end_s,

            mode: interval.mode ??
                (interval.state === "working"
                    ? "normal"
                    : interval.state),

            sample: result.samples[index] ?? {
                t_s: interval.start_s,
                pressure_mpa: null,
                rpm: null,
                valid: false,
            },
        })
    )

    const hypotheses: ViewHypothesis[] =
        result.hypotheses.map((item) => {

            const detailParts = Object.entries(
                item.details ?? {}
            ).map(([key, value]) => {

                const formatted =
                    Array.isArray(value)
                        ? `${value.length} элементов`
                        : value !== null && typeof value === "object"
                            ? "Подробности доступны в JSON"
                            : String(value)

                return `${key}: ${formatted}`
            })

            return {
                id: item.id,
                title: item.title,
                description: item.message,
                active: item.detected === true,
                status: item.status,
                detail: detailParts.length
                    ? `${item.message} Параметры: ${detailParts.join("; ")}.`
                    : item.message,
            }
        })

    return {
        span: result.span_s,
        working: result.working_s,
        unknown: result.unknown_s,

        totals: {
            low: result.modes_s.low,
            normal: result.modes_s.normal,
            high: result.modes_s.high,
            stopped: result.stopped_s,
            gap: result.gap_s,
            invalid: result.invalid_s,
        },

        intervals,
        hypotheses,
        result,
    }
}
