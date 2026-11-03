import assert from "node:assert/strict"
import test from "node:test"

import { directionReady, narrationSignature } from "./scene-status.ts"
import type { Project, Scene } from "./types.ts"

const scenes: Scene[] = [
  {
    id: "scene-01",
    scriptKo: "질문이에요?",
    approvedKo: "질문이에요?",
    scriptTarget: "Is this the question?",
    subtitle: "Is this the question?",
    shot: "room",
    productionMode: "character_motion",
    sceneDescription: "looks at the camera",
    visualDescription: "",
    voiceScript: "",
    actionBeats: [],
    castIds: [],
  },
]

test("연출은 확정 대본과 TTS 버전에만 유효하다", () => {
  const voicePreviewKey = "voice-a"
  const project = {
    scenes,
    voicePreviewKey,
    directionSignature: narrationSignature(scenes, voicePreviewKey),
  } as Project

  assert.equal(directionReady(project), true)
  assert.equal(
    directionReady({
      ...project,
      scenes: scenes.map((scene, index) =>
        index === 0 ? { ...scene, scriptKo: `${scene.scriptKo} 수정` } : scene
      ),
    }),
    false
  )
  assert.equal(directionReady({ ...project, voicePreviewKey: "voice-b" }), false)
})
