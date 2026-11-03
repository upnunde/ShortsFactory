import assert from "node:assert/strict"
import test from "node:test"

import { normalizeVideoSettings } from "./video-settings.ts"

test("영상 설정은 3:4 비율을 강제하고 720p를 기본으로 쓴다", () => {
  const settings = normalizeVideoSettings({
    resolution: "bad",
    aspectRatio: "9:16",
  })

  assert.equal(settings.resolution, "720p")
  assert.equal(settings.aspectRatio, "3:4")
})

test("비용 설정은 음수가 되지 않는다", () => {
  const settings = normalizeVideoSettings({
    estimatedCostPerSecondUsd: -1,
    maxEstimatedCostUsd: 2.34567,
  })

  assert.equal(settings.estimatedCostPerSecondUsd, 0)
  assert.equal(settings.maxEstimatedCostUsd, 2.3457)
})

test("채널별 길이와 AI 영상 사용량은 안전한 범위로 정규화한다", () => {
  const settings = normalizeVideoSettings({
    targetDurationSeconds: 90,
    durationToleranceSeconds: -2,
    maxAiVideoSeconds: 999,
    maxAiVideoScenes: 2.6,
    maxRetriesPerScene: 99,
  })

  assert.equal(settings.targetDurationSeconds, 60)
  assert.equal(settings.durationToleranceSeconds, 0)
  assert.equal(settings.maxAiVideoSeconds, 30)
  assert.equal(settings.maxAiVideoScenes, 3)
  assert.equal(settings.maxRetriesPerScene, 5)
})
