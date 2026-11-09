import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveOverlappingKeeps,
  snapKeepEndsToSpeech,
  snapSourceRangeToCompleteUtterance,
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

test("시간 상한 없이 현재 문장이 끝나는 지점까지 연장한다", () => {
  const longTranscript: TranscriptSegment[] = [
    {
      id: "1",
      text: "그런데 이 설명만으로는",
      start: 20,
      end: 22,
      speaker: "a",
      words: [],
    },
    {
      id: "2",
      text: "앞뒤가 전혀 맞지 않았고",
      start: 22.2,
      end: 25,
      speaker: "a",
      words: [],
    },
    {
      id: "3",
      text: "결국 추가 해명이 필요했습니다.",
      start: 25.2,
      end: 29,
      speaker: "a",
      words: [],
    },
  ]
  const snapped = snapSourceRangeToCompleteUtterance(20, 21.4, longTranscript)
  assert.equal(snapped.end, 29)
})

test("완결 표지가 없으면 마지막 전사 구간까지 사용한다", () => {
  const unfinished: TranscriptSegment[] = [
    {
      id: "1",
      text: "이 설명은",
      start: 30,
      end: 31,
      speaker: "a",
      words: [],
    },
    {
      id: "2",
      text: "다음 내용으로 이어지고",
      start: 31.2,
      end: 34,
      speaker: "a",
      words: [],
    },
  ]
  const snapped = snapSourceRangeToCompleteUtterance(30, 30.8, unfinished)
  assert.equal(snapped.end, 34)
})

test("완결 발언 보정도 시작 단어를 자르지 않는다", () => {
  const snapped = snapSourceRangeToCompleteUtterance(10.7, 13.7, transcript)
  assert.equal(snapped.start, 10.5)
  assert.equal(snapped.end, 16)
})

test("레거시 단어 시간이 겹치면 현재 시점과 가장 가까운 단어를 고른다", () => {
  const overlapping: TranscriptSegment[] = [
    {
      id: "old",
      text: "11월 6일",
      start: 73,
      end: 77.84,
      speaker: "a",
      words: [{ text: "6일", start: 75.42, end: 77.84 }],
    },
    {
      id: "current",
      text: "대한민국 법치주의가 사망했습니다.",
      start: 76,
      end: 83.28,
      speaker: "a",
      words: [
        { text: "대한민국", start: 76, end: 77.8 },
        { text: "법치주의가", start: 77.8, end: 80.2 },
        { text: "사망했습니다.", start: 80.2, end: 83.28 },
      ],
    },
  ]

  const snapped = snapSourceRangeToCompleteUtterance(76, 80, overlapping)
  assert.equal(snapped.start, 76)
  assert.equal(snapped.end, 83.28)
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
