import { useEffect, useMemo, useRef, useState } from "react"
import { analyzeFile, ApiError, getApiUrl } from "./api"
import { datasetFromResult, emptyViewAnalysis, toViewAnalysis } from "./analyzer"
import type { BackendAnalysis, Dataset, Interval } from "./analyzer"
import {
    clipIntervals,
    filterMeasurements,
    isReliable,
    modeLabels,
    problemEvents,
} from "./analysis-view"

const icons: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    chart: "M3 3v18h18 M6 15l4-5 4 3 6-8",
    bulb: "M9 18h6 M9 21h6 M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2",
    file: "M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h6",
    upload: "M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6",
    download: "M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4",
    chevron: "M9 5l7 7-7 7",
    down: "M6 9l6 6 6-6",
    check: "M5 12l4 4L19 6",
    clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    play: "M8 4l12 8-12 8z",
    pause: "M8 5v14 M16 5v14",
    alert: "M12 8v5 M12 16v.1 M10 3L2 18q-1 3 2 3h16q3 0 2-3L14 3q-2-3-4 0",
    info: "M12 11v6 M12 7v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    help: "M9 9a3 3 0 1 1 4 3c-1 0-1 2-1 2 M12 17v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    settings:
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
    close: "M6 6l12 12 M6 18L18 6",
    activity: "M2 12h5l3-8 4 16 3-8h5",
    arrow: "M5 12h14 M14 7l5 5-5 5",
    search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
}
type IconProps = {
    name: string
    size?: number
}
function Icon({ name, size = 20 }: IconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={icons[name] || icons.chart} />
        </svg>
    )
}
const fmt = (n: number) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n)
const duration = (n: number) =>
    `${Math.floor(n / 60)
        .toString()
        .padStart(2, "0")}:${Math.floor(n % 60)
            .toString()
            .padStart(2, "0")}`
const percent = (n: number, base: number) =>
    base ? `${fmt((n / base) * 100)}%` : "0%"
const modeColors = {
    low: "#b7d5bf",
    normal: "#348b66",
    high: "#203f35",
    stopped: "#bfc9c4",
    gap: "#dce1de",
    invalid: "#eeac84",
}

function Chart({
    intervals,
    samples,
    span,
    first,
    large = false,
}: {
    intervals: Interval[]
    samples: Dataset["samples"]
    span: number
    first: number
    large?: boolean
}) {
    const [pressure, setPressure] = useState(true)
    const [rpm, setRpm] = useState(true)
    const [hover, setHover] = useState<number | null>(null)
    const w = 900,
        top = 25,
        h = 210,
        left = 44,
        right = 850
    const maxP = samples.reduce(
        (max, s) => Math.max(max, isReliable(s) ? s.pressure_mpa! : 0),
        15,
    )
    const maxR = samples.reduce(
        (max, s) => Math.max(max, isReliable(s) ? s.rpm! : 0),
        150,
    )
    const x = (n: number) =>
        left + (span ? (n - first) / span : 0) * (right - left)
    function paths(key: "pressure_mpa" | "rpm", max: number) {
        let d = "",
            connected = false
        for (const it of intervals) {
            if (it.mode === "gap" || it.mode === "invalid") {
                connected = false
                continue
            }
            const y = top + h - (it.sample[key]! / max) * h
            d += `${connected ? "L" : "M"
                }${x(it.start).toFixed(2)},${y.toFixed(2)} H${x(it.end).toFixed(2)} `
            connected = true
        }
        return d
    }
    const pressurePath = useMemo(
        () => paths("pressure_mpa", maxP),
        [intervals, maxP, first, span],
    )
    const rpmPath = useMemo(
        () => paths("rpm", maxR),
        [intervals, maxR, first, span],
    )
    const selected =
        hover !== null
            ? intervals.find(
                (interval) => interval.start <= hover && interval.end > hover,
            )
            : undefined
    return (
        <div className={`chart-wrap ${large ? "large" : ""}`}>
            <div className="chart-meta">
                <div className="chart-toggles">
                    <button
                        aria-pressed={pressure}
                        className={!pressure ? "muted-toggle" : ""}
                        onClick={() => setPressure(!pressure)}
                    >
                        <i className="line-key green" />
                        Давление, МПа
                    </button>
                    <button
                        aria-pressed={rpm}
                        className={!rpm ? "muted-toggle" : ""}
                        onClick={() => setRpm(!rpm)}
                    >
                        <i className="line-key purple" />
                        Обороты, об/мин
                    </button>
                </div>
                <span className="chart-step">Без интерполяции</span>
            </div>
            <div className="plot" onMouseLeave={() => setHover(null)}>
                <svg
                    viewBox={`0 0 ${w} 280`}
                    role="img"
                    aria-label="График давления и оборотов насоса"
                    onMouseMove={(e) => {
                        const box = e.currentTarget.getBoundingClientRect()
                        setHover(
                            first +
                            Math.max(
                                0,
                                Math.min(
                                    1,
                                    (((e.clientX - box.left) / box.width) * w - left) /
                                    (right - left),
                                ),
                            ) *
                            span,
                        )
                    }}
                >
                    <defs>
                        <pattern
                            id="gap-pattern"
                            width="6"
                            height="6"
                            patternUnits="userSpaceOnUse"
                            patternTransform="rotate(45)"
                        >
                            <line
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="6"
                                stroke="#d8dedb"
                                strokeWidth="2"
                            />
                        </pattern>
                    </defs>
                    {[0, 1, 2, 3].map((i) => (
                        <g key={i}>
                            <line
                                x1={left}
                                x2={right}
                                y1={top + (i * h) / 3}
                                y2={top + (i * h) / 3}
                                stroke="#e9eeeb"
                                strokeDasharray="4 4"
                            />
                            <text x={left - 13} y={top + (i * h) / 3 + 4} textAnchor="end">
                                {fmt((maxP * (3 - i)) / 3)}
                            </text>
                            <text x={right + 14} y={top + (i * h) / 3 + 4}>
                                {fmt((maxR * (3 - i)) / 3)}
                            </text>
                        </g>
                    ))}
                    {intervals
                        .filter((i) => i.mode === "gap" || i.mode === "invalid")
                        .map((i) => (
                            <rect
                                key={i.start}
                                x={x(i.start)}
                                y={top}
                                width={Math.max(1, x(i.end) - x(i.start))}
                                height={h}
                                fill={i.mode === "gap" ? "url(#gap-pattern)" : "#f9dfce"}
                            />
                        ))}
                    {rpm && (
                        <path
                            d={rpmPath}
                            fill="none"
                            stroke="#9b8bc7"
                            strokeWidth="2"
                            opacity=".85"
                            vectorEffect="non-scaling-stroke"
                        />
                    )}
                    {pressure && (
                        <path
                            d={pressurePath}
                            fill="none"
                            stroke="#278764"
                            strokeWidth="2.1"
                            vectorEffect="non-scaling-stroke"
                        />
                    )}
                    {samples.length === 1 && pressure && isReliable(samples[0]) && (
                        <circle
                            cx={left}
                            cy={top + h - ((samples[0].pressure_mpa ?? 0) / maxP) * h}
                            r="4"
                            fill="#278764"
                        />
                    )}
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                        <text
                            key={i}
                            x={left + ((right - left) * i) / 6}
                            y={258}
                            textAnchor="middle"
                        >
                            {duration(first + (span * i) / 6)}
                        </text>
                    ))}
                    {hover !== null && (
                        <line
                            x1={x(hover)}
                            x2={x(hover)}
                            y1={top}
                            y2={top + h}
                            stroke="#6e8076"
                            strokeDasharray="3 3"
                        />
                    )}
                </svg>
                {!samples.length && (
                    <div className="empty-chart">В файле нет измерений</div>
                )}
                {selected && (
                    <div className="chart-tooltip">
                        <b>
                            {duration(hover!)} · {modeLabels[selected.mode]}
                        </b>
                        {selected.mode === "gap" ? (
                            <span>На этом интервале измерений нет</span>
                        ) : (
                            <>
                                <span>
                                    Давление:{" "}
                                    {selected.sample.pressure_mpa === null
                                        ? "нет данных"
                                        : `${fmt(selected.sample.pressure_mpa)} МПа`}
                                </span>
                                <span>
                                    Обороты:{" "}
                                    {selected.sample.rpm === null
                                        ? "нет данных"
                                        : `${fmt(selected.sample.rpm)} об/мин`}
                                </span>
                                <span>
                                    {isReliable(selected.sample)
                                        ? "Достоверное измерение"
                                        : "Недостоверное измерение"}
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>
            <div className="chart-bottom">
                <span>Время от начала записи, мин:с</span>
                <div>
                    <span>
                        <i className="zone-key gap" />
                        Пропуски
                    </span>
                    <span>
                        <i className="zone-key invalid" />
                        Недостоверные данные
                    </span>
                </div>
            </div>
        </div>
    )
}

export default function App() {
    const [dataset, setDataset] = useState<Dataset>({
        schema_version: "1.0",
        dataset_id: "",
        synthetic: false,
        samples: [],
    })
    const [backendResult, setBackendResult] = useState<BackendAnalysis | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [fileName, setFileName] = useState("Файл не загружен")
    const [view, setView] = useState("overview")
    const [modal, setModal] = useState<"upload" | "help" | "settings" | null>(
        null,
    )
    const [error, setError] = useState<{
        message: string
        category: string
    } | null>(null)
    const [filter, setFilter] = useState("all")
    const [expanded, setExpanded] = useState<number | null>(null)
    const [toast, setToast] = useState("")
    const [dragging, setDragging] = useState(false)
    const [page, setPage] = useState(0)
    const [query, setQuery] = useState("")
    const [dataMode, setDataMode] = useState("all")
    const [pageSize, setPageSize] = useState(20)
    const [range, setRange] = useState<[number, number]>([0, 100])
    const [source, setSource] = useState("long")
    const inputRef = useRef<HTMLInputElement>(null)
    const initialDemoRequested = useRef(false)
    useEffect(() => {
        if (!modal) return
        const previousFocus = document.activeElement as HTMLElement | null
        const overflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setModal(null)
            if (event.key !== "Tab") return
            const controls = Array.from(
                document.querySelectorAll<HTMLElement>(
                    ".modal button:not([disabled]), .modal select, .modal input:not([hidden]), .modal a[href]",
                ),
            )
            const first = controls[0],
                last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first?.focus()
            }
        }
        document.addEventListener("keydown", handleKey)
        return () => {
            document.body.style.overflow = overflow
            document.removeEventListener("keydown", handleKey)
            previousFocus?.focus()
        }
    }, [modal])
    const a = useMemo(
        () => backendResult ? toViewAnalysis(backendResult) : emptyViewAnalysis(),
        [backendResult],
    )
    const active = a.hypotheses.filter((h) => h.active).length
    const events = useMemo(() => problemEvents(a.intervals), [a.intervals])
    const firstTime = dataset.samples[0]?.t_s ?? 0
    const rangeStart = firstTime + (a.span * range[0]) / 100
    const rangeEnd = firstTime + (a.span * range[1]) / 100
    const visibleIntervals = useMemo(
        () => clipIntervals(a.intervals, rangeStart, rangeEnd),
        [a.intervals, rangeStart, rangeEnd],
    )
    const rows = useMemo(
        () => filterMeasurements(dataset.samples, a.intervals, query, dataMode),
        [dataset.samples, a.intervals, query, dataMode],
    )
    const quality = a.span ? ((a.span - a.unknown) / a.span) * 100 : 0
    function resetView() {
        setPage(0)
        setQuery("")
        setDataMode("all")
        setRange([0, 100])
        setExpanded(null)
        setFilter("all")
    }
    function inspectEvent(event: Interval) {
        if (a.span)
            setRange([
                Math.max(0, ((event.start - firstTime - 15) / a.span) * 100),
                Math.min(100, ((event.end - firstTime + 15) / a.span) * 100),
            ])
        setView("charts")
        window.scrollTo({ top: 0, behavior: "smooth" })
    }
    const nav = [
        { id: "overview", label: "Обзор анализа", icon: "grid" },
        { id: "charts", label: "Графики", icon: "chart" },
        { id: "hypotheses", label: "Гипотезы", icon: "bulb" },
        { id: "data", label: "Исходные данные", icon: "file" },
    ]
    function notify(message: string) {
        setToast(message)
        window.setTimeout(() => setToast(""), 3500)
    }
    function reportApiError(cause: unknown, fallback: string) {
        if (cause instanceof ApiError) {
            setError({ message: cause.message, category: cause.status ? `${cause.category} · HTTP ${cause.status}` : cause.category })
            return cause.message
        }
        const message = cause instanceof Error ? cause.message : fallback
        setError({ message, category: "client_error" })
        return message
    }

    async function loadFile(file?: File) {
        if (!file) return
        setIsLoading(true)
        setError(null)
        try {
            const result = await analyzeFile(file)
            setBackendResult(result)
            setDataset(datasetFromResult(result))
            setSource("custom")
            setFileName(file.name)
            resetView()
            setModal(null)
            notify("Файл проверен и проанализирован backend-сервером")
        } catch (cause) {
            reportApiError(cause, "Не удалось отправить файл на анализ.")
        } finally { setIsLoading(false) }
    }
    function exportResult() {
        if (!backendResult) {
            notify("Сначала дождитесь успешного анализа файла")
            return
        }
        const blob = new Blob([JSON.stringify(backendResult, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob),
            link = document.createElement("a")
        link.href = url
        link.download = `${dataset.dataset_id}_analysis.json`
        link.click()
        URL.revokeObjectURL(url)
        notify("Результаты экспортированы в JSON")
    }
    const visibleHypotheses = a.hypotheses
        .map((h, i) => ({ ...h, i }))
        .filter(
            (h) => filter === "all" || (filter === "active" ? h.active : !h.active),
        )
    return (
        <div className="app-shell">
            <aside className="sidebar">
                <a
                    className="brand"
                    href="#"
                    onClick={(e) => {
                        e.preventDefault()
                        setView("overview")
                    }}
                >
                    <span className="brand-symbol">
                        <Icon name="activity" size={25} />
                    </span>
                    <span>
                        Pump<span className="brand-light">Insight</span>
                        <small>АНАЛИТИКА ОБОРУДОВАНИЯ</small>
                    </span>
                </a>
                <div className="nav-label"> </div>
                <nav>
                    {nav.map((n) => (
                        <button
                            key={n.id}
                            title={n.label}
                            aria-label={n.label}
                            aria-current={view === n.id ? "page" : undefined}
                            className={view === n.id ? "nav-item active" : "nav-item"}
                            onClick={() => {
                                setView(n.id)
                                setExpanded(null)
                            }}
                        >
                            <Icon name={n.icon} />
                            <span>{n.label}</span>
                            {n.id === "hypotheses" && (
                                <span className="nav-count">{active}</span>
                            )}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-bottom">
                    <div className="local-card">
                        <span className="local-icon">
                            <Icon name="check" size={16} />
                        </span>
                        <b>Локальный backend</b>
                        <p>Файлы отправляются в FastAPI для проверки и анализа.</p>
                        <span>
                            Данные обрабатываются вашим сервером <Icon name="info" size={13} />
                        </span>
                    </div>
                    <button
                        className="nav-item"
                        aria-label="Параметры анализа"
                        title="Параметры анализа"
                        onClick={() => setModal("settings")}
                    >
                        <Icon name="settings" />
                        <span>Параметры анализа</span>
                    </button>
                    <button
                        className="nav-item"
                        aria-label="Справка и документация"
                        title="Справка и документация"
                        onClick={() => setModal("help")}
                    >
                        <Icon name="help" />
                        <span>Справка и документация</span>
                    </button>
                </div>
            </aside>
            <div className="main-shell">
                <header className="topbar">
                    <div className="breadcrumbs">
                        <span>Рабочее пространство</span>
                        <Icon name="chevron" size={13} />
                        <b>{nav.find((n) => n.id === view)?.label}</b>
                    </div>
                    <div className="topbar-right">
                        <span className="local-status">
                            <i />
                            {backendResult ? "API подключён" : isLoading ? "Выполняется анализ" : "Ожидание API"}
                        </span>
                        <span className="topbar-divider" />
                        <button
                            className="icon-button"
                            aria-label="Справка"
                            onClick={() => setModal("help")}
                        >
                            <Icon name="help" size={19} />
                        </button>
                        <span className="user-avatar">СТ</span>
                    </div>
                </header>
                <main>
                    {error && !modal && (
                        <div className="notice warning" role="alert">
                            <Icon name="alert" size={16} />
                            <span>{error.message} Откройте «Загрузить JSON», чтобы повторить запрос.</span>
                        </div>
                    )}
                    <section className="page-heading">
                        <div>
                            <div className="eyebrow">АНАЛИТИКА НАСОСНОГО ОБОРУДОВАНИЯ</div>
                            <h1>
                                {view === "overview"
                                    ? "Обзор анализа"
                                    : view === "charts"
                                        ? "Графики измерений"
                                        : view === "hypotheses"
                                            ? "Диагностические гипотезы"
                                            : "Исходные данные"}
                            </h1>
                            <p>
                                {view === "overview"
                                    ? "От данных к пониманию работы вашего оборудования."
                                    : view === "charts"
                                        ? "Давление и обороты на общей временной шкале."
                                        : view === "hypotheses"
                                            ? "Проверка состояния оборудования по 10 диагностическим правилам."
                                            : "Измерения из загруженного файла без интерполяции и экстраполяции."}
                            </p>
                        </div>
                        <div className="heading-actions">
                            <button className="button secondary" onClick={exportResult}>
                                <Icon name="download" size={17} />
                                Экспорт отчёта
                            </button>
                            <button
                                className="button primary"
                                onClick={() => {
                                    setModal("upload")
                                    setError(null)
                                }}
                            >
                                <Icon name="upload" size={17} />
                                Загрузить JSON
                            </button>
                        </div>
                    </section>
                    <section className="dataset-bar">
                        <div className="file-icon">
                            <Icon name="file" size={24} />
                        </div>
                        <div className="dataset-title">
                            <div>
                                <b>{fileName}</b>
                                <span className="badge success">
                                    <Icon name="check" size={12} />
                                    Анализ завершён
                                </span>
                            </div>
                            <span>
                                {fmt(dataset.samples.length)} записей <i>•</i> Схема{" "}
                                {dataset.schema_version} <i>•</i> Длительность{" "}
                                {duration(a.span)}
                                {backendResult && <><i>•</i> ID: {backendResult.result_id}</>}
                            </span>
                        </div>
                        <div className="dataset-right">
                            {dataset.synthetic && (
                                <span className="badge synthetic">
                                    <span />
                                    Учебные данные
                                </span>
                            )}
                            {backendResult && <a className="text-button" href={getApiUrl(backendResult.artifacts.graph.url)} target="_blank" rel="noreferrer">PNG график</a>}
                        </div>
                    </section>
                    {dataset.synthetic && (
                        <div className="notice">
                            <Icon name="info" size={16} />
                            <span>
                                Синтетический набор данных. Результаты предназначены для
                                обучения, а не для диагностики реального оборудования.
                            </span>
                        </div>
                    )}
                    {dataset.samples.length < 2 && (
                        <div className="notice warning">
                            <Icon name="alert" size={16} />
                            {dataset.samples.length === 0
                                ? "Массив samples пуст. Все длительности равны нулю."
                                : "Одна запись не образует интервал. Все длительности равны нулю."}
                        </div>
                    )}
                    {(view === "overview" || view === "hypotheses") && (
                        <section
                            className="analysis-summary"
                            aria-label="Краткий итог анализа"
                        >
                            <div className={`summary-symbol ${active ? "attention" : ""}`}>
                                <Icon name={active ? "bulb" : "check"} size={24} />
                            </div>
                            <div className="summary-copy">
                                <span className="summary-eyebrow">КРАТКИЙ ИТОГ</span>
                                <h2>
                                    {a.span === 0
                                        ? "Недостаточно данных для оценки"
                                        : active
                                            ? "Есть особенности, которые стоит изучить"
                                            : "Пороговые условия гипотез не выявлены"}
                                </h2>
                                <p>
                                    {a.span === 0
                                        ? "Загрузите запись хотя бы с двумя измерениями."
                                        : `Актуальных гипотез: ${active} из 10. ${a.unknown
                                            ? `Неизвестное состояние — ${fmt(a.unknown)} с записи.`
                                            : "Пропусков и недостоверных интервалов нет."
                                        }`}
                                </p>
                            </div>
                            <div className="quality-score">
                                <div>
                                    <span>Покрытие достоверными данными</span>
                                    <b>{a.span ? `${fmt(quality)}%` : "—"}</b>
                                </div>
                                <div className="quality-track">
                                    <span style={{ width: `${quality}%` }} />
                                </div>
                                <small>Работа + остановки / вся запись</small>
                            </div>
                            <button
                                className="summary-link"
                                onClick={() => {
                                    setView("hypotheses")
                                    setFilter(active ? "active" : "all")
                                }}
                                aria-label="Перейти к диагностическим гипотезам"
                            >
                                <Icon name="arrow" size={20} />
                            </button>
                        </section>
                    )}
                    {(view === "overview" || view === "charts") && (
                        <>
                            <section className="metrics-grid">
                                {[
                                    {
                                        label: "Общее время записи",
                                        value: a.span,
                                        icon: "clock",
                                        color: "neutral",
                                        caption: "Полный интервал наблюдения",
                                    },
                                    {
                                        label: "Подтверждённая наработка",
                                        value: a.working,
                                        icon: "play",
                                        color: "green",
                                        caption: `${percent(a.working, a.span)} от времени записи`,
                                    },
                                    {
                                        label: "Время остановок",
                                        value: a.totals.stopped,
                                        icon: "pause",
                                        color: "gray",
                                        caption: `${percent(a.totals.stopped, a.span)} от времени записи`,
                                    },
                                    {
                                        label: "Неизвестное состояние",
                                        value: a.unknown,
                                        icon: "alert",
                                        color: "orange",
                                        caption: `Пропуски ${fmt(a.totals.gap)} с · Недостоверно ${fmt(a.totals.invalid)} с`,
                                    },
                                ].map((m) => (
                                    <article className={`metric-card ${m.color}`} key={m.label}>
                                        <div className="metric-top">
                                            <span>{m.label}</span>
                                            <span className="metric-icon">
                                                <Icon name={m.icon} size={17} />
                                            </span>
                                        </div>
                                        <div className="metric-value">
                                            {fmt(m.value)}
                                            <span>сек</span>
                                        </div>
                                        <div className="metric-caption">
                                            {m.color === "green" && <i />}
                                            {m.caption}
                                        </div>
                                        <div className="metric-track">
                                            <div
                                                style={{
                                                    width: `${a.span ? (m.value / a.span) * 100 : 0}%`,
                                                }}
                                            />
                                        </div>
                                    </article>
                                ))}
                            </section>
                            <section
                                className={`visual-grid ${view === "charts" ? "charts-only" : ""
                                    }`}
                            >
                                <article className="panel chart-panel">
                                    <div className="panel-heading">
                                        <div>
                                            <h2>Параметры работы</h2>
                                            <p>Динамика давления и оборотов насоса</p>
                                        </div>
                                        <span className="subtle-tag">
                                            {range[0] === 0 && range[1] === 100
                                                ? "Вся запись"
                                                : "Выбранный интервал"}{" "}
                                            <Icon name="clock" size={13} />
                                        </span>
                                    </div>
                                    <Chart
                                        intervals={visibleIntervals}
                                        samples={dataset.samples}
                                        span={rangeEnd - rangeStart}
                                        first={rangeStart}
                                        large={view === "charts"}
                                    />
                                    <div className="timeline">
                                        <span>Режим работы</span>
                                        <div className="timeline-track">
                                            {visibleIntervals.map((i) => (
                                                <div
                                                    key={i.start}
                                                    style={{
                                                        width: `${((i.end - i.start) / (rangeEnd - rangeStart)) * 100}%`,
                                                        background: modeColors[i.mode],
                                                    }}
                                                    title={`${duration(i.start)}–${duration(i.end)}: ${modeLabels[i.mode]}`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <div className="range-controls">
                                        <div className="range-caption">
                                            <span>
                                                <Icon name="search" size={14} /> Масштаб графика
                                            </span>
                                            <b>
                                                {duration(rangeStart)} — {duration(rangeEnd)}
                                            </b>
                                            <button
                                                disabled={range[0] === 0 && range[1] === 100}
                                                onClick={() => setRange([0, 100])}
                                            >
                                                Сбросить
                                            </button>
                                        </div>
                                        <div className="range-sliders">
                                            <label>
                                                От
                                                <input
                                                    aria-label="Начало интервала графика"
                                                    type="range"
                                                    min="0"
                                                    max="99.9"
                                                    step="0.1"
                                                    disabled={!a.span}
                                                    value={range[0]}
                                                    onChange={(e) => {
                                                        const start = Number(e.target.value)
                                                        setRange([start, Math.max(range[1], start + 0.1)])
                                                    }}
                                                />
                                            </label>
                                            <label>
                                                До
                                                <input
                                                    aria-label="Конец интервала графика"
                                                    type="range"
                                                    min="0.1"
                                                    max="100"
                                                    step="0.1"
                                                    disabled={!a.span}
                                                    value={range[1]}
                                                    onChange={(e) => {
                                                        const end = Number(e.target.value)
                                                        setRange([Math.min(range[0], end - 0.1), end])
                                                    }}
                                                />
                                            </label>
                                        </div>
                                        <div className="range-note">
                                            Масштаб меняет только график. Метрики и гипотезы
                                            рассчитаны по всей записи.
                                        </div>
                                    </div>
                                </article>
                                {view === "overview" && (
                                    <article className="panel modes-panel">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>Режимы работы</h2>
                                                <p>Распределение наработки</p>
                                            </div>
                                            <Icon name="chart" size={18} />
                                        </div>
                                        <div
                                            className="donut"
                                            style={{
                                                background: a.working
                                                    ? `conic-gradient(#203f35 0 ${(a.totals.high / a.working) * 100}%, #348b66 ${(a.totals.high / a.working) * 100}% ${((a.totals.high + a.totals.normal) / a.working) * 100}%, #b7d5bf 0 100%)`
                                                    : "#e9eeeb",
                                            }}
                                        >
                                            <div>
                                                <small>Наработка</small>
                                                <b>
                                                    {fmt(a.working)}
                                                    <span>с</span>
                                                </b>
                                                <small>из {fmt(a.span)} секунд</small>
                                            </div>
                                        </div>
                                        <div className="mode-legend">
                                            {[
                                                {
                                                    key: "low" as const,
                                                    label: "Низкий",
                                                    range: "1–5 МПа",
                                                },
                                                {
                                                    key: "normal" as const,
                                                    label: "Нормальный",
                                                    range: "5–10 МПа",
                                                },
                                                {
                                                    key: "high" as const,
                                                    label: "Высокий",
                                                    range: "≥ 10 МПа",
                                                },
                                            ].map((m) => (
                                                <div key={m.key}>
                                                    <i style={{ background: modeColors[m.key] }} />
                                                    <span>
                                                        {m.label}
                                                        <small>{m.range}</small>
                                                    </span>
                                                    <b>
                                                        {fmt(a.totals[m.key])} <small>с</small>
                                                    </b>
                                                    <span className="mode-percent">
                                                        {percent(a.totals[m.key], a.working)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </article>
                                )}
                            </section>
                        </>
                    )}
                    {(view === "overview" || view === "charts") && (
                        <section className="panel events-panel">
                            <div className="panel-heading">
                                <div>
                                    <div className="title-with-badge">
                                        <h2>События качества данных</h2>
                                        <span className="count-badge">{events.length}</span>
                                    </div>
                                    <p>Перейдите к проблемному участку одним нажатием</p>
                                </div>
                                <span className="event-duration">
                                    {fmt(a.unknown)} с неизвестного состояния
                                </span>
                            </div>
                            {events.length ? (
                                <div className="event-list">
                                    {events.map((event, index) => (
                                        <button
                                            key={event.start}
                                            className="event-row"
                                            onClick={() => inspectEvent(event)}
                                        >
                                            <span className={`event-icon ${event.mode}`}>
                                                <Icon
                                                    name={event.mode === "gap" ? "activity" : "alert"}
                                                    size={18}
                                                />
                                            </span>
                                            <span className="event-copy">
                                                <b>
                                                    {event.mode === "gap"
                                                        ? "Пропуск измерений"
                                                        : "Недостоверные измерения"}
                                                </b>
                                                <small>
                                                    {event.mode === "gap"
                                                        ? "Интервал между записями превышает 1,5 с"
                                                        : "Некорректные значения или флаг достоверности"}
                                                </small>
                                            </span>
                                            <span className="event-time">
                                                {duration(event.start)} — {duration(event.end)}
                                            </span>
                                            <span className="event-length">
                                                {fmt(event.end - event.start)} с
                                            </span>
                                            <span className="event-action">
                                                На графике <Icon name="arrow" size={15} />
                                            </span>
                                            <span className="sr-only">Событие {index + 1}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="events-empty">
                                    <Icon name={a.span ? "check" : "info"} size={18} />
                                    <span>
                                        {a.span
                                            ? "Пропусков и недостоверных интервалов не обнаружено"
                                            : "Нет интервалов для проверки качества данных"}
                                    </span>
                                </div>
                            )}
                        </section>
                    )}
                    {(view === "overview" || view === "hypotheses") && (
                        <section className="panel hypotheses-panel">
                            <div className="panel-heading">
                                <div>
                                    <div className="title-with-badge">
                                        <h2>Диагностические гипотезы</h2>
                                        <span className="count-badge">
                                            {active} из 10 актуальны
                                        </span>
                                    </div>
                                    <p>
                                        Возможные особенности работы на основе загруженных данных
                                    </p>
                                </div>
                                {view === "overview" ? (
                                    <button
                                        className="text-button"
                                        onClick={() => setView("hypotheses")}
                                    >
                                        Все гипотезы <Icon name="arrow" size={16} />
                                    </button>
                                ) : (
                                    <div className="filter-tabs">
                                        {[
                                            ["all", "Все"],
                                            ["active", "Актуальные"],
                                            ["inactive", "Не выявлены"],
                                        ].map(([key, label]) => (
                                            <button
                                                className={filter === key ? "selected" : ""}
                                                key={key}
                                                onClick={() => setFilter(key)}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="hypothesis-table">
                                <div className="table-head">
                                    <span>ГИПОТЕЗА</span>
                                    <span>УСЛОВИЕ ПРОВЕРКИ</span>
                                    <span>РЕЗУЛЬТАТ</span>
                                    <span />
                                </div>
                                {(view === "overview"
                                    ? [...a.hypotheses.map((h, i) => ({ ...h, i }))]
                                        .sort((x, y) => Number(y.active) - Number(x.active))
                                        .slice(0, 3)
                                    : visibleHypotheses
                                ).map((h) => (
                                    <div className="hypothesis-row-wrap" key={h.i}>
                                        <button
                                            className="hypothesis-row"
                                            onClick={() => setExpanded(expanded === h.i ? null : h.i)}
                                            aria-expanded={expanded === h.i}
                                        >
                                            <span className="hypothesis-title">
                                                <span
                                                    className={`hypothesis-icon ${h.active ? "is-active" : ""
                                                        }`}
                                                >
                                                    <Icon name={h.active ? "bulb" : "check"} size={17} />
                                                </span>
                                                <span>
                                                    <small>
                                                        Гипотеза {String(h.i + 1).padStart(2, "0")}
                                                    </small>
                                                    <b>{h.title}</b>
                                                </span>
                                            </span>
                                            <span className="hypothesis-description">
                                                {h.description}
                                            </span>
                                            <span className={`badge ${h.active ? "amber" : "quiet"}`}>
                                                <i />
                                                {!a.span ? "Нет интервалов" : h.status === "insufficient_data" ? "Недостаточно данных" : h.active ? "Актуальна" : "Не выявлена"}
                                            </span>
                                            <span
                                                className={
                                                    expanded === h.i
                                                        ? "row-chevron expanded"
                                                        : "row-chevron"
                                                }
                                            >
                                                <Icon name="chevron" size={15} />
                                            </span>
                                        </button>
                                        {expanded === h.i && (
                                            <div className="hypothesis-detail">
                                                <Icon name="info" size={16} />
                                                <span>
                                                    {h.detail}{" "}
                                                    {dataset.synthetic && "Вывод относится только к учебному набору данных."}{" "}
                                                    {backendResult && <a className="text-button" href={getApiUrl(`/api/results/${backendResult.result_id}/hypotheses/${h.id}`)} target="_blank" rel="noreferrer">Открыть JSON гипотезы</a>}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {view === "hypotheses" && !visibleHypotheses.length && (
                                    <div className="table-empty">
                                        Гипотез с таким статусом нет.
                                    </div>
                                )}
                            </div>
                            <div className="panel-foot">
                                <Icon name="info" size={14} />
                                <span>
                                    Гипотезы — это предположения, а не заключение о техническом
                                    состоянии оборудования.
                                </span>
                            </div>
                        </section>
                    )}
                    {view === "data" && (
                        <section className="panel data-panel">
                            <div className="panel-heading">
                                <div>
                                    <h2>
                                        Измерения{" "}
                                        <span className="count-badge">
                                            {fmt(dataset.samples.length)}
                                        </span>
                                    </h2>
                                    <p>Значения левой записи определяют состояние интервала</p>
                                </div>
                                <span className="subtle-tag">
                                    dataset_id: {dataset.dataset_id}
                                </span>
                            </div>
                            <div className="data-toolbar">
                                <label className="search-field">
                                    <Icon name="search" size={17} />
                                    <input
                                        aria-label="Поиск по измерениям"
                                        placeholder="Время, значение или режим…"
                                        value={query}
                                        onChange={(e) => {
                                            setQuery(e.target.value)
                                            setPage(0)
                                        }}
                                    />
                                    {query && (
                                        <button
                                            aria-label="Очистить поиск"
                                            onClick={() => {
                                                setQuery("")
                                                setPage(0)
                                            }}
                                        >
                                            <Icon name="close" size={15} />
                                        </button>
                                    )}
                                </label>
                                <label className="data-filter">
                                    <span>Режим</span>
                                    <select
                                        aria-label="Фильтр по режиму интервала"
                                        value={dataMode}
                                        onChange={(e) => {
                                            setDataMode(e.target.value)
                                            setPage(0)
                                        }}
                                    >
                                        <option value="all">Все режимы</option>
                                        {Object.entries(modeLabels).map(([key, label]) => (
                                            <option key={key} value={key}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <span className="results-count" aria-live="polite">
                                    Найдено: {fmt(rows.length)}
                                </span>
                            </div>
                            <div className="data-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>№</th>
                                            <th>Время, с</th>
                                            <th>Давление, МПа</th>
                                            <th>Обороты, об/мин</th>
                                            <th>Достоверность</th>
                                            <th>Режим интервала</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows
                                            .slice(page * pageSize, page * pageSize + pageSize)
                                            .map(({ sample: s, index, mode }) => (
                                                <tr key={s.t_s}>
                                                    <td>{index + 1}</td>
                                                    <td>{fmt(s.t_s)}</td>
                                                    <td>
                                                        {s.pressure_mpa === null
                                                            ? "null"
                                                            : fmt(s.pressure_mpa)}
                                                    </td>
                                                    <td>{s.rpm === null ? "null" : fmt(s.rpm)}</td>
                                                    <td>
                                                        <span
                                                            className={`badge ${isReliable(s) ? "success" : "amber"
                                                                }`}
                                                        >
                                                            {isReliable(s) ? "Да" : "Нет"}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {mode ? (
                                                            <span className="data-mode">
                                                                <i style={{ background: modeColors[mode] }} />
                                                                {modeLabels[mode]}
                                                            </span>
                                                        ) : (
                                                            "Конец записи"
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            </div>
                            {!rows.length && (
                                <div className="table-empty">
                                    <Icon name="search" size={25} />
                                    <b>
                                        {dataset.samples.length
                                            ? "Измерения не найдены"
                                            : "Массив samples пуст"}
                                    </b>
                                    <span>
                                        {dataset.samples.length
                                            ? "Попробуйте другой запрос или сбросьте фильтры."
                                            : "Загрузите файл с измерениями для просмотра."}
                                    </span>
                                    {(query || dataMode !== "all") && (
                                        <button
                                            className="text-button"
                                            onClick={() => {
                                                setQuery("")
                                                setDataMode("all")
                                                setPage(0)
                                            }}
                                        >
                                            Сбросить фильтры <Icon name="arrow" size={15} />
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className="pagination">
                                <span>
                                    Показано {rows.length ? page * pageSize + 1 : 0}–
                                    {Math.min(page * pageSize + pageSize, rows.length)} из{" "}
                                    {fmt(rows.length)}
                                </span>
                                <div>
                                    <label className="page-size">
                                        На странице{" "}
                                        <select
                                            aria-label="Количество строк на странице"
                                            value={pageSize}
                                            onChange={(e) => {
                                                setPageSize(Number(e.target.value))
                                                setPage(0)
                                            }}
                                        >
                                            <option value="20">20</option>
                                            <option value="50">50</option>
                                            <option value="100">100</option>
                                        </select>
                                    </label>
                                    <button
                                        className="button secondary"
                                        disabled={page === 0}
                                        onClick={() => setPage(page - 1)}
                                    >
                                        Назад
                                    </button>
                                    <button
                                        className="button secondary"
                                        disabled={(page + 1) * pageSize >= rows.length}
                                        onClick={() => setPage(page + 1)}
                                    >
                                        Далее
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}
                    <footer className="main-footer">
                        <span>
                            <span className="footer-dot" /> Анализ выполнен сервером Pump Analyzer API
                        </span>
                        <span>
                            PumpInsight
                        </span>
                    </footer>
                </main>
            </div>
            {modal && (
                <div
                    className="modal-backdrop"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) setModal(null)
                    }}
                >
                    <section
                        className="modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="modal-title"
                        onKeyDown={(e) => {
                            if (e.key === "Escape") setModal(null)
                        }}
                    >
                        <button
                            className="modal-close icon-button"
                            aria-label="Закрыть"
                            onClick={() => setModal(null)}
                            autoFocus
                        >
                            <Icon name="close" />
                        </button>
                        {modal === "upload" ? (
                            <>
                                <div className="modal-symbol">
                                    <Icon name="upload" size={25} />
                                </div>
                                <h2 id="modal-title">Новый анализ</h2>
                                <p>
                                    Загрузите JSON с измерениями насоса.
                                    <br />
                                    Файл будет отправлен на локальный сервер FastAPI для анализа.
                                </p>
                                <button
                                    className={`dropzone ${dragging ? "dragging" : ""}`}
                                    disabled={isLoading}
                                    onDragOver={(e) => {
                                        e.preventDefault()
                                        setDragging(true)
                                    }}
                                    onDragLeave={() => setDragging(false)}
                                    onDrop={(e) => {
                                        e.preventDefault()
                                        setDragging(false)
                                        void loadFile(e.dataTransfer.files[0])
                                    }}
                                    onClick={() => inputRef.current?.click()}
                                >
                                    <Icon name="file" size={30} />
                                    <b>{isLoading ? "Отправка и анализ…" : "Перетащите JSON-файл сюда"}</b>
                                    <span>
                                        или <u>выберите на устройстве</u>
                                    </span>
                                    <small>JSON · схема 1.0</small>
                                </button>
                                <input
                                    ref={inputRef}
                                    type="file"
                                    accept=".json,application/json"
                                    hidden
                                    disabled={isLoading}
                                    onChange={(e) => {
                                        void loadFile(e.target.files?.[0])
                                        e.target.value = ""
                                    }}
                                />
                                {error && (
                                    <div className="upload-error" role="alert">
                                        <Icon name="alert" size={19} />
                                        <div>
                                            <b>Файл не прошёл проверку</b>
                                            <p>{error.message}</p>
                                            <code>status: format_error · {error.category}</code>
                                            <small>
                                                Итоги для этого файла не рассчитаны. Предыдущий анализ
                                                сохранён.
                                            </small>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : modal === "help" ? (
                            <>
                                <div className="modal-symbol">
                                    <Icon name="help" size={25} />
                                </div>
                                <h2 id="modal-title">Как работает PumpInsight</h2>
                                <p>Три шага от измерений к результатам анализа.</p>
                                <div className="help-steps">
                                    {[
                                        [
                                            "01",
                                            "Загрузите данные",
                                            "JSON должен содержать schema_version: «1.0», dataset_id, synthetic и массив samples.",
                                        ],
                                        [
                                            "02",
                                            "Изучите результаты",
                                            "Наработка, остановки и неизвестное состояние рассчитываются по интервалам между измерениями. Нажмите на гипотезу, чтобы увидеть расчёт.",
                                        ],
                                        [
                                            "03",
                                            "Сохраните отчёт",
                                            "Экспортируйте метрики и результаты всех 10 гипотез в JSON.",
                                        ],
                                    ].map(([n, t, d]) => (
                                        <div key={n}>
                                            <span>{n}</span>
                                            <div>
                                                <h3>{t}</h3>
                                                <p>{d}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <pre>
                                    {
                                        '{\n  "schema_version": "1.0",\n  "dataset_id": "my_pump",\n  "synthetic": true,\n  "samples": [\n    {"t_s": 0, "pressure_mpa": 7, "rpm": 100, "valid": true},\n    {"t_s": 1, "pressure_mpa": 7, "rpm": 100, "valid": true}\n  ]\n}'
                                    }
                                </pre>
                                <button
                                    className="button primary full"
                                    onClick={() => setModal("upload")}
                                >
                                    Попробовать анализ <Icon name="arrow" size={16} />
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="modal-symbol">
                                    <Icon name="settings" size={25} />
                                </div>
                                <h2 id="modal-title">Параметры анализа</h2>
                                <p>Фиксированные правила учебной спецификации 1.0.</p>
                                <div className="settings-list">
                                    {[
                                        ["Номинальный шаг", "1 секунда"],
                                        ["Максимальный интервал", "1,5 секунды"],
                                        ["Минимальные обороты работы", "50 об/мин"],
                                        ["Минимальное давление работы", "1 МПа"],
                                        ["Режим low", "1 ≤ P < 5 МПа"],
                                        ["Режим normal", "5 ≤ P < 10 МПа"],
                                        ["Режим high", "P ≥ 10 МПа"],
                                        ["Интерполяция / экстраполяция", "Отключены"],
                                        ["Порог снижения давления (гипотеза 5)", "10%"],
                                        ["Порог переключений (гипотеза 6)", "10 в час"],
                                    ].map(([l, v]) => (
                                        <div key={l}>
                                            <span>{l}</span>
                                            <b>{v}</b>
                                        </div>
                                    ))}
                                </div>
                                <div className="notice">
                                    <Icon name="info" size={16} />
                                    <span>
                                        Приоритет классификации: пропуск → недостоверность → работа
                                        или остановка. Последняя точка только закрывает интервал.
                                    </span>
                                </div>
                                <button
                                    className="button primary full"
                                    onClick={() => setModal(null)}
                                >
                                    Понятно
                                </button>
                            </>
                        )}
                    </section>
                </div>
            )}
            {toast && (
                <div className="toast" role="status">
                    <span>
                        <Icon name="check" size={16} />
                    </span>
                    {toast}
                </div>
            )}
        </div>
    )
}
