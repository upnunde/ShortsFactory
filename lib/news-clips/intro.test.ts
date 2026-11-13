import assert from "node:assert/strict"
import test from "node:test"

import { introStillTime, selectIntroStillRange } from "./intro.ts"
import { freshNewsClipProject } from "./types.ts"

test("직접 선택한 원본 시점을 인트로 스틸로 사용한다", () => {
  const project = {
    ...freshNewsClipProject("news-channel-test"),
    introStillTimeSeconds: 31.4,
  }
  const range = selectIntroStillRange(project)

  assert.equal(range.visual, "manual")
  assert.equal(introStillTime(range), 31.4)
})

test("직접 선택이 없으면 핵심 직접 발언 장면을 우선한다", () => {
  const project = {
    ...freshNewsClipProject("news-channel-test"),
    reportScenes: [
      {
        id: "source-scene",
        narration: "정부가 새 계획을 발표했습니다.",
        visual: "source" as const,
        sourceStart: 10,
        sourceEnd: 15,
      },
      {
        id: "quote-scene",
        narration: "당사자가 직접 밝힌 핵심 발언입니다.",
        visual: "quote" as const,
        sourceStart: 30,
        sourceEnd: 36,
      },
    ],
  }
  const range = selectIntroStillRange(project)

  assert.equal(range.sceneId, "quote-scene")
  assert.equal(introStillTime(range), 33)
})

test("첨부한 인트로 소스가 있으면 원본 장면보다 우선한다", () => {
  const project = {
    ...freshNewsClipProject("news-channel-test"),
    introSourceId: "uploaded-intro",
    supportingSources: [
      {
        id: "uploaded-intro",
        kind: "upload" as const,
        mediaType: "image" as const,
        title: "인트로 이미지",
        channel: "사용자 첨부",
        publishedAt: "",
        durationSeconds: 12,
        viewCount: 0,
        commentCount: 0,
        originalUrl: "",
        summary: "업로드한 이미지",
        localFile: "/tmp/intro.mp4",
        approved: true,
        requiresUpload: false,
        searchMetrics: null,
      },
    ],
  }
  const range = selectIntroStillRange(project)

  assert.equal(range.sourceId, "uploaded-intro")
  assert.equal(introStillTime(range), 6)
})
