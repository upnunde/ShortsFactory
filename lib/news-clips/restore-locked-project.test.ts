import assert from "node:assert/strict"
import test from "node:test"

import { prepareRenderProject } from "./prepare-render-project.ts"
import { restoreLockedEditorialSnapshot } from "./restore-locked-project.ts"
import {
  defaultNewsClipSettings,
  freshNewsClipProject,
  type NewsReportScene,
  type SubtitleCue,
} from "./types.ts"

test("잠긴 빌드업형은 새로고침 후에도 quote-cut·크롭·자막 계약을 유지한다", () => {
  const base = freshNewsClipProject("news-channel-30cfb65e")
  const reportScenes: NewsReportScene[] = [
    {
      id: "buildup2-lead",
      narration: "직접 들어봐.",
      visual: "source",
      sourceId: "source-1",
      sourceStart: 10,
      sourceEnd: 13,
    },
    {
      id: "buildup2-quote-cut-1",
      narration: "",
      visual: "quote",
      sourceId: "source-1",
      sourceStart: 10,
      sourceEnd: 14,
      crop: { x: 20, y: 30, zoom: 1.2, faceTracking: false },
    },
    {
      id: "buildup2-quote-cut-2",
      narration: "",
      visual: "quote",
      sourceId: "source-1",
      sourceStart: 15,
      sourceEnd: 19,
      crop: { x: 80, y: 70, zoom: 1.6, faceTracking: false },
    },
    {
      id: "end-cta",
      narration: "어떻게 생각해?\n댓글로 남겨줘.",
      visual: "source",
      sourceId: "source-1",
      sourceStart: 16,
      sourceEnd: 19,
    },
  ]
  const subtitles: SubtitleCue[] = [
    {
      id: "locked-manual-caption",
      sceneId: "buildup2-quote-cut-1",
      start: 2,
      end: 8,
      text: "사용자가 직접 고친 아주 긴 자막 문구가\n새로고침 뒤에도 한 구간으로 남아야 한다",
      emphasis: ["사용자"],
      emphasisColor: "yellow",
      edited: true,
    },
  ]
  const saved = {
    ...base,
    productionMode: "buildup2" as const,
    source: {
      id: "source-1",
      kind: "upload" as const,
      title: "원본",
      channel: "채널",
      publishedAt: "",
      durationSeconds: 200,
      viewCount: 0,
      commentCount: 0,
      originalUrl: "",
      summary: "",
      localFile: "/tmp/source.mp4",
      approved: true,
      requiresUpload: false,
      searchMetrics: null,
    },
    title: "잠긴 시간표\n복원 테스트",
    reportScript: "직접 들어봐.\n어떻게 생각해?\n댓글로 남겨줘.",
    transcript: [
      {
        id: "word-timeline",
        text: "확정한 원본 발언",
        start: 10,
        end: 19,
        speaker: "speaker-1",
        words: [
          { text: "확정한", start: 10, end: 13, speaker: "speaker-1" },
          {
            text: "원본 발언",
            start: 13,
            end: 19,
            speaker: "speaker-1",
          },
        ],
      },
    ],
    reportScenes,
    subtitles,
    subtitleTimingsLocked: true,
  }
  const restored = restoreLockedEditorialSnapshot(saved)

  assert.ok(restored)
  const prepared = prepareRenderProject(
    {
      ...saved,
      reportScenes: restored.reportScenes,
      subtitles: restored.subtitles,
    },
    defaultNewsClipSettings,
    { lockTimeline: true }
  )

  assert.equal(prepared.reason, "")
  assert.deepEqual(
    prepared.project.reportScenes.map(
      ({ id, sourceStart, sourceEnd, crop }) => ({
        id,
        sourceStart,
        sourceEnd,
        crop,
      })
    ),
    reportScenes.map(({ id, sourceStart, sourceEnd, crop }) => ({
      id,
      sourceStart,
      sourceEnd,
      crop,
    }))
  )
  assert.deepEqual(
    prepared.project.subtitles.map(({ id, text, start, end }) => ({
      id,
      text,
      start,
      end,
    })),
    subtitles.map(({ id, text, start, end }) => ({ id, text, start, end }))
  )
})
