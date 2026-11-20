import assert from "node:assert/strict"
import test from "node:test"

import {
  applyBuildupBodyCuts,
  remapSubtitlesAfterBodyCut,
  remapSubtitlesAfterBodyRestore,
  restoreSubtitlesAfterBodyRestore,
} from "./body-cuts.ts"
import { reportSubtitles } from "./report.ts"
import type {
  NewsReportScene,
  RemovedRange,
  SubtitleCue,
  TranscriptSegment,
} from "./types.ts"

const scenes: NewsReportScene[] = [
  {
    id: "buildup2-lead",
    narration: "서두",
    visual: "source",
    sourceId: "source-1",
    sourceStart: 10,
    sourceEnd: 13,
  },
  {
    id: "buildup2-quote",
    narration: "",
    part: "body",
    audioMode: "original",
    visualMode: "quote",
    visual: "quote",
    sourceId: "source-1",
    sourceStart: 10,
    sourceEnd: 30,
    crop: { x: 42, y: 55, zoom: 1.3, faceTracking: false },
  },
  {
    id: "end-cta",
    narration: "댓글로 남겨줘.",
    visual: "source",
    sourceId: "source-1",
    sourceStart: 27,
    sourceEnd: 30,
  },
]

function manualCut(id: string, start: number, end: number): RemovedRange {
  return { id, start, end, reason: "manual", restored: false }
}

test("본문 중간 구간을 삭제하면 앞·뒤 quote와 연속 keep을 만든다", () => {
  const plan = applyBuildupBodyCuts(
    scenes,
    { start: 10, end: 30 },
    [manualCut("cut-1", 16, 20)],
    { primarySourceId: "source-1" }
  )

  assert.equal(plan.reason, "")
  assert.deepEqual(
    plan.scenes
      .filter((scene) => scene.id.startsWith("buildup2-quote"))
      .map(({ id, sourceStart, sourceEnd }) => ({
        id,
        sourceStart,
        sourceEnd,
      })),
    [
      { id: "buildup2-quote-cut-1", sourceStart: 10, sourceEnd: 16 },
      { id: "buildup2-quote-cut-2", sourceStart: 20, sourceEnd: 30 },
    ]
  )
  assert.deepEqual(plan.keepRanges, [
    { sourceStart: 10, sourceEnd: 16, outputStart: 0, outputEnd: 6 },
    { sourceStart: 20, sourceEnd: 30, outputStart: 6, outputEnd: 16 },
  ])
  assert.equal(plan.deletedDuration, 4)
  assert.deepEqual(
    plan.scenes.find((scene) => scene.id === "buildup2-quote-cut-2")?.crop,
    scenes[1]?.crop
  )
})

test("삭제한 발화는 자막에서 빠지고 뒤 자막은 삭제 길이만큼 당겨진다", () => {
  const transcript: TranscriptSegment[] = [
    {
      id: "keep-before",
      text: "앞 발화",
      start: 10,
      end: 16,
      speaker: "a",
      words: [{ text: "앞 발화", start: 10, end: 16 }],
      captionBoundaryAfter: true,
      captionBoundarySource: "manual",
    },
    {
      id: "delete",
      text: "삭제할 발화",
      start: 16,
      end: 20,
      speaker: "a",
      words: [{ text: "삭제할 발화", start: 16, end: 20 }],
      captionBoundaryAfter: true,
      captionBoundarySource: "manual",
    },
    {
      id: "keep-after",
      text: "뒤 발화",
      start: 20,
      end: 30,
      speaker: "a",
      words: [{ text: "뒤 발화", start: 20, end: 30 }],
      captionBoundaryAfter: true,
      captionBoundarySource: "manual",
    },
  ]
  const baselineQuote = scenes[1]!
  const baseline = reportSubtitles(
    [baselineQuote],
    undefined,
    undefined,
    transcript
  )
  const plan = applyBuildupBodyCuts(scenes, { start: 10, end: 30 }, [
    manualCut("cut-1", 16, 20),
  ])
  const cutQuotes = plan.scenes.filter((scene) =>
    scene.id.startsWith("buildup2-quote")
  )
  const afterCut = reportSubtitles(cutQuotes, undefined, undefined, transcript)
  const baselineAfter = baseline.find((cue) => cue.text.includes("뒤 발화"))
  const cutAfter = afterCut.find((cue) => cue.text.includes("뒤 발화"))

  assert.equal(
    afterCut.some((cue) => cue.text.includes("삭제할")),
    false
  )
  assert.ok(baselineAfter)
  assert.ok(cutAfter)
  assert.equal(baselineAfter!.start - cutAfter!.start, 4)
})

test("인접한 수동 삭제를 합쳐도 이미 삭제한 구간을 재삽입하지 않는다", () => {
  const plan = applyBuildupBodyCuts(scenes, { start: 10, end: 30 }, [
    manualCut("cut-1", 16, 20),
    manualCut("cut-2", 20, 24),
  ])

  assert.deepEqual(
    plan.scenes
      .filter((scene) => scene.id.startsWith("buildup2-quote"))
      .map(({ sourceStart, sourceEnd }) => ({ sourceStart, sourceEnd })),
    [
      { sourceStart: 10, sourceEnd: 16 },
      { sourceStart: 24, sourceEnd: 30 },
    ]
  )
  assert.equal(plan.deletedDuration, 8)
})

test("본문 전체를 삭제하는 수동 컷은 거절한다", () => {
  const plan = applyBuildupBodyCuts(scenes, { start: 10, end: 30 }, [
    manualCut("cut-all", 10, 30),
  ])

  assert.equal(plan.reason, "body-cut-removes-all")
  assert.equal(plan.scenes, scenes)
})

test("본문 컷 후에도 남은 자막은 새 quote-cut에 다시 붙는다", () => {
  const plan = applyBuildupBodyCuts(scenes, { start: 10, end: 30 }, [
    manualCut("cut-1", 16, 20),
  ])
  const cues: SubtitleCue[] = [
    {
      id: "lead-1",
      sceneId: "buildup2-lead",
      start: 0,
      end: 2,
      text: "서두 자막",
      emphasis: [],
      emphasisColor: "yellow",
    },
    {
      id: "body-before",
      sceneId: "buildup2-quote",
      start: 0,
      end: 4,
      text: "앞 발화",
      emphasis: [],
      emphasisColor: "yellow",
      sourceStart: 11,
      sourceEnd: 15,
    },
    {
      id: "body-deleted",
      sceneId: "buildup2-quote",
      start: 4,
      end: 8,
      text: "삭제할 발화",
      emphasis: [],
      emphasisColor: "yellow",
      sourceStart: 16,
      sourceEnd: 20,
    },
    {
      id: "body-after",
      sceneId: "buildup2-quote",
      start: 8,
      end: 14,
      text: "뒤 발화",
      emphasis: [],
      emphasisColor: "yellow",
      sourceStart: 21,
      sourceEnd: 28,
    },
  ]

  const remapped = remapSubtitlesAfterBodyCut({
    cues,
    previousScenes: scenes,
    nextScenes: plan.scenes,
    deletedSourceStart: 16,
    deletedSourceEnd: 20,
    deletedCaptionId: "body-deleted",
    deletedCaptionEnd: 8,
    resolveSourceRange: (cue) =>
      Number.isFinite(cue.sourceStart) && Number.isFinite(cue.sourceEnd)
        ? { start: cue.sourceStart!, end: cue.sourceEnd! }
        : null,
    isBodyCue: (cue) => cue.sceneId !== "buildup2-lead",
  })

  assert.deepEqual(
    remapped.map((cue) => ({
      id: cue.id,
      sceneId: cue.sceneId,
      start: cue.start,
      end: cue.end,
    })),
    [
      {
        id: "lead-1",
        sceneId: "buildup2-lead",
        start: 0,
        end: 2,
      },
      {
        id: "body-before",
        sceneId: "buildup2-quote-cut-1",
        start: 0,
        end: 4,
      },
      {
        id: "body-after",
        sceneId: "buildup2-quote-cut-2",
        start: 4,
        end: 10,
      },
    ]
  )
})

test("삭제 구간을 복원하면 본문 quote 하나로 돌아간다", () => {
  const plan = applyBuildupBodyCuts(scenes, { start: 10, end: 30 }, [
    { ...manualCut("cut-1", 16, 20), restored: true },
  ])

  assert.equal(plan.reason, "")
  assert.deepEqual(
    plan.scenes
      .filter((scene) => scene.id.startsWith("buildup2-quote"))
      .map(({ id, sourceStart, sourceEnd }) => ({
        id,
        sourceStart,
        sourceEnd,
      })),
    [{ id: "buildup2-quote", sourceStart: 10, sourceEnd: 30 }]
  )
})

test("삭제 구간 복원은 수정한 본문 자막을 유지하고 새 장면에 다시 연결한다", () => {
  const cutPlan = applyBuildupBodyCuts(scenes, { start: 10, end: 30 }, [
    manualCut("cut-1", 16, 20),
  ])
  const restoredPlan = applyBuildupBodyCuts(
    cutPlan.scenes,
    { start: 10, end: 30 },
    [{ ...manualCut("cut-1", 16, 20), restored: true }]
  )
  const cues: SubtitleCue[] = [
    {
      id: "lead-1",
      sceneId: "buildup2-lead",
      start: 0,
      end: 2,
      text: "서두 자막",
      emphasis: [],
      emphasisColor: "yellow",
    },
    {
      id: "body-before",
      sceneId: "buildup2-quote-cut-1",
      start: 2,
      end: 5,
      sourceStart: 11,
      sourceEnd: 15,
      text: "사용자가 고친 앞 문장",
      originalText: "앞 발화",
      edited: true,
      emphasis: ["고친"],
      emphasisColor: "green",
    },
    {
      id: "body-after",
      sceneId: "buildup2-quote-cut-2",
      start: 5,
      end: 9,
      sourceStart: 21,
      sourceEnd: 28,
      text: "사용자가 고친 뒤 문장",
      originalText: "뒤 발화",
      edited: true,
      emphasis: ["뒤"],
      emphasisColor: "yellow",
    },
    {
      id: "outro-1",
      sceneId: "end-cta",
      start: 9,
      end: 11,
      text: "마무리 자막",
      emphasis: [],
      emphasisColor: "yellow",
    },
  ]

  const restored = remapSubtitlesAfterBodyRestore({
    cues,
    previousScenes: cutPlan.scenes,
    nextScenes: restoredPlan.scenes,
    restoredSourceStart: 16,
    restoredSourceEnd: 20,
    resolveSourceRange: (cue) =>
      Number.isFinite(cue.sourceStart) && Number.isFinite(cue.sourceEnd)
        ? { start: cue.sourceStart!, end: cue.sourceEnd! }
        : null,
    isBodyCue: (cue) => cue.sceneId?.startsWith("buildup2-quote") === true,
  })

  assert.deepEqual(restored, [
    cues[0],
    { ...cues[1], sceneId: "buildup2-quote" },
    {
      ...cues[2],
      sceneId: "buildup2-quote",
      start: 9,
      end: 13,
    },
    { ...cues[3], start: 13, end: 15 },
  ])
})

test("삭제 구간 복원은 기존 자막을 재생성하지 않고 복원 구간만 삽입한다", () => {
  const cutPlan = applyBuildupBodyCuts(scenes, { start: 10, end: 30 }, [
    manualCut("cut-1", 16, 20),
  ])
  const restoredPlan = applyBuildupBodyCuts(
    cutPlan.scenes,
    { start: 10, end: 30 },
    [{ ...manualCut("cut-1", 16, 20), restored: true }]
  )
  const existing: SubtitleCue[] = [
    {
      id: "body-before",
      sceneId: "buildup2-quote-cut-1",
      start: 2,
      end: 5,
      sourceStart: 11,
      sourceEnd: 15,
      text: "사용자가 고친 앞 문장",
      originalText: "앞 발화",
      edited: true,
      emphasis: ["고친"],
      emphasisColor: "green",
    },
    {
      id: "body-after",
      sceneId: "buildup2-quote-cut-2",
      start: 5,
      end: 9,
      sourceStart: 21,
      sourceEnd: 28,
      text: "사용자가 고친 뒤 문장",
      originalText: "뒤 발화",
      edited: true,
      emphasis: ["뒤"],
      emphasisColor: "yellow",
    },
  ]
  const generated: SubtitleCue[] = [
    {
      ...existing[0]!,
      sceneId: "buildup2-quote",
      text: "재생성된 앞 문장",
      edited: false,
    },
    {
      // 활성 컷이 여러 개면 장면 재인덱싱으로 기존 cue ID와 충돌할 수 있다.
      id: "body-after",
      sceneId: "buildup2-quote",
      start: 5,
      end: 7,
      sourceStart: 16.1,
      sourceEnd: 18,
      text: "복원된 첫 문장",
      emphasis: [],
      emphasisColor: "yellow",
    },
    {
      id: "body-restored-2",
      sceneId: "buildup2-quote",
      start: 7,
      end: 9,
      sourceStart: 18,
      sourceEnd: 19.9,
      text: "복원된 둘째 문장",
      emphasis: [],
      emphasisColor: "yellow",
    },
    {
      ...existing[1]!,
      sceneId: "buildup2-quote",
      start: 9,
      end: 13,
      text: "재생성된 뒤 문장",
      edited: false,
    },
  ]
  const resolveSourceRange = (cue: SubtitleCue) =>
    Number.isFinite(cue.sourceStart) && Number.isFinite(cue.sourceEnd)
      ? { start: cue.sourceStart!, end: cue.sourceEnd! }
      : null

  const restored = restoreSubtitlesAfterBodyRestore({
    cues: existing,
    generatedCues: generated,
    previousScenes: cutPlan.scenes,
    nextScenes: restoredPlan.scenes,
    restoredSourceStart: 16,
    restoredSourceEnd: 20,
    resolveSourceRange,
    isBodyCue: () => true,
  })

  assert.deepEqual(
    restored.map(({ id, text, start, end, edited }) => ({
      id,
      text,
      start,
      end,
      edited,
    })),
    [
      {
        id: "body-before",
        text: "사용자가 고친 앞 문장",
        start: 2,
        end: 5,
        edited: true,
      },
      {
        id: "body-after-restored-16000-2",
        text: "복원된 첫 문장",
        start: 5,
        end: 7,
        edited: undefined,
      },
      {
        id: "body-restored-2",
        text: "복원된 둘째 문장",
        start: 7,
        end: 9,
        edited: undefined,
      },
      {
        id: "body-after",
        text: "사용자가 고친 뒤 문장",
        start: 9,
        end: 13,
        edited: true,
      },
    ]
  )
})
