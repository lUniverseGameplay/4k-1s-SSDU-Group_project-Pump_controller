import type { BackendAnalysis } from "./analyzer"

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")

export class ApiError extends Error {
    constructor(
        message: string,
        public category = "server_error",
        public status?: number
    ) {
        super(message)
        this.name = "ApiError"
    }
}


function apiUrl(path: string): string {
    return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}

async function getError(response: Response): Promise<ApiError> {
    let body: unknown

    try {
        body = await response.json()
    } catch {
        return new ApiError(
            `Ошибка сервера: HTTP ${response.status}`,
            "server_error",
            response.status
        )
    }

    const detail = (body as { detail?: unknown })?.detail

    if (typeof detail === "object" && detail !== null) {
        const info = detail as Record<string, unknown>

        return new ApiError(
            typeof info.message === "string"
                ? info.message
                : "Сервер не смог обработать файл.",
            typeof info.category === "string"
                ? info.category
                : "server_error",
            response.status
        )
    }

    return new ApiError(
        typeof detail === "string"
            ? detail
            : "Ошибка сервера при обработке запроса.",
        "server_error",
        response.status
    )
}

async function readResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        throw await getError(response)
    }

    try {
        return await response.json() as T
    } catch {
        throw new ApiError(
            "Сервер вернул некорректный JSON.",
            "invalid_server_response",
            response.status
        )
    }
}

export async function analyzeFile(
    file: File
): Promise<BackendAnalysis> {

    const form = new FormData()
    form.append("file", file, file.name)

    let response: Response

    try {
        response = await fetch(apiUrl("/api/analyze"), {
            method: "POST",
            body: form
        })
    } catch {
        throw new ApiError(
            "Не удалось подключиться к backend. Проверьте, запущен ли FastAPI.",
            "backend_unavailable"
        )
    }

    return readResponse<BackendAnalysis>(response)
}

export function getApiUrl(path: string): string {
    return apiUrl(path)
}
