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

// Заглушка валидации
export function validate(raw: unknown): Dataset {
    return raw as Dataset
}

// Заглушка демо-данных (возвращает пустой или минимальный сет для инициализации)
export function demoDataset(kind = "long"): Dataset {
    return {
        schema_version: "1.0",
        dataset_id: kind,
        synthetic: true,
        samples: [],
    }
}

// Заглушка анализа
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