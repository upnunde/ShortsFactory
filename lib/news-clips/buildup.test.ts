import assert from "node:assert/strict"
import test from "node:test"

import {
  buildBuildup2Scenes,
  collapseBuildup2HighlightCuts,
  densifySourceKeeps,
  expandScenesWithSilenceCuts,
  keepRangesInside,
  localBuildup2Draft,
} from "./buildup.ts"
import type { NewsReportScene, TranscriptSegment } from "./types.ts"

const reviewedDateTranscript: TranscriptSegment[] = [
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

const lockedEndTranscript: TranscriptSegment[] = [
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

test("무음 구간을 제외한 keep 구간을 만든다", () => {
  const keeps = keepRangesInside(
    10,
    20,
    [
      { id: "s1", start: 12, end: 14, reason: "silence", restored: false },
      { id: "s2", start: 16.2, end: 16.4, reason: "silence", restored: false },
    ],
    0.35
  )
  assert.deepEqual(keeps, [
    { start: 10, end: 12 },
    { start: 14, end: 20 },
  ])
})

test("원본 음성 quote는 무음 기준으로 장면을 쪼개지 않는다", () => {
  const scenes = expandScenesWithSilenceCuts(
    [
      {
        id: "buildup2-quote",
        narration: "원본 발언",
        visual: "quote",
        sourceStart: 10,
        sourceEnd: 20,
      },
    ],
    [{ id: "s1", start: 12, end: 15, reason: "silence", restored: false }]
  )
  assert.equal(scenes.length, 1)
  assert.equal(scenes[0]?.id, "buildup2-quote")
  assert.equal(scenes[0]?.sourceStart, 10)
  assert.equal(scenes[0]?.sourceEnd, 20)
})

test("확정한 날짜 시작점은 이전 목격했습니다 구간으로 앞당겨지지 않는다", () => {
  const lockedStart = 70.62
  const scenes = buildBuildup2Scenes(
    "법치주의가 사망했다고 말했어.",
    lockedStart,
    81.02,
    reviewedDateTranscript,
    "source-1",
    undefined,
    { startFloor: lockedStart }
  )
  const quote = scenes.find((scene) => scene.id === "buildup2-quote")

  assert.equal(quote?.sourceStart, lockedStart)
  assert.equal(quote?.sourceEnd, 81.02)
  assert.ok((quote?.sourceStart ?? 0) > 68.4)

  // 클라이언트가 검수 자막으로 장면을 다시 구성해도 preferred quote가
  // 동일한 시작 하한이 되어 이전 문장으로 되돌아가지 않는다.
  const rebuilt = buildBuildup2Scenes(
    "법치주의가 사망했다고 말했어.",
    lockedStart,
    81.02,
    reviewedDateTranscript,
    "source-1",
    scenes
  )
  assert.equal(
    rebuilt.find((scene) => scene.id === "buildup2-quote")?.sourceStart,
    lockedStart
  )

  const draft = localBuildup2Draft(
    reviewedDateTranscript,
    {
      id: "angle-locked",
      sourceStart: lockedStart,
      sourceEnd: 81.02,
      estimatedFinalSeconds: 10.4,
      reason: "주제고르기에서 확정한 구간",
      preview: "2026년 11월 6일 대한민국 법치주의가 사망했습니다.",
      contextRisk: "low",
      scores: {
        audienceFit: 80,
        timeliness: 80,
        hook: 80,
        specificity: 80,
        standalone: 80,
        contextIntegrity: 80,
        mediaQuality: 80,
        total: 80,
      },
      titleOptions: ["법치주의가\n사망했다"],
    },
    { titleCardSeconds: 2.8 },
    [],
    "source-1",
    { startFloor: lockedStart }
  )
  assert.equal(draft.keepRanges[0]?.sourceStart, lockedStart)
  assert.equal(
    draft.preferred.find((scene) => scene.id === "buildup2-quote")?.sourceStart,
    lockedStart
  )
})

test("저장된 하이라이트 범위가 뒤집혔으면 잠금 경계로 재사용하지 않는다", () => {
  const scenes = buildBuildup2Scenes(
    "법치주의가 사망했다고 말했어.",
    70.62,
    81.02,
    reviewedDateTranscript,
    "source-1",
    [
      {
        id: "buildup2-quote",
        narration: "",
        visual: "quote",
        sourceStart: 100,
        sourceEnd: 90,
      },
    ]
  )
  const quote = scenes.find((scene) => scene.id === "buildup2-quote")

  assert.deepEqual(
    { start: quote?.sourceStart, end: quote?.sourceEnd },
    { start: 70.62, end: 81.02 }
  )
})

test("수동으로 나눈 quote-cut은 대본을 저장해도 삭제한 공백을 유지한다", () => {
  const preferred: NewsReportScene[] = [
    {
      id: "buildup2-lead",
      narration: "서두",
      visual: "source",
      sourceStart: 70.62,
      sourceEnd: 73.62,
    },
    {
      id: "buildup2-quote-cut-1",
      narration: "",
      visual: "quote",
      sourceStart: 70.62,
      sourceEnd: 73.94,
    },
    {
      id: "buildup2-quote-cut-2",
      narration: "",
      visual: "quote",
      sourceStart: 78.76,
      sourceEnd: 81.02,
    },
  ]
  const rebuilt = buildBuildup2Scenes(
    "법치주의가 사망했다고 말했어.",
    70.62,
    81.02,
    reviewedDateTranscript,
    "source-1",
    preferred
  )

  assert.deepEqual(
    rebuilt
      .filter((scene) => scene.id.startsWith("buildup2-quote"))
      .map(({ id, sourceStart, sourceEnd }) => ({
        id,
        sourceStart,
        sourceEnd,
      })),
    [
      { id: "buildup2-quote-cut-1", sourceStart: 70.62, sourceEnd: 73.94 },
      { id: "buildup2-quote-cut-2", sourceStart: 78.76, sourceEnd: 81.02 },
    ]
  )
})

test("확정한 전체 내용 끝은 다음 발언까지 늘어나지 않는다", () => {
  const lockedStart = 83.54
  const lockedEnd = 141.8
  const automatic = buildBuildup2Scenes(
    "탈옥법이라는 말이 나왔어.",
    lockedStart,
    lockedEnd,
    lockedEndTranscript,
    "source-1"
  ).find((scene) => scene.id === "buildup2-quote")
  assert.equal(automatic?.sourceEnd, 151.19)

  const locked = buildBuildup2Scenes(
    "탈옥법이라는 말이 나왔어.",
    lockedStart,
    lockedEnd,
    lockedEndTranscript,
    "source-1",
    undefined,
    { startFloor: lockedStart, endCeiling: lockedEnd }
  ).find((scene) => scene.id === "buildup2-quote")
  assert.equal(locked?.sourceStart, lockedStart)
  assert.equal(locked?.sourceEnd, lockedEnd)

  const draft = localBuildup2Draft(
    lockedEndTranscript,
    {
      id: "angle-locked",
      sourceStart: lockedStart,
      sourceEnd: lockedEnd,
      estimatedFinalSeconds: lockedEnd - lockedStart,
      reason: "주제고르기에서 확정한 구간",
      preview: "지금 대한민국이 독재국가가 되고 있습니다.",
      contextRisk: "low",
      scores: {
        audienceFit: 80,
        timeliness: 80,
        hook: 80,
        specificity: 80,
        standalone: 80,
        contextIntegrity: 80,
        mediaQuality: 80,
        total: 80,
      },
      titleOptions: ["탈옥법의\n정체"],
    },
    { titleCardSeconds: 2.8 },
    [],
    "source-1",
    { startFloor: lockedStart, endCeiling: lockedEnd }
  )
  assert.equal(draft.keepRanges[0]?.sourceStart, lockedStart)
  assert.equal(draft.keepRanges[0]?.sourceEnd, lockedEnd)
  assert.equal(
    draft.preferred.find((scene) => scene.id === "buildup2-quote")?.sourceEnd,
    lockedEnd
  )
})

test("자료 화면은 TTS 길이에 맞춰 무음을 건너뛴 keep을 모은다", () => {
  const packed = densifySourceKeeps(
    10,
    20,
    [{ id: "s1", start: 12, end: 15, reason: "silence", restored: false }],
    5,
    40
  )
  assert.deepEqual(packed, [
    { start: 10, end: 12 },
    { start: 15, end: 18 },
  ])
  const total = packed.reduce((sum, keep) => sum + keep.end - keep.start, 0)
  assert.ok(Math.abs(total - 5) < 0.01)
})

test("겹친 하이라이트 컷을 한 장면으로 합친다", () => {
  const collapsed = collapseBuildup2HighlightCuts([
    {
      id: "buildup2-lead",
      narration: "들어봐",
      visual: "source",
      sourceStart: 100,
      sourceEnd: 103,
    },
    {
      id: "buildup2-quote-cut-1",
      narration: "",
      visual: "quote",
      sourceStart: 100,
      sourceEnd: 105,
    },
    {
      id: "buildup2-quote-cut-2",
      narration: "",
      visual: "quote",
      sourceStart: 100,
      sourceEnd: 112,
    },
    {
      id: "end-cta",
      narration: "댓글",
      visual: "source",
      sourceStart: 100,
      sourceEnd: 102.5,
    },
  ])
  assert.equal(collapsed.length, 3)
  assert.equal(collapsed[1]?.id, "buildup2-quote")
  assert.equal(collapsed[1]?.sourceStart, 100)
  assert.equal(collapsed[1]?.sourceEnd, 112)
})
