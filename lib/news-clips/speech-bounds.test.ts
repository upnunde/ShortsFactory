import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveOverlappingKeeps,
  snapKeepEndsToSpeech,
  snapSourceRangeToSpeech,
} from "./speech-bounds.ts"
import type { TranscriptSegment } from "./types.ts"

const transcript: TranscriptSegment[] = [
  {
    id: "1",
    text: "오늘 정부가 발표했습니다.",
    start: 10,
    end: 12.5,
    speaker: "a",
    words: [
      { text: "오늘", start: 10, end: 10.4 },
      { text: "정부가", start: 10.5, end: 11.1 },
      { text: "발표했습니다.", start: 11.2, end: 12.5 },
    ],
  },
  {
    id: "2",
    text: "그런데 내용은",
    start: 13,
    end: 14.2,
    speaker: "a",
    words: [
      { text: "그런데", start: 13, end: 13.4 },
      { text: "내용은", start: 13.5, end: 14.2 },
    ],
  },
  {
    id: "3",
    text: "전혀 달랐습니다.",
    start: 14.5,
    end: 16,
    speaker: "a",
    words: [
      { text: "전혀", start: 14.5, end: 14.9 },
      { text: "달랐습니다.", start: 15, end: 16 },
    ],
  },
]

test("말 중간에서 끝나면 직전 완성 발화 끝으로 당긴다", () => {
  const snapped = snapSourceRangeToSpeech(10, 13.7, transcript)
  assert.equal(snapped.start, 10)
  assert.equal(snapped.end, 12.5)
})

test("완성 발화 끝이 가까우면 그 지점까지 연장한다", () => {
  const snapped = snapSourceRangeToSpeech(13, 15.7, transcript)
  assert.equal(snapped.end, 16)
})

test("시작이 단어 중간이면 단어 시작으로 맞춘다", () => {
  const snapped = snapSourceRangeToSpeech(10.7, 12.5, transcript)
  assert.equal(snapped.start, 10.5)
})

test("겹친 keep은 앞 구간 뒤로 잘라 같은 장면이 반복되지 않게 한다", () => {
  const resolved = resolveOverlappingKeeps([
    { start: 10, end: 12 },
    { start: 10, end: 14 },
    { start: 13.5, end: 16 },
    { start: 13.5, end: 16 },
  ])
  assert.deepEqual(resolved, [
    { start: 10, end: 12 },
    { start: 12, end: 14 },
    { start: 14, end: 16 },
  ])
})

test("발화 스냅 후 keep 겹침을 정리한다", () => {
  const keeps = snapKeepEndsToSpeech(
    [
      { start: 10.2, end: 11.5 },
      { start: 11.6, end: 13.2 },
    ],
    transcript
  )
  for (let index = 1; index < keeps.length; index += 1) {
    assert.ok(keeps[index]!.start >= keeps[index - 1]!.end - 0.01)
  }
})
