import assert from "node:assert/strict"
import test from "node:test"

import {
  partitionSubtitlesByPart,
  removeTrailingCtaFromLead,
  removeTrailingPartText,
  splitScenesByClipPart,
} from "./clip-parts.ts"

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
