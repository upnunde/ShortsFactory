import assert from "node:assert/strict"
import test from "node:test"

import { sceneTimingChanged } from "./scene-edit.ts"
import type { NewsReportScene } from "./types.ts"

const scene: NewsReportScene = {
  id: "quote-1",
  narration: "",
  visual: "quote",
  sourceId: "source-1",
  sourceStart: 12,
  sourceEnd: 18,
  crop: { x: 50, y: 50, zoom: 1.2, faceTracking: false },
}

test("확대·X·Y 크롭 변경은 잠긴 시간축을 해제하지 않는다", () => {
  assert.equal(
    sceneTimingChanged(scene, {
      crop: { x: 63, y: 41, zoom: 1.65, faceTracking: false },
      sourceStart: 12,
      sourceEnd: 18,
    }),
    false
  )
})

test("원본 구간·소스·화면 종류·나레이션 변경만 시간축 변경으로 본다", () => {
  assert.equal(sceneTimingChanged(scene, { sourceStart: 12.1 }), true)
  assert.equal(sceneTimingChanged(scene, { sourceEnd: 17.9 }), true)
  assert.equal(sceneTimingChanged(scene, { sourceId: "source-2" }), true)
  assert.equal(sceneTimingChanged(scene, { visual: "source" }), true)
  assert.equal(sceneTimingChanged(scene, { narration: "새 대본" }), true)
})
