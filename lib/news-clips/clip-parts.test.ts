import assert from "node:assert/strict"
import test from "node:test"

import {
  activeReportScenes,
  newsOptionalPartEnabled,
  partitionSubtitlesByPart,
  removeTrailingCtaFromLead,
  removeTrailingPartText,
  splitScenesByClipPart,
  syncSceneNarrationFromSubtitles,
} from "./clip-parts.ts"
import { freshNewsClipProject } from "./types.ts"

test("빌드업형은 lead를 서두, quote를 본문으로 나눈다", () => {
  const parts = splitScenesByClipPart(
    [
      {
        id: "buildup2-lead",
        narration: "들어봐",
        visual: "source",
        sourceStart: 0,
        sourceEnd: 2,
        crop: { x: 50, y: 50, zoom: 1, faceTracking: false },
      },
      {
        id: "buildup2-quote",
        narration: "",
        visual: "quote",
        sourceStart: 2,
        sourceEnd: 10,
        crop: { x: 50, y: 50, zoom: 1, faceTracking: false },
      },
      {
        id: "end-cta",
        narration: "댓글",
        visual: "source",
        sourceStart: 8,
        sourceEnd: 10,
        crop: { x: 50, y: 50, zoom: 1, faceTracking: false },
      },
    ],
    "buildup2"
  )
  assert.deepEqual(
    parts.lead.map((scene) => scene.id),
    ["buildup2-lead"]
  )
  assert.deepEqual(
    parts.body.map((scene) => scene.id),
    ["buildup2-quote"]
  )
  assert.deepEqual(
    parts.outro.map((scene) => scene.id),
    ["end-cta"]
  )
})

test("핵심 훅을 독립 구간으로 나누고 본문 외 구간은 켜고 끄는다", () => {
  const base = freshNewsClipProject("channel-test")
  const project = {
    ...base,
    disabledParts: ["intro", "lead", "outro"] as typeof base.disabledParts,
    reportScenes: [
      {
        id: "buildup2-hook",
        part: "hook" as const,
        narration: "",
        audioMode: "original" as const,
        visual: "quote" as const,
        sourceStart: 1,
        sourceEnd: 4,
      },
      {
        id: "buildup2-lead",
        part: "lead" as const,
        narration: "서두",
        visual: "source" as const,
        sourceStart: 4,
        sourceEnd: 7,
      },
      {
        id: "buildup2-quote",
        part: "body" as const,
        narration: "",
        audioMode: "original" as const,
        visual: "quote" as const,
        sourceStart: 7,
        sourceEnd: 20,
      },
      {
        id: "end-cta",
        part: "outro" as const,
        narration: "마무리",
        visual: "source" as const,
        sourceStart: 20,
        sourceEnd: 22,
      },
    ],
  }
  const parts = splitScenesByClipPart(project.reportScenes, "buildup2")

  assert.deepEqual(
    parts.hook.map((scene) => scene.id),
    ["buildup2-hook"]
  )
  assert.equal(newsOptionalPartEnabled(project, "hook"), true)
  assert.deepEqual(
    activeReportScenes(project).map((scene) => scene.id),
    ["buildup2-hook", "buildup2-quote"]
  )
})

test("원본 구간형 자막 수정은 서두·마무리 대본만 같은 문구로 맞춘다", () => {
  const scenes = [
    {
      id: "buildup2-lead",
      part: "lead" as const,
      narration: "기존 서두",
      visual: "source" as const,
      sourceStart: 0,
      sourceEnd: 2,
    },
    {
      id: "buildup2-quote",
      part: "body" as const,
      narration: "원본 음성 본문",
      visual: "quote" as const,
      sourceStart: 2,
      sourceEnd: 6,
    },
    {
      id: "end-cta",
      part: "outro" as const,
      narration: "기존 마무리",
      visual: "source" as const,
      sourceStart: 6,
      sourceEnd: 8,
    },
  ]
  const synced = syncSceneNarrationFromSubtitles(
    scenes,
    [
      {
        id: "lead-1",
        sceneId: "buildup2-lead",
        start: 0,
        end: 1,
        text: "수정한 서두",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "body-1",
        sceneId: "buildup2-quote",
        start: 1,
        end: 2,
        text: "수정한 본문 자막",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "outro-1",
        sceneId: "end-cta",
        start: 2,
        end: 3,
        text: "이건 어떻게 생각해?",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "outro-2",
        sceneId: "end-cta",
        start: 3,
        end: 4,
        text: "댓글로 남겨줘.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    "buildup2"
  )

  assert.equal(synced[0]?.narration, "수정한 서두")
  assert.equal(synced[1]?.narration, "원본 음성 본문")
  assert.equal(synced[2]?.narration, "이건 어떻게 생각해? 댓글로 남겨줘.")
})

test("보도형은 배열 순서가 아니라 명시한 part로 서두와 본문을 나눈다", () => {
  const parts = splitScenesByClipPart(
    [
      {
        id: "s2",
        narration: "둘째",
        part: "body",
        visual: "source",
        sourceStart: 2,
        sourceEnd: 4,
        crop: { x: 50, y: 50, zoom: 1, faceTracking: false },
      },
      {
        id: "s1",
        narration: "첫째",
        part: "lead",
        visual: "source",
        sourceStart: 0,
        sourceEnd: 2,
        crop: { x: 50, y: 50, zoom: 1, faceTracking: false },
      },
      {
        id: "end-cta",
        narration: "댓글",
        visual: "source",
        sourceStart: 3,
        sourceEnd: 4,
        crop: { x: 50, y: 50, zoom: 1, faceTracking: false },
      },
    ],
    "report"
  )
  assert.deepEqual(
    parts.lead.map((scene) => scene.id),
    ["s1"]
  )
  assert.deepEqual(
    parts.body.map((scene) => scene.id),
    ["s2"]
  )
})

test("레거시 보도형도 장면 위치가 아닌 저장 ID로 서두를 복원한다", () => {
  const parts = splitScenesByClipPart(
    [
      {
        id: "report-scene-2",
        narration: "본문",
        visual: "source",
        sourceStart: 2,
        sourceEnd: 4,
      },
      {
        id: "report-scene-1",
        narration: "서두",
        visual: "source",
        sourceStart: 0,
        sourceEnd: 2,
      },
    ],
    "report"
  )

  assert.deepEqual(
    parts.lead.map((scene) => scene.id),
    ["report-scene-1"]
  )
  assert.deepEqual(
    parts.body.map((scene) => scene.id),
    ["report-scene-2"]
  )
})

test("마지막 본문 ID로 잘못 저장된 CTA 질문도 마무리 자막으로 복원한다", () => {
  const cues = [
    {
      id: "body-last",
      sceneId: "report-body-8",
      start: 30,
      end: 32,
      text: "이 경고, 그냥 넘길 얘기일까?",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "legacy-question",
      sceneId: "report-body-8",
      start: 32,
      end: 34,
      text: "전세난에 대한 정부 대응을 어떻게 생각해?",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "end-cta-2",
      sceneId: "end-cta",
      start: 34,
      end: 36,
      text: "댓글로 남겨줘.",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
  ]
  const parts = partitionSubtitlesByPart(
    cues,
    [{ id: "report-lead-1" }],
    [{ id: "report-body-8" }]
  )

  assert.deepEqual(
    parts.body.map((cue) => cue.id),
    ["body-last"]
  )
  assert.deepEqual(
    parts.outro.map((cue) => cue.id),
    ["legacy-question", "end-cta-2"]
  )
})

test("대본 다시 작성 뒤 현재 장면에 없는 이전 자막은 본문에 되살리지 않는다", () => {
  const parts = partitionSubtitlesByPart(
    [
      {
        id: "fresh-body",
        sceneId: "report-body-new",
        start: 2,
        end: 4,
        text: "새 본문 자막",
        emphasis: [],
        emphasisColor: "yellow" as const,
      },
      {
        id: "stale-body",
        sceneId: "report-body-old",
        start: 2,
        end: 4,
        text: "이전 본문 자막",
        emphasis: [],
        emphasisColor: "yellow" as const,
      },
    ],
    [{ id: "report-lead-new" }],
    [{ id: "report-body-new" }]
  )

  assert.deepEqual(
    parts.body.map((cue) => cue.id),
    ["fresh-body"]
  )
})

test("서두 끝에 중복된 마무리 문구를 장면 기준으로 제거한다", () => {
  assert.equal(
    removeTrailingPartText(
      "이 문제는 그냥 넘길 일이 아니야. 여러분 판단은 어때? 한마디 적어줘.",
      "여러분 판단은 어때? 한마디 적어줘."
    ),
    "이 문제는 그냥 넘길 일이 아니야."
  )
})

test("명시적 마무리 장면이 불완전해도 서두의 댓글 유도를 제거한다", () => {
  assert.equal(
    removeTrailingCtaFromLead(
      "이 문제는 그냥 넘길 일이 아니야. 이건 어떻게 생각해? 댓글로 남겨줘."
    ),
    "이 문제는 그냥 넘길 일이 아니야."
  )
})
