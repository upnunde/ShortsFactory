import assert from "node:assert/strict"
import test from "node:test"

import { prepareRenderProject } from "./prepare-render-project.ts"
import { buildSourceAssemblyPlan } from "./source-assembly.ts"
import {
  defaultNewsClipSettings,
  freshNewsClipProject,
  type TranscriptSegment,
} from "./types.ts"

const transcript = [
  segment("segment-1", 0, 4, "첫 번째 핵심 발언은 정책의 시작을 설명한다."),
  segment("segment-2", 4, 8, "이 구간은 요약 영상에서 사용하지 않는다."),
  segment("segment-3", 8, 12, "이 설명도 핵심 근거와 직접 관련이 없다."),
  segment("segment-4", 12, 16, "두 번째 핵심 발언은 예산 문제를 지적한다."),
  segment("segment-5", 16, 22, "중간 토론은 요약 영상에서 제외한다."),
  segment("segment-6", 22, 28, "반복 설명 역시 선택 구간에서 제외한다."),
  segment("segment-7", 28, 32, "마지막 핵심 발언은 책임 소재를 결론 낸다."),
] satisfies TranscriptSegment[]

test("영상 요약형의 떨어진 핵심 구간은 분석 결과부터 렌더 직전까지 같은 순서와 시간축을 유지한다", () => {
  const selectedRanges = [
    { start: 28, end: 32 },
    { start: 0, end: 4 },
    { start: 12, end: 16 },
  ]
  const analysis = buildSourceAssemblyPlan(selectedRanges)

  const expectedRanges = [
    { sourceStart: 0, sourceEnd: 4, outputStart: 0, outputEnd: 4 },
    { sourceStart: 12, sourceEnd: 16, outputStart: 4, outputEnd: 8 },
    { sourceStart: 28, sourceEnd: 32, outputStart: 8, outputEnd: 12 },
  ]
  assert.deepEqual(analysis.keepRanges, expectedRanges)
  assert.deepEqual(
    analysis.removedRanges.map(({ start, end }) => ({ start, end })),
    [
      { start: 4, end: 12 },
      { start: 16, end: 28 },
    ]
  )
  assert.deepEqual(
    analysis.ranges,
    expectedRanges.map(({ sourceStart: start, sourceEnd: end }) => ({
      start,
      end,
    }))
  )
  assert.equal(analysis.duration, 12)

  const base = freshNewsClipProject("news-channel-30cfb65e")
  const selectedAngle = {
    id: "summary-topic-1",
    title: "정책 책임 요약",
    summary: "세 핵심 발언을 원본 순서로 조립한다.",
    keywords: ["정책", "예산", "책임"],
    evidence: "선택한 세 발언",
    sourceStart: 0,
    sourceEnd: 32,
    ranges: expectedRanges.map((range, index) => ({
      id: `range-${index + 1}`,
      label: `핵심 ${index + 1}`,
      summary: `핵심 ${index + 1}`,
      evidence: transcript[index === 0 ? 0 : index === 1 ? 3 : 6]!.text,
      sourceStart: range.sourceStart,
      sourceEnd: range.sourceEnd,
    })),
    estimatedDurationSeconds: 12,
  }
  const prepared = prepareRenderProject(
    {
      ...base,
      productionMode: "buildup2",
      sourceSelectionMode: "video-summary",
      source: {
        id: "source-1",
        kind: "youtube",
        title: "전체 토론 영상",
        channel: "테스트 채널",
        publishedAt: "",
        durationSeconds: 32,
        viewCount: 0,
        originalUrl: "https://example.com/watch?v=source-1",
        summary: "",
        localFile: "/tmp/source-1.mp4",
        approved: true,
        requiresUpload: false,
        commentCount: 0,
        searchMetrics: null,
      },
      transcript,
      title: "정책 논란\n책임은 누구에게",
      titleOptions: ["정책 논란\n책임은 누구에게"],
      angleOptions: [selectedAngle],
      selectedAngleId: selectedAngle.id,
      candidates: [
        {
          id: "candidate-1",
          sourceStart: 0,
          sourceEnd: 32,
          estimatedFinalSeconds: analysis.duration,
          reason: "선택한 요약 구간",
          preview: "정책의 시작과 예산, 책임 소재를 요약한다.",
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
          titleOptions: ["정책 책임 요약"],
        },
      ],
      selectedCandidateId: "candidate-1",
      reportScript:
        "세 발언을 순서대로 들어봐.\n어떻게 생각해?\n댓글로 남겨줘.",
      reportScenes: [
        {
          id: "buildup2-lead",
          narration: "세 발언을 순서대로 들어봐.",
          visual: "source",
          sourceId: "source-1",
          sourceStart: 0,
          sourceEnd: 3,
        },
        ...analysis.ranges.map((range, index) => ({
          id: `buildup2-quote-cut-${index + 1}`,
          narration: "",
          part: "body" as const,
          audioMode: "original" as const,
          visualMode: "quote" as const,
          visual: "quote" as const,
          sourceId: "source-1",
          sourceStart: range.start,
          sourceEnd: range.end,
        })),
        {
          id: "end-cta",
          narration: "어떻게 생각해?\n댓글로 남겨줘.",
          visual: "source",
          sourceId: "source-1",
          sourceStart: 28,
          sourceEnd: 32,
        },
      ],
      removedRanges: analysis.removedRanges,
      keepRanges: analysis.keepRanges,
      subtitles: [],
      subtitleTimingsLocked: false,
    },
    defaultNewsClipSettings,
    { rebuildSubtitles: true }
  )

  assert.equal(prepared.reason, "")
  assert.deepEqual(prepared.project.keepRanges, expectedRanges)
  assert.deepEqual(
    prepared.project.reportScenes
      .filter((scene) => scene.id.startsWith("buildup2-quote-cut-"))
      .map(({ sourceStart, sourceEnd }) => ({ sourceStart, sourceEnd })),
    expectedRanges.map(({ sourceStart, sourceEnd }) => ({
      sourceStart,
      sourceEnd,
    }))
  )
  assert.equal(
    prepared.project.reportScenes.some(
      (scene) => scene.id === "buildup2-quote"
    ),
    false
  )
})

function segment(id: string, start: number, end: number, text: string) {
  return {
    id,
    start,
    end,
    text,
    speaker: "speaker-1",
    words: [],
  }
}
