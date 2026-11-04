import { test } from "node:test"
import assert from "node:assert/strict"
import { analyze, validate } from "./analyzer.ts"
import {
    clipIntervals,
    filterMeasurements,
    isReliable,
    problemEvents,
} from "./analysis-view.ts"

const sample = (
    t_s: number,
    pressure_mpa: number | null = 7,
    valid = true,
) => ({ t_s, pressure_mpa, rpm: 100, valid })
const dataset = validate({
    schema_version: "1.0",
    dataset_id: "view-test",
    synthetic: true,
    samples: [
        sample(0),
        sample(1, null),
        sample(2, -1),
        sample(3),
        sample(10),
        sample(11),
    ],
})
const analysis = analyze(dataset)

test("zoom clips intervals without reclassifying a gap or altering totals", () => {
    const clipped = clipIntervals(analysis.intervals, 5, 5.5)
    assert.equal(clipped.length, 1)
    assert.equal(clipped[0].mode, "gap")
    assert.equal(clipped[0].start, 5)
    assert.equal(clipped[0].end, 5.5)
    assert.equal(analysis.totals.gap, 7)
    assert.equal(analysis.intervals[3].start, 3)
})
test("zoom does not include intervals that only touch the window boundary", () => {
    assert.deepEqual(
        clipIntervals(analysis.intervals, 0, 1).map((i) => i.mode),
        ["normal"],
    )
    assert.deepEqual(clipIntervals([], 0, 0), [])
})
test("problem events merge contiguous invalid records without mutating source", () => {
    const events = problemEvents(analysis.intervals)
    assert.deepEqual(
        events.map((e) => [e.start, e.end, e.mode]),
        [
            [1, 3, "invalid"],
            [3, 10, "gap"],
        ],
    )
    assert.equal(analysis.intervals[1].end, 2)
    assert.deepEqual(problemEvents([]), [])
})
test("reliability accounts for missing and negative values, not only sensor flag", () => {
    assert.equal(isReliable(sample(0)), true)
    assert.equal(isReliable(sample(0, null)), false)
    assert.equal(isReliable(sample(0, -1)), false)
    assert.equal(isReliable(sample(0, 7, false)), false)
    assert.equal(isReliable({ ...sample(0), rpm: -2 }), false)
})
test("measurement filters preserve original indices and support Russian mode names", () => {
    const rows = filterMeasurements(
        dataset.samples,
        analysis.intervals,
        "недостоверно",
        "all",
    )
    assert.deepEqual(
        rows.map((row) => row.index),
        [1, 2],
    )
    assert.equal(
        filterMeasurements(dataset.samples, analysis.intervals, "", "gap")[0].index,
        3,
    )
    assert.equal(
        filterMeasurements(
            dataset.samples,
            analysis.intervals,
            "несуществующее",
            "all",
        ).length,
        0,
    )
    assert.equal(filterMeasurements([], [], "", "all").length, 0)
    assert.equal(
        filterMeasurements(dataset.samples, analysis.intervals, "конец", "all")[0]
            .index,
        5,
    )
})
test("search normalizes decimal commas and trims whitespace", () => {
    const samples = [sample(1.25)]
    assert.equal(filterMeasurements(samples, [], " 1,25 ", "all").length, 1)
})
