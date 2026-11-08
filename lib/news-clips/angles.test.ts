import assert from "node:assert/strict"
import test from "node:test"

import {
  angleHasLockedRange,
  normalizeAngleOptions,
} from "./angles.ts"

test("각도 정규화는 주제 구간 start/end를 보존한다", () => {
  const angles = normalizeAngleOptions([
    {
      id: "a1",
      title: "예산 모순",
      summary: "예산은 늘었는데 현장은 반대라고 한다.",
      keywords: ["예산"],
      sourceStart: 120.4,
      sourceEnd: 168.2,
    },
  ])
  assert.equal(angles.length, 1)
  assert.equal(angles[0]?.sourceStart, 120.4)
  assert.equal(angles[0]?.sourceEnd, 168.2)
  assert.equal(angleHasLockedRange(angles[0]!), true)
})

test("구간이 너무 짧으면 locked range가 아니다", () => {
  const angles = normalizeAngleOptions([
    {
      title: "짧은 구간",
      summary: "설명",
      sourceStart: 10,
      sourceEnd: 11,
    },
  ])
  assert.equal(angleHasLockedRange(angles[0]!), false)
})
