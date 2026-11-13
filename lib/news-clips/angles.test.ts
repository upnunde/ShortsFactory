import assert from "node:assert/strict"
import test from "node:test"

import {
  angleHasLockedRange,
  includeLeadingContext,
  lockAngleRangeToTranscript,
  normalizeAngleOptions,
  transcriptForAngle,
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

test("사용 구간과 겹치는 모든 전사 문장을 시간순으로 반환한다", () => {
  const segments = transcriptForAngle({ sourceStart: 10, sourceEnd: 20 }, [
    { id: "after", text: "범위 뒤", start: 20, end: 24 },
    { id: "middle", text: "두 번째 문장", start: 14, end: 18 },
    { id: "edge", text: "첫 번째 문장", start: 8, end: 12 },
    { id: "before", text: "범위 앞", start: 2, end: 8 },
  ])

  assert.deepEqual(
    segments.map((segment) => segment.id),
    ["edge", "middle"]
  )
})

test("선택 시작 전에 발음이 끝난 자막 tail은 2번 전체 내용에 포함하지 않는다", () => {
  const transcript = [
    {
      id: "previous",
      text: "목격했습니다.",
      start: 67.7,
      end: 71.44,
      words: [{ text: "목격했습니다.", start: 67.7, end: 70.3 }],
    },
    {
      id: "selected",
      text: "2026년 11월 6일",
      start: 70.64,
      end: 73.94,
      words: [
        { text: "2026년", start: 70.64, end: 72.04 },
        { text: "11월", start: 72.04, end: 73.44 },
        { text: "6일", start: 73.44, end: 73.94 },
      ],
    },
  ]
  const range = { sourceStart: 70.3, sourceEnd: 73.94 }

  assert.deepEqual(
    transcriptForAngle(range, transcript).map((segment) => segment.id),
    ["selected"]
  )
  const locked = lockAngleRangeToTranscript(
    {
      id: "date",
      title: "날짜 발언",
      summary: "설명",
      keywords: [],
      evidence: "",
      ...range,
    },
    transcript
  )
  assert.equal(locked.sourceStart, 70.64)
  assert.equal(locked.sourceEnd, 73.94)
})

test("사용 구간이 확정되지 않으면 전사를 표시하지 않는다", () => {
  assert.deepEqual(
    transcriptForAngle({ sourceStart: 10, sourceEnd: 11 }, [
      { id: "one", text: "문장", start: 10, end: 11 },
    ]),
    []
  )
})

test("2번에 표시하는 전사 문장과 실제 영상 구간을 같은 경계로 고정한다", () => {
  const angle = lockAngleRangeToTranscript(
    {
      id: "a1",
      title: "핵심 발언",
      summary: "설명",
      keywords: [],
      evidence: "",
      sourceStart: 10,
      sourceEnd: 20,
    },
    [
      { id: "one", text: "첫 문장", start: 8, end: 12 },
      { id: "two", text: "둘째 문장", start: 14, end: 22 },
    ]
  )

  assert.equal(angle.sourceStart, 8)
  assert.equal(angle.sourceEnd, 22)
})

test("대상이 빠진 짧은 서술어로 시작하면 앞 문맥까지 포함한다", () => {
  const angle = includeLeadingContext(
    {
      id: "a1",
      title: "결론만 잘린 발언",
      summary: "설명",
      keywords: [],
      evidence: "",
      sourceStart: 12,
      sourceEnd: 15,
    },
    [
      { id: "subject", text: "결국 대한민국은 위기 속에서", start: 8, end: 12 },
      { id: "predicate", text: "살았습니다.", start: 12, end: 15 },
    ]
  )

  assert.equal(angle.sourceStart, 8)
})

test("주어와 내용이 완결된 시작 문장은 앞 구간을 추가하지 않는다", () => {
  const angle = includeLeadingContext(
    {
      id: "a1",
      title: "완결 발언",
      summary: "설명",
      keywords: [],
      evidence: "",
      sourceStart: 12,
      sourceEnd: 16,
    },
    [
      { id: "before", text: "앞선 다른 내용입니다.", start: 8, end: 12 },
      {
        id: "complete",
        text: "정부는 관련 예산을 늘렸습니다.",
        start: 12,
        end: 16,
      },
    ]
  )

  assert.equal(angle.sourceStart, 12)
})
