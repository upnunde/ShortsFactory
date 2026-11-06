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
