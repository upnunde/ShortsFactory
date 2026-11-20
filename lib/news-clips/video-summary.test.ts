import assert from "node:assert/strict"
import test from "node:test"

import { normalizeAngleOptions } from "./angles.ts"
import { NEWS_SOURCE_ASSEMBLY_MAX_RANGES } from "./source-assembly.ts"
import { serializeTranscript } from "./transcript.ts"
import type { TranscriptSegment } from "./types.ts"
import {
  buildVideoSummaryTranscriptChunks,
  normalizeVideoSummaryPlan,
  videoSummaryPlanIsComplete,
  videoSummaryPlanToAngleOptions,
} from "./video-summary.ts"
import { extractVideoSummaryPlan } from "../server/news-clips/video-summary.ts"

const transcript = [
  makeSegment(
    "segment-1",
    0,
    "정부는 첫 번째 정책의 추진 배경을 설명했습니다."
  ),
  makeSegment(
    "segment-2",
    3,
    "정책 추진 과정에서 예산 부족 문제가 확인됐습니다."
  ),
  makeSegment(
    "segment-3",
    6,
    "지방 자치단체는 현장의 실제 피해를 공개했습니다."
  ),
  makeSegment(
    "segment-4",
    9,
    "전문가는 정책의 법적 모순을 구체적으로 지적했습니다."
  ),
  makeSegment(
    "segment-5",
    12,
    "국회 토론에서는 책임 주체를 둘러싼 공방이 이어졌습니다."
  ),
  makeSegment(
    "segment-6",
    15,
    "마지막으로 후속 조치와 향후 일정이 발표됐습니다."
  ),
] satisfies TranscriptSegment[]

test("영상 요약 후보는 복수 구간을 실제 단어 타임코드로 잠그다", () => {
  const plan = normalizeVideoSummaryPlan(rawPlan(), transcript, {
    sourceId: "source-1",
  })

  assert.equal(plan.overallSummary.includes("정책"), true)
  assert.equal(plan.topics.length, 3)
  assert.equal(plan.topics[0]?.sourceRanges.length, 2)
  assert.equal(plan.topics[0]?.sourceRanges[0]?.sourceStart, 0.1)
  assert.equal(plan.topics[0]?.sourceRanges[0]?.sourceEnd, 1.7)
  assert.equal(plan.topics[0]?.sourceRanges[0]?.evidence, transcript[0]?.text)
  assert.equal(
    plan.topics[0]?.sourceRanges[0]?.evidence.includes("모델이 만든 근거"),
    false
  )
  assert.equal(
    plan.topics[0]?.assemblyPreview,
    `${transcript[0]?.text}\n\n${transcript[3]?.text}`
  )
  assert.equal(plan.topics[0]?.estimatedDurationSeconds, 3.2)
  assert.equal(videoSummaryPlanIsComplete(plan), true)
})

test("영상 요약 계획은 서로 다른 후보를 최대 10개까지 보존한다", () => {
  const plan = normalizeVideoSummaryPlan(
    {
      overallSummary:
        "영상은 정책 추진 과정에서 확인된 서로 다른 핵심 논점을 전체 흐름에 따라 설명한다.",
      topics: Array.from({ length: 10 }, (_, index) =>
        rawTopic(`topic-${index + 1}`, `서로 다른 핵심 논점 ${index + 1}`, [
          index % 3,
          (index % 3) + 3,
        ])
      ),
    },
    transcript,
    { sourceId: "ten-topic-source", minTopics: 1, maxTopics: 10 }
  )

  assert.equal(plan.topics.length, 10)
})

test("영상 요약 전사 청크는 긴 원본의 뒷부분까지 누락하지 않는다", () => {
  const chunks = buildVideoSummaryTranscriptChunks(transcript, 100)
  assert.ok(chunks.length > 1)
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.segments.map((segment) => segment.id)),
    transcript.map((segment) => segment.id)
  )
  assert.equal(chunks[0]?.sourceStart, 0.1)
  assert.equal(chunks.at(-1)?.sourceEnd, 16.7)
})

test("요약 계획을 기존 각도 선택 모델의 ranges로 손실 없이 전환한다", () => {
  const plan = normalizeVideoSummaryPlan(rawPlan(), transcript, {
    sourceId: "source-1",
  })
  const angles = videoSummaryPlanToAngleOptions(plan)
  const restored = normalizeAngleOptions(angles)

  assert.equal(restored.length, 3)
  assert.equal(restored[0]?.ranges?.length, 2)
  assert.equal(restored[0]?.ranges?.[0]?.evidence, transcript[0]?.text)
  assert.equal(restored[0]?.estimatedDurationSeconds, 3.2)
  assert.equal(restored[0]?.sourceStart, 0.1)
  assert.equal(restored[0]?.sourceEnd, 10.7)
})

test("한국어 전체 요약과 3개 후보를 청크 분석 후 복수 구간으로 조립한다", async () => {
  let calls = 0
  const plan = await extractVideoSummaryPlan(serializeTranscript(transcript), {
    sourceId: "source-1",
    sourceTitle: "정책 토론 전체 영상",
    generateText: async (system, user, maxTokens) => {
      calls += 1
      if (calls === 1) {
        assert.match(system, /sourceTitle은 원본 영상이 내세운 핵심 논점/)
        assert.match(system, /6~20초/)
        assert.match(system, /큰 구간 하나로 묶지 마라/)
        assert.match(system, /빈 구간으로 남긴다/)
        assert.match(user, /"sourceTitle":"정책 토론 전체 영상"/)
        return JSON.stringify({
          summary: "정책 추진 배경부터 후속 조치까지 설명한다.",
          moments: transcript.map((segment, index) => ({
            title: `핵심 발언 ${index + 1}`,
            summary: segment.text,
            keywords: ["정책", "근거"],
            sourceStart: segment.start,
            sourceEnd: segment.end,
          })),
        })
      }
      assert.match(system, /영상 전체의 내용 지도/)
      assert.match(system, /sourceTitle은 원본 영상 제작자가 내세운 핵심 논점/)
      assert.match(system, /hook.*context.*evidence.*conclusion/)
      assert.match(system, /topic\.summary는 2~3문장/)
      assert.match(system, /채워야 할 목표가 아니라 소프트 상한 가이드/)
      assert.match(system, /120초를 넘기는 것은.*주장이 왜곡되거나/)
      assert.doesNotMatch(system, /120초를 넘기지 않는다/)
      assert.match(system, /sourceRanges는 서로 연속일 필요가 없다/)
      assert.match(system, /반복·부연·전환부는 range 사이의 제외 구간/)
      assert.match(system, /명확한 주장 하나/)
      assert.match(system, /결정적 근거 1~3개/)
      assert.match(system, /20~40초만으로.*즉시 끝내고/)
      assert.match(
        system,
        /시간을 채우려고 관련성이 약한 moment를 추가하지 마라/
      )
      assert.match(
        user,
        /"evidence":"정부는 첫 번째 정책의 추진 배경을 설명했습니다\."/
      )
      assert.match(user, /"sourceTitle":"정책 토론 전체 영상"/)
      assert.equal(maxTokens, 5000)
      return JSON.stringify({
        overallSummary:
          "영상은 정책의 추진 배경을 설명하고 예산 부족과 현장 피해를 짚어 본다. 이후 법적 모순과 책임 공방, 후속 조치까지 이어진다.",
        topics: [
          summaryTopic("topic-1", "정책의 시작과 모순", 1, 2, 4),
          summaryTopic("topic-2", "예산 부족과 책임", 2, 3, 5),
          summaryTopic("topic-3", "현장 피해와 후속 조치", 3, 4, 6),
        ],
      })
    },
  })

  assert.equal(calls, 2)
  assert.equal(plan.topics.length, 3)
  assert.ok(plan.topics.every((topic) => topic.sourceRanges.length === 3))
  assert.ok(plan.topics.every((topic) => topic.summary.length >= 90))
  assert.ok(plan.topics.every((topic) => topic.assemblyPreview.length > 0))
  assert.equal(videoSummaryPlanIsComplete(plan), true)
})

test("독립된 핵심 논점이 하나뿐이면 후보 하나만 유지한다", async () => {
  let calls = 0
  const plan = await extractVideoSummaryPlan(serializeTranscript(transcript), {
    sourceId: "single-topic-source",
    generateText: async () => {
      calls += 1
      if (calls === 1) {
        return JSON.stringify({
          summary: "영상 전체가 하나의 정책 모순을 설명한다.",
          moments: transcript.map((segment, index) => ({
            title: `정책 모순 근거 ${index + 1}`,
            summary: segment.text,
            keywords: ["정책", "모순"],
            sourceStart: segment.start,
            sourceEnd: segment.end,
          })),
        })
      }
      return JSON.stringify({
        overallSummary:
          "영상은 하나의 정책 모순을 중심으로 추진 배경과 현장 근거, 이후 조치까지 설명한다.",
        topics: [
          summaryTopic("single-topic", "정책 모순의 전체 흐름", 1, 3, 6),
        ],
      })
    },
  })

  assert.equal(calls, 2)
  assert.equal(plan.topics.length, 1)
  assert.equal(videoSummaryPlanIsComplete(plan), true)
})

test("짧은 영상은 모델 JSON이 깨져도 실제 전사로 유효한 요약 후보를 복구한다", async () => {
  const shortTranscript = transcript.slice(0, 4)
  let calls = 0
  const plan = await extractVideoSummaryPlan(
    serializeTranscript(shortTranscript),
    {
      sourceId: "short-source",
      sourceTitle: "짧은 정책 영상",
      generateText: async () => {
        calls += 1
        return "JSON이 아닌 일시적인 응답"
      },
    }
  )

  assert.equal(calls, 3)
  assert.ok(plan.topics.length >= 1 && plan.topics.length <= 10)
  assert.ok(plan.topics.every((topic) => topic.sourceRanges.length >= 2))
  assert.ok(
    plan.topics.every((topic) =>
      topic.sourceRanges.every((range) => range.evidence.length > 0)
    )
  )
  assert.equal(videoSummaryPlanIsComplete(plan), true)
})

test("축약 응답이 깨져도 목표 시간을 채우려고 약한 구간을 추가하지 않는다", async () => {
  const fallbackTranscript = Array.from({ length: 8 }, (_, index) =>
    makeLongSegment(
      `fallback-segment-${index + 1}`,
      index * 12,
      `${index + 1}번째 발언은 선택 강도를 검증하기 위한 원본 문장입니다.`
    )
  )
  const scores = [99, 5, 97, 4, 3, 96, 2, 1]
  let calls = 0
  const plan = await extractVideoSummaryPlan(
    serializeTranscript(fallbackTranscript),
    {
      sourceId: "strong-fallback-source",
      targetDurationSeconds: 120,
      generateText: async () => {
        calls += 1
        if (calls > 1) return "깨진 축약 응답"
        return JSON.stringify({
          summary: "여러 발언 가운데 가장 직접적인 주장과 근거만 골라야 한다.",
          moments: fallbackTranscript.map((segment, index) => ({
            title: `후보 발언 ${index + 1}`,
            summary: segment.text,
            keywords: ["핵심", "근거"],
            sourceStart: segment.start,
            sourceEnd: segment.end,
            score: scores[index],
          })),
        })
      },
    }
  )

  assert.equal(calls, 3)
  assert.equal(plan.topics.length, 1)
  assert.equal(plan.topics[0]?.sourceRanges.length, 3)
  assert.deepEqual(
    plan.topics[0]?.sourceRanges.map((range) => range.transcriptSegmentIds[0]),
    ["fallback-segment-1", "fallback-segment-3", "fallback-segment-6"]
  )
})

test("발언 하나뿐인 짧은 영상도 가진 내용으로 요약 후보를 만든다", async () => {
  const shortTranscript = [
    makeSegment(
      "short-segment-1",
      0,
      "핵심은 예산이 늘었지만 현장 지원은 오히려 줄었다는 점입니다."
    ),
  ]
  const plan = await extractVideoSummaryPlan(
    serializeTranscript(shortTranscript),
    {
      sourceId: "very-short-source",
      sourceTitle: "짧은 핵심 발언",
      generateText: async () => "깨진 응답",
    }
  )

  assert.equal(plan.topics.length, 1)
  assert.equal(plan.topics[0]?.sourceRanges.length, 1)
  assert.equal(
    videoSummaryPlanIsComplete(plan, {
      minTopics: 1,
      minRangesPerTopic: 1,
    }),
    true
  )
})

test("1분 목표를 넘어도 필요한 핵심 구간은 2분 이상 모두 보존한다", () => {
  const longTranscript = Array.from({ length: 12 }, (_, index) =>
    makeLongSegment(
      `long-segment-${index + 1}`,
      index * 22,
      `${index + 1}번째 핵심 발언은 정책의 모순과 현장 피해 근거를 구체적으로 설명합니다. 이 설명은 전체 논점을 이해하기 위해 반드시 필요합니다.`,
      20
    )
  )
  const plan = normalizeVideoSummaryPlan(
    {
      overallSummary:
        "영상의 가장 중요한 정책 모순과 현장 피해 근거를 중심으로 정리한다.",
      topics: [
        {
          id: "one-minute-topic",
          title: "정책 모순의 핵심 근거",
          summary: "가장 강한 발언과 근거, 결론을 연결한 요약이다.",
          sourceRanges: longTranscript.map((segment, index) => ({
            id: `long-range-${index + 1}`,
            sourceStart: segment.start,
            sourceEnd: segment.end,
            role:
              index === 0
                ? "hook"
                : index === 1
                  ? "context"
                  : index === longTranscript.length - 1
                    ? "conclusion"
                    : "evidence",
          })),
        },
      ],
    },
    longTranscript,
    {
      sourceId: "long-source",
      minTopics: 1,
      minRangesPerTopic: 2,
      maxRangesPerTopic: NEWS_SOURCE_ASSEMBLY_MAX_RANGES,
      targetDurationSeconds: 53,
      maxDurationSeconds: 120,
    }
  )

  assert.equal(plan.topics.length, 1)
  assert.equal(plan.topics[0]!.sourceRanges.length, longTranscript.length)
  assert.ok(plan.topics[0]!.estimatedDurationSeconds > 120)
  assert.ok(plan.topics[0]!.sourceRanges.some((range) => range.role === "hook"))
  assert.ok(
    plan.topics[0]!.sourceRanges.some((range) => range.role === "context")
  )
  assert.ok(
    plan.topics[0]!.sourceRanges.some((range) => range.role === "conclusion")
  )
  const [angle] = videoSummaryPlanToAngleOptions(plan)
  assert.equal(angle?.coldOpen?.suitable, true)
  assert.ok(
    (angle?.coldOpen?.sourceEnd ?? 0) - (angle?.coldOpen?.sourceStart ?? 0) <= 7
  )
  const [normalizedAngle] = normalizeAngleOptions([angle])
  assert.equal(normalizedAngle?.ranges?.length, longTranscript.length)
})

test("겹친 구간만 반환한 불완전한 주제는 떨어진 실제 발언 조합으로 보충한다", async () => {
  let calls = 0
  const plan = await extractVideoSummaryPlan(serializeTranscript(transcript), {
    sourceId: "source-overlap",
    generateText: async () => {
      calls += 1
      if (calls === 1) {
        return JSON.stringify({
          summary: "정책 논쟁의 전체 흐름을 정리한다.",
          moments: transcript.map((segment, index) => ({
            title: `실제 발언 ${index + 1}`,
            summary: segment.text,
            sourceStart: segment.start,
            sourceEnd: segment.end,
          })),
        })
      }
      return JSON.stringify({
        overallSummary:
          "영상은 정책 추진 배경과 예산 문제, 현장 피해와 후속 조치를 다룬다.",
        topics: [
          {
            id: "broken-topic",
            title: "겹친 정책 구간",
            summary: "같은 구간만 중복 지정한 불완전한 후보다.",
            sourceRanges: [
              { rangeId: "summary-chunk-1-moment-1" },
              { rangeId: "summary-chunk-1-moment-1" },
            ],
          },
        ],
      })
    },
  })

  assert.ok(plan.topics.length >= 1 && plan.topics.length <= 10)
  assert.ok(plan.topics.every((topic) => topic.sourceRanges.length >= 2))
  assert.equal(videoSummaryPlanIsComplete(plan), true)
})

function rawPlan() {
  return {
    overallSummary:
      "영상은 정책의 추진 배경과 예산 부족을 설명한다. 현장 피해와 법적 모순, 후속 조치도 함께 다룬다.",
    topics: [
      rawTopic("topic-1", "정책 배경과 법적 모순", [0, 3]),
      rawTopic("topic-2", "예산 부족과 책임 공방", [1, 4]),
      rawTopic("topic-3", "현장 피해와 후속 조치", [2, 5]),
      {
        id: "english-topic",
        title: "English only title",
        summary: "This candidate must not be selected.",
        sourceRanges: [rangeFor(0), rangeFor(3)],
      },
    ],
  }
}

function rawTopic(id: string, title: string, segmentIndexes: number[]) {
  return {
    id,
    title,
    summary: `${title}을 실제 발언 구간으로 정리한 후보다.`,
    keywords: ["정책", "근거"],
    sourceRanges: segmentIndexes.map(rangeFor),
  }
}

function rangeFor(segmentIndex: number) {
  const segment = transcript[segmentIndex]!
  return {
    id: `raw-range-${segmentIndex + 1}`,
    label: `핵심 구간 ${segmentIndex + 1}`,
    summary: segment.text,
    evidence: "모델이 만든 근거는 저장하지 않는다.",
    sourceStart: segment.start + 0.2,
    sourceEnd: segment.start + 1.2,
  }
}

function summaryTopic(
  id: string,
  title: string,
  firstMoment: number,
  secondMoment: number,
  thirdMoment: number
) {
  return {
    id,
    title,
    summary: `${title}을 복수 구간으로 조립한 후보다.`,
    keywords: ["정책", "근거"],
    sourceRanges: [
      {
        rangeId: `summary-chunk-1-moment-${firstMoment}`,
        role: "hook",
      },
      {
        rangeId: `summary-chunk-1-moment-${secondMoment}`,
        role: "evidence",
      },
      {
        rangeId: `summary-chunk-1-moment-${thirdMoment}`,
        role: "conclusion",
      },
    ],
  }
}

function makeSegment(
  id: string,
  start: number,
  text: string
): TranscriptSegment {
  const words = text.split(/\s+/)
  const duration = 1.6 / words.length
  return {
    id,
    text,
    start,
    end: start + 2,
    speaker: "speaker-1",
    words: words.map((word, index) => ({
      text: word,
      start: Math.round((start + 0.1 + duration * index) * 1000) / 1000,
      end: Math.round((start + 0.1 + duration * (index + 1)) * 1000) / 1000,
    })),
  }
}

function makeLongSegment(
  id: string,
  start: number,
  text: string,
  durationSeconds = 10
): TranscriptSegment {
  const words = text.split(/\s+/)
  const duration = (durationSeconds - 0.2) / words.length
  return {
    id,
    text,
    start,
    end: start + durationSeconds,
    speaker: "speaker-1",
    words: words.map((word, index) => ({
      text: word,
      start: Math.round((start + 0.1 + duration * index) * 1000) / 1000,
      end: Math.round((start + 0.1 + duration * (index + 1)) * 1000) / 1000,
    })),
  }
}
