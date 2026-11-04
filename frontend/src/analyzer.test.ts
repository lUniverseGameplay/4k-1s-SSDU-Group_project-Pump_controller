import { test } from "node:test"
import assert from "node:assert/strict"
import { analyze, demoDataset, validate, FormatError } from "./analyzer.ts"

const data = (samples: unknown[]) => ({
    schema_version: "1.0",
    dataset_id: "test",
    synthetic: true,
    samples,
})
const sample = (
    t_s: number,
    pressure_mpa: number | null = 7,
    rpm: number | null = 100,
    valid: unknown = true,
) => ({ t_s, pressure_mpa, rpm, valid })
test("short demo totals and accounting identities", () => {
    const a = analyze(demoDataset("small"))
    assert.equal(a.working, 9)
    assert.equal(a.totals.stopped, 3)
    assert.equal(a.span, 12)
    assert.deepEqual(a.result.modes_s, { low: 3, normal: 3, high: 3 })
})
test("long demo matches specified time totals", () => {
    const a = analyze(demoDataset())
    assert.equal(a.span, 1800)
    assert.equal(a.working, 1130)
    assert.equal(a.totals.stopped, 600)
    assert.equal(a.totals.gap, 60)
    assert.equal(a.totals.invalid, 10)
    assert.equal(a.unknown, 70)
})
test("empty and single-point datasets produce zero durations", () => {
    for (const samples of [[], [sample(10)]]) {
        const a = analyze(validate(data(samples)))
        assert.equal(a.span, 0)
        assert.equal(a.working, 0)
        assert.equal(a.unknown, 0)
    }
})
test("classification uses left record, exact boundaries and no extra final second", () => {
    const a = analyze(
        validate(
            data([
                sample(0, 1, 50),
                sample(1, 5, 50),
                sample(2, 10, 50),
                sample(3, 0.9, 50),
                sample(4, 7, 49),
                sample(5),
            ]),
        ),
    )
    assert.deepEqual(a.totals, {
        low: 1,
        normal: 1,
        high: 1,
        stopped: 2,
        gap: 0,
        invalid: 0,
    })
})
test("gap takes priority over invalid and interval exactly 1.5 is not gap", () => {
    const a = analyze(
        validate(data([sample(0, null, null, false), sample(3), sample(4.5)])),
    )
    assert.equal(a.totals.gap, 3)
    assert.equal(a.totals.invalid, 0)
    assert.equal(a.working, 1.5)
})
test("null, negative and invalid flags classify as invalid", () => {
    const a = analyze(
        validate(
            data([
                sample(0, null),
                sample(1, -1),
                sample(2, 7, -1),
                sample(3, 7, 100, false),
                sample(4, 7, null),
                sample(5),
            ]),
        ),
    )
    assert.equal(a.totals.invalid, 5)
})
test("20-minute gap accounting", () => {
    const samples = [
        ...Array.from({ length: 301 }, (_, i) => sample(i)),
        ...Array.from({ length: 301 }, (_, i) => sample(1500 + i)),
    ]
    const a = analyze(validate(data(samples)))
    assert.equal(a.working, 600)
    assert.equal(a.unknown, 1200)
    assert.equal(a.span, 1800)
})
test("validation rejects malformed structures with actionable categories", () => {
    const cases: [unknown, string][] = [
        [{}, "missing_field"],
        [data([{ t_s: 0, pressure_mpa: 3, valid: true }]), "missing_field"],
        [data([{ ...sample(0), pressure_mpa: "7" }]), "wrong_type"],
        [data([sample(0), sample(0)]), "non_increasing_time"],
        [data([sample(2), sample(1)]), "non_increasing_time"],
        [data([sample(-1)]), "non_increasing_time"],
        [data([sample(0, Infinity)]), "wrong_type"],
        [{ ...data([]), schema_version: "2.0" }, "unsupported_version"],
        [{ ...data([]), samples: {} }, "wrong_type"],
    ]
    for (const [input, category] of cases)
        assert.throws(
            () => validate(input),
            (e) => e instanceof FormatError && e.category === category,
        )
})
test("boolean-like sensor flags follow consolidated specification", () => {
    const d = validate(
        data([
            sample(0, 7, 100, "true"),
            sample(1, 7, 100, "0"),
            sample(2, 7, 100, null),
        ]),
    )
    assert.deepEqual(
        d.samples.map((s) => s.valid),
        [true, false, null],
    )
})
test("hypotheses detect continuous low run, correlation, high and gap recovery", () => {
    const a = analyze(
        validate(data(Array.from({ length: 302 }, (_, i) => sample(i, 3)))),
    )
    assert.equal(a.hypotheses[0].active, true)
    assert.equal(a.hypotheses[6].active, true)
    const b = analyze(
        validate(data([sample(0), sample(10, 11), sample(11, 11), sample(12)])),
    )
    assert.equal(b.hypotheses[8].active, true)
    assert.equal(b.hypotheses[7].active, true)
})
