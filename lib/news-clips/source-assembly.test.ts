import assert from "node:assert/strict"
import test from "node:test"

import { buildSourceAssemblyPlan } from "./source-assembly.ts"

test("떨어진 핵심 구간을 원본 순서의 연속 출력 타임라인으로 조립한다", () => {
  const plan = buildSourceAssemblyPlan([
    { sourceStart: 30, sourceEnd: 36 },
    { sourceStart: 0, sourceEnd: 6 },
    { sourceStart: 50, sourceEnd: 56 },
  ])

  assert.deepEqual(plan.ranges, [
    { start: 0, end: 6 },
    { start: 30, end: 36 },
    { start: 50, end: 56 },
  ])
  assert.deepEqual(plan.keepRanges, [
    { sourceStart: 0, sourceEnd: 6, outputStart: 0, outputEnd: 6 },
    { sourceStart: 30, sourceEnd: 36, outputStart: 6, outputEnd: 12 },
    { sourceStart: 50, sourceEnd: 56, outputStart: 12, outputEnd: 18 },
  ])
  assert.deepEqual(
    plan.removedRanges.map((range) => [range.start, range.end]),
    [
      [6, 30],
      [36, 50],
    ]
  )
  assert.equal(plan.duration, 18)
})

test("겹치거나 맞닿은 핵심 구간은 중복 재생하지 않도록 합친다", () => {
  const plan = buildSourceAssemblyPlan([
    { start: 10, end: 18 },
    { start: 17.95, end: 24 },
    { start: 40, end: 45 },
  ])

  assert.deepEqual(plan.ranges, [
    { start: 10, end: 24 },
    { start: 40, end: 45 },
  ])
  assert.equal(plan.duration, 19)
})
