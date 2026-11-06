import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCandidateWindows,
  detectSilenceRanges,
  editedDuration,
  expandSourceRange,
  finalDurationAllowed,
  fitEditPlan,
  makeKeepRanges,
  sourceToOutputTime,
} from "./timeline.ts"
import type { TranscriptSegment, TranscriptWord } from "./types.ts"

test("0.25초 이상 무발화만 발음 여백을 남기고 제거한다", () => {
  const words: TranscriptWord[] = [
    { text: "이것은", start: 0, end: 0.4 },
    { text: "시험입니다", start: 0.55, end: 1 },
    { text: "그런데", start: 1.5, end: 1.9 },
  ]
  const removed = detectSilenceRanges(words, 0, 2, 0.25, 0.08)
  assert.equal(removed.length, 1)
  assert.equal(removed[0].start, 1.08)
  assert.equal(removed[0].end, 1.42)
})

test("삭제 구간을 반영해 원본과 출력 시간을 매핑한다", () => {
  const keep = makeKeepRanges(10, 20, [
    { id: "a", start: 12, end: 14, reason: "silence", restored: false },
    { id: "b", start: 16, end: 17, reason: "silence", restored: true },
  ])
  assert.deepEqual(keep, [
    { sourceStart: 10, sourceEnd: 12, outputStart: 0, outputEnd: 2 },
    { sourceStart: 14, sourceEnd: 20, outputStart: 2, outputEnd: 8 },
  ])
  assert.equal(sourceToOutputTime(15, keep), 3)
  assert.equal(editedDuration(keep), 8)
})

test("전체 녹취에서 중복을 줄인 후보 3개를 만든다", () => {
  const segments: TranscriptSegment[] = Array.from(
    { length: 18 },
    (_, index) => ({
      id: `s${index}`,
      text:
        index % 3 === 0
          ? `세금과 부동산 규제로 ${index + 10}% 피해가 발생했습니다.`
          : "정책에 대한 직접 발언을 이어갑니다.",
      start: index * 12,
      end: index * 12 + 10,
      speaker: "speaker-1",
      words: [],
    })
  )
  const candidates = buildCandidateWindows(segments, {
    targetMinSeconds: 45,
    targetMaxSeconds: 58,
  })
  assert.equal(candidates.length, 3)
  assert.ok(
    candidates.every((candidate) => candidate.titleOptions.length === 3)
  )
  assert.ok(candidates[0].scores.total >= 0)
})

test("제목 프레임을 포함해 50~55초로 낮은 핵심도 문장을 제거한다", () => {
  const segments: TranscriptSegment[] = Array.from(
    { length: 8 },
    (_, index) => ({
      id: `fit-${index}`,
      text:
        index === 3
          ? "세금이 20% 늘어 국민 피해가 커졌습니다."
          : "추가로 일반적인 설명을 이어가겠습니다.",
      start: index * 10,
      end: index * 10 + 10,
      speaker: "speaker-1",
      words: [],
    })
  )
  const plan = fitEditPlan({
    segments,
    start: 0,
    end: 80,
    silenceRanges: [],
    titleSeconds: 2.5,
  })
  assert.equal(plan.meetsIdeal, true)
  assert.ok(plan.finalDurationSeconds >= 50)
  assert.ok(plan.finalDurationSeconds <= 55)
  assert.ok(
    plan.removedRanges.some((range) => range.reason === "low_importance")
  )
})

test("45~58초는 권장 범위이며 59초 미만이면 제작할 수 있다", () => {
  assert.equal(finalDurationAllowed(30), true)
  assert.equal(finalDurationAllowed(45), true)
  assert.equal(finalDurationAllowed(58), true)
  assert.equal(finalDurationAllowed(58.99), true)
  assert.equal(finalDurationAllowed(59), false)
})

test("45초보다 짧은 핵심 구간은 인접 문장으로 70~100초까지 확장한다", () => {
  const segments: TranscriptSegment[] = Array.from(
    { length: 12 },
    (_, index) => ({
      id: `expand-${index}`,
      text: `원본 발언 ${index + 1}`,
      start: index * 10,
      end: index * 10 + 9,
      speaker: "speaker-1",
      words: [],
    })
  )
  const range = expandSourceRange(segments, 40, 59)
  assert.ok(range.end - range.start >= 70)
  assert.ok(range.end - range.start <= 100)
  assert.ok(range.start <= 40)
  assert.ok(range.end >= 59)
})
