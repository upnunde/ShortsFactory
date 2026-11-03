import assert from "node:assert/strict"
import test from "node:test"

import {
  constrainAiVideoUsage,
  normalizeProductionMode,
  productionUsage,
} from "./scene-production.ts"

test("기존 씬은 화면 종류에 맞는 로컬 제작 방식으로 보완한다", () => {
  assert.equal(normalizeProductionMode(undefined, "room"), "character_motion")
  assert.equal(normalizeProductionMode(undefined, "insert"), "graphic_motion")
})

test("AI 영상 사용량을 씬 수와 생성 초로 계산한다", () => {
  assert.deepEqual(
    productionUsage([
      { scriptTarget: "one two three", productionMode: "ai_video" },
      { scriptTarget: "one two", productionMode: "still_motion" },
    ]),
    { aiSceneCount: 1, aiSeconds: 4 }
  )
})

test("AI 영상 상한을 넘는 씬은 로컬 모션으로 내린다", () => {
  const scenes = constrainAiVideoUsage(
    [
      {
        shot: "room" as const,
        scriptTarget: "one two three",
        productionMode: "ai_video" as const,
      },
      {
        shot: "insert" as const,
        scriptTarget: "one two three",
        productionMode: "ai_video" as const,
      },
    ],
    1,
    8
  )

  assert.deepEqual(
    scenes.map((scene) => scene.productionMode),
    ["ai_video", "graphic_motion"]
  )
})
