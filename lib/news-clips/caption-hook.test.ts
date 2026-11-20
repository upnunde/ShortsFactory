import assert from "node:assert/strict"
import test from "node:test"

import {
  buildupHookDuration,
  buildupHookScenes,
  buildCaptionHookSelection,
  isBuildupHookScene,
  isCaptionHookDurationValid,
  removeBuildupHookScenes,
  replaceCaptionHookSubtitles,
} from "./caption-hook.ts"
import type { NewsReportScene, SubtitleCue } from "./types.ts"

function cue(
  id: string,
  text: string,
  sourceStart: number | undefined,
  sourceEnd: number | undefined
): SubtitleCue {
  return {
    id,
    sceneId: "buildup2-quote",
    start: sourceStart ?? 0,
    end: sourceEnd ?? 0,
    sourceStart,
    sourceEnd,
    text,
    emphasis: [],
    emphasisColor: "yellow",
  }
}

test("선택한 자막만 복수 원본 훅 장면과 자막으로 복사한다", () => {
  const result = buildCaptionHookSelection(
    [
      cue("body-18", "열여덟 번째", 10, 11),
      cue("body-19", "열아홉 번째", 11.05, 12.1),
      cue("body-20", "스무 번째", 20, 21),
    ],
    "source-1"
  )

  assert.deepEqual(
    result.scenes.map((scene) => ({
      id: scene.id,
      start: scene.sourceStart,
      end: scene.sourceEnd,
      part: scene.part,
      audioMode: scene.audioMode,
    })),
    [
      {
        id: "buildup2-hook-selection-1",
        start: 10,
        end: 12.1,
        part: "hook",
        audioMode: "original",
      },
      {
        id: "buildup2-hook-selection-2",
        start: 20,
        end: 21,
        part: "hook",
        audioMode: "original",
      },
    ]
  )
  assert.deepEqual(
    result.subtitles.map((subtitle) => ({
      sceneId: subtitle.sceneId,
      start: subtitle.start,
      end: subtitle.end,
      text: subtitle.text,
      sourceStart: subtitle.sourceStart,
      sourceEnd: subtitle.sourceEnd,
    })),
    [
      {
        sceneId: "buildup2-hook-selection-1",
        start: 0,
        end: 1,
        text: "열여덟 번째",
        sourceStart: 10,
        sourceEnd: 11,
      },
      {
        sceneId: "buildup2-hook-selection-1",
        start: 1.05,
        end: 2.1,
        text: "열아홉 번째",
        sourceStart: 11.05,
        sourceEnd: 12.1,
      },
      {
        sceneId: "buildup2-hook-selection-2",
        start: 2.1,
        end: 3.1,
        text: "스무 번째",
        sourceStart: 20,
        sourceEnd: 21,
      },
    ]
  )
  assert.equal(result.durationSeconds, 3.1)
})

test("원본 경계가 없는 자막은 훅 선택에서 제외한다", () => {
  const result = buildCaptionHookSelection(
    [cue("missing", "시간 없음", undefined, undefined)],
    "source-1"
  )
  assert.deepEqual(result, {
    scenes: [],
    subtitles: [],
    durationSeconds: 0,
  })
})

test("훅 전체 길이는 0.8초 이상 7초 이하만 허용한다", () => {
  assert.equal(isCaptionHookDurationValid(0.79), false)
  assert.equal(isCaptionHookDurationValid(0.8), true)
  assert.equal(isCaptionHookDurationValid(7), true)
  assert.equal(isCaptionHookDurationValid(7.01), false)
})

test("기존 단일 훅과 신규 복수 훅을 함께 찾고 제거한다", () => {
  const scene = (id: string, part?: NewsReportScene["part"]) =>
    ({
      id,
      part,
      narration: "",
      audioMode: "original",
      visual: "quote",
      sourceStart: 1,
      sourceEnd: 2,
    }) satisfies NewsReportScene
  const scenes = [
    scene("buildup2-hook"),
    scene("buildup2-hook-selection-1", "hook"),
    scene("custom-hook", "hook"),
    scene("buildup2-lead", "lead"),
  ]

  assert.equal(isBuildupHookScene(scenes[0]!), true)
  assert.deepEqual(
    buildupHookScenes(scenes).map((item) => item.id),
    ["buildup2-hook", "buildup2-hook-selection-1", "custom-hook"]
  )
  assert.equal(buildupHookDuration(scenes), 3)
  assert.deepEqual(
    removeBuildupHookScenes(scenes).map((item) => item.id),
    ["buildup2-lead"]
  )
})

test("훅 자막을 교체하면 뒤 자막은 길이 차이만큼 이동하고 편집값은 유지한다", () => {
  const previousHookScene: NewsReportScene = {
    id: "buildup2-hook",
    narration: "",
    part: "hook",
    audioMode: "original",
    visual: "quote",
    sourceStart: 10,
    sourceEnd: 11,
  }
  const oldHookCue = {
    ...cue("old-hook", "기존 훅", 10, 11),
    sceneId: previousHookScene.id,
    start: 0,
    end: 1,
  }
  const editedBodyCue = {
    ...cue("body-edited", "고친 본문", 20, 22),
    start: 1,
    end: 3,
    edited: true,
    originalText: "기존 본문",
  }
  const next = buildCaptionHookSelection(
    [cue("selected", "새 핵심 훅", 30, 33)],
    "source-1"
  )
  const replaced = replaceCaptionHookSubtitles(
    [oldHookCue, editedBodyCue],
    [previousHookScene],
    next.subtitles,
    1,
    next.durationSeconds
  )

  assert.equal(replaced.length, 2)
  assert.equal(replaced[0]?.text, "새 핵심 훅")
  assert.deepEqual(replaced[1], {
    ...editedBodyCue,
    start: 3,
    end: 5,
  })
})
