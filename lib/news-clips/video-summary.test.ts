import assert from "node:assert/strict"
import test from "node:test"

import { normalizeAngleOptions } from "./angles.ts"
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
    generateText: async () => {
      calls += 1
      if (calls === 1) {
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
      return JSON.stringify({
        overallSummary:
          "영상은 정책의 추진 배경을 설명하고 예산 부족과 현장 피해를 짚어 본다. 이후 법적 모순과 책임 공방, 후속 조치까지 이어진다.",
        topics: [
          summaryTopic("topic-1", "정책의 시작과 모순", 1, 4),
          summaryTopic("topic-2", "예산 부족과 책임", 2, 5),
          summaryTopic("topic-3", "현장 피해와 후속 조치", 3, 6),
        ],
      })
    },
  })

  assert.equal(calls, 2)
  assert.equal(plan.topics.length, 3)
  assert.ok(plan.topics.every((topic) => topic.sourceRanges.length === 2))
  assert.ok(plan.topics.every((topic) => topic.assemblyPreview.length > 0))
  assert.equal(videoSummaryPlanIsComplete(plan), true)
})

test("짧은 영상은 모델 JSON이 깨져도 실제 전사로 3개 요약 후보를 복구한다", async () => {
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

  assert.equal(calls, 2)
  assert.ok(plan.topics.length >= 3 && plan.topics.length <= 5)
  assert.ok(plan.topics.every((topic) => topic.sourceRanges.length >= 2))
  assert.ok(
    plan.topics.every((topic) =>
      topic.sourceRanges.every((range) => range.evidence.length > 0)
    )
  )
  assert.equal(videoSummaryPlanIsComplete(plan), true)
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

  assert.ok(plan.topics.length >= 3 && plan.topics.length <= 5)
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
  secondMoment: number
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
