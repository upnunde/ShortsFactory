import assert from "node:assert/strict"
import test from "node:test"

import {
  newsHistoryActivityAt,
  resolveNewsHistoryCompletedAt,
  type NewsHistoryEntry,
} from "./history.ts"

test("최종본을 다시 만들면 가장 최근 완료 시각을 사용한다", () => {
  assert.equal(
    resolveNewsHistoryCompletedAt({
      finalized: true,
      requested: "2026-11-11T14:02:56.000Z",
      existing: "2026-11-10T04:35:18.000Z",
      fallback: "2026-11-11T14:03:39.000Z",
    }),
    "2026-11-11T14:02:56.000Z"
  )
})

test("일반 저장은 기존 완료 시각을 유지한다", () => {
  assert.equal(
    resolveNewsHistoryCompletedAt({
      finalized: true,
      existing: "2026-11-10T04:35:18.000Z",
      fallback: "2026-11-11T14:03:39.000Z",
    }),
    "2026-11-10T04:35:18.000Z"
  )
})

test("처음 완료할 때만 저장 시각을 완료 시각으로 사용한다", () => {
  assert.equal(
    resolveNewsHistoryCompletedAt({
      finalized: true,
      fallback: "2026-11-11T14:03:39.000Z",
    }),
    "2026-11-11T14:03:39.000Z"
  )
  assert.equal(
    resolveNewsHistoryCompletedAt({
      finalized: false,
      fallback: "2026-11-11T14:03:39.000Z",
    }),
    undefined
  )
})

test("완료 항목은 가장 최근 최종본 완료일로 정렬한다", () => {
  const entry = {
    finalized: true,
    completedAt: "2026-11-10T04:35:18.000Z",
    updatedAt: "2026-11-11T14:03:39.000Z",
  } as NewsHistoryEntry

  assert.equal(newsHistoryActivityAt(entry), entry.completedAt)
})
