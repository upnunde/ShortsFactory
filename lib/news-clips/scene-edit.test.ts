import assert from "node:assert/strict"
import test from "node:test"

import {
  clampSceneSourceRange,
  sceneAudioTimingChanged,
  sceneTimingChanged,
} from "./scene-edit.ts"
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

test("보도형 자료화면 변경은 TTS·자막 시간축을 유지한다", () => {
  const reportScene: NewsReportScene = {
    ...scene,
    narration: "승인된 보도 대본이야.",
    visual: "source",
    audioMode: "tts",
  }
  assert.equal(
    sceneAudioTimingChanged("report", reportScene, {
      sourceId: "source-2",
      sourceStart: 30,
      sourceEnd: 35,
    }),
    false
  )
  assert.equal(
    sceneAudioTimingChanged("report", reportScene, {
      narration: "대본을 바꿨어.",
    }),
    true
  )
})

test("빌드업형 원본 구간 변경은 원본 음성 시간축을 다시 만든다", () => {
  assert.equal(
    sceneAudioTimingChanged("buildup2", scene, { sourceStart: 13 }),
    true
  )
})

test("보도형 자료영상은 사용자가 고른 시작·종료 구간을 그대로 쓴다", () => {
  assert.deepEqual(
    clampSceneSourceRange({ sourceStart: 31.25, sourceEnd: 36.8 }, 120),
    { start: 31.25, end: 36.8 }
  )
})

test("자료영상 구간은 원본 길이 밖으로 벗어나지 않는다", () => {
  assert.deepEqual(
    clampSceneSourceRange({ sourceStart: 98, sourceEnd: 130 }, 100),
    { start: 98, end: 100 }
  )
  assert.deepEqual(
    clampSceneSourceRange({ sourceStart: 110, sourceEnd: 130 }, 100),
    { start: 99.9, end: 100 }
  )
})
