import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveOverlappingKeeps,
  snapKeepEndsToSpeech,
  snapSourceRangeToCompleteUtterance,
  snapSourceRangeToSpeech,
  tightenLockedSourceRangeToSpeech,
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

test("잠긴 범위의 양끝에 긴 무자막 영상이 남으면 완전한 단어 안쪽으로 줄인다", () => {
  const legacy: TranscriptSegment[] = [
    {
      id: "boundary-start",
      text: "범죄자 이재명의 감옥행을 막는 것입니다.",
      start: 177.09,
      end: 183.11,
      speaker: "a",
      words: [
        { text: "범죄자", start: 175.59, end: 177.79 },
        { text: "이재명의", start: 177.79, end: 179.83 },
        { text: "감옥행을", start: 179.83, end: 181.47 },
        { text: "막는", start: 181.47, end: 182.59 },
        { text: "것입니다.", start: 182.59, end: 183.11 },
      ],
    },
    {
      id: "boundary-end",
      text: "마지막 발언입니다.",
      start: 237.59,
      end: 238.37,
      speaker: "a",
      words: [
        { text: "마지막", start: 237.59, end: 238.01 },
        { text: "발언입니다.", start: 238.01, end: 238.37 },
      ],
    },
  ]

  assert.deepEqual(tightenLockedSourceRangeToSpeech(177.09, 239.69, legacy), {
    start: 177.79,
    end: 238.37,
  })
})

test("짧은 자연 호흡 여백은 잠긴 영상 범위에 그대로 둔다", () => {
  const padded: TranscriptSegment[] = [
    {
      id: "selected",
      text: "2026년 발언입니다.",
      start: 70.64,
      end: 141.76,
      speaker: "a",
      words: [
        { text: "2026년", start: 70.64, end: 72.04 },
        { text: "발언입니다.", start: 141.32, end: 141.76 },
      ],
    },
  ]

  assert.deepEqual(tightenLockedSourceRangeToSpeech(70.3, 141.8, padded), {
    start: 70.3,
    end: 141.8,
  })
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

test("사용자가 확정한 시작 하한은 단어 시작 스냅보다 우선한다", () => {
  const snapped = snapSourceRangeToCompleteUtterance(10.7, 13.7, transcript, {
    minimumStart: 10.7,
  })
  assert.equal(snapped.start, 10.7)
  assert.equal(snapped.end, 16)
})

test("검수 자막의 빈 tail에서 이전 문장 시작으로 되감지 않는다", () => {
  const reviewed: TranscriptSegment[] = [
    {
      id: "review-caption-66460-20",
      text: "목격했습니다.",
      start: 66.46,
      end: 71.42,
      speaker: "speaker-1",
      words: [{ text: "목격했습니다.", start: 66.46, end: 68.4 }],
      captionBoundaryAfter: true,
      captionBoundarySource: "automatic",
    },
    {
      id: "review-caption-71420-21",
      text: "2026년 11월 6일",
      start: 71.42,
      end: 73.94,
      speaker: "speaker-1",
      words: [
        { text: "2026년", start: 71.42, end: 72.02 },
        { text: "11월", start: 72.02, end: 73.42 },
        { text: "6일", start: 73.42, end: 73.94 },
      ],
      captionBoundaryAfter: true,
      captionBoundarySource: "automatic",
    },
    {
      id: "review-caption-73940-22",
      text: "대한민국 법치주의가",
      start: 73.94,
      end: 78.76,
      speaker: "speaker-1",
      words: [
        { text: "대한민국", start: 73.94, end: 76.68 },
        { text: "법치주의가", start: 76.68, end: 78.76 },
      ],
      captionBoundaryAfter: true,
      captionBoundarySource: "automatic",
    },
    {
      id: "review-caption-78760-23",
      text: "사망했습니다.",
      start: 78.76,
      end: 81.02,
      speaker: "speaker-1",
      words: [{ text: "사망했습니다.", start: 78.76, end: 81.02 }],
      captionBoundaryAfter: true,
      captionBoundarySource: "automatic",
    },
  ]

  const snapped = snapSourceRangeToCompleteUtterance(70.62, 81.02, reviewed, {
    minimumStart: 70.62,
  })
  assert.deepEqual(snapped, { start: 70.62, end: 81.02 })
})

test("확정한 끝 상한은 다음 완결 문장까지 자동 연장하지 않는다", () => {
  const latestTranscript: TranscriptSegment[] = [
    {
      id: "segment-34",
      text: "지금 대한민국이 독재국가가 되고 있습니다.",
      start: 136.18,
      end: 141.76,
      speaker: "speaker-1",
      words: [
        { text: "지금", start: 136.18, end: 138.08 },
        { text: "대한민국이", start: 138.08, end: 139.12 },
        { text: "독재국가가", start: 139.12, end: 141.1 },
        { text: "되고", start: 141.1, end: 141.32 },
        { text: "있습니다.", start: 141.32, end: 141.76 },
      ],
    },
    {
      id: "segment-35",
      text: "이재명",
      start: 145.392,
      end: 147.092,
      speaker: "speaker-1",
      words: [{ text: "이재명", start: 145.392, end: 147.092 }],
    },
    {
      id: "segment-36",
      text: "독재 정권",
      start: 147.092,
      end: 149.492,
      speaker: "speaker-1",
      words: [
        { text: "독재", start: 147.092, end: 148.292 },
        { text: "정권", start: 148.292, end: 149.492 },
      ],
    },
    {
      id: "segment-37",
      text: "우리가 막아야 하지 않겠습니까",
      start: 149.492,
      end: 151.192,
      speaker: "speaker-1",
      words: [
        { text: "우리가", start: 149.492, end: 149.917 },
        { text: "막아야", start: 149.917, end: 150.342 },
        { text: "하지", start: 150.342, end: 150.767 },
        { text: "않겠습니까", start: 150.767, end: 151.192 },
      ],
    },
  ]

  const automatic = snapSourceRangeToCompleteUtterance(
    83.54,
    141.8,
    latestTranscript
  )
  assert.equal(automatic.end, 151.192)

  const locked = snapSourceRangeToCompleteUtterance(
    83.54,
    141.8,
    latestTranscript,
    { minimumStart: 83.54, maximumEnd: 141.8 }
  )
  assert.deepEqual(locked, { start: 83.54, end: 141.8 })
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
