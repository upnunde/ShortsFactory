import assert from "node:assert/strict"
import test from "node:test"

import {
  prepareRenderProject,
  renderContractReason,
} from "./prepare-render-project.ts"
import {
  defaultNewsClipSettings,
  freshNewsClipProject,
  type TranscriptSegment,
} from "./types.ts"

const transcript: TranscriptSegment[] = [
  {
    id: "1",
    text: "공수처가 현직 대통령을 체포했다.",
    start: 10,
    end: 14,
    speaker: "a",
    words: [],
  },
  {
    id: "2",
    text: "도파민 터지는 연출이라는 주장이다.",
    start: 14,
    end: 18,
    speaker: "a",
    words: [],
  },
]

function sampleProject() {
  const base = freshNewsClipProject("news-channel-30cfb65e")
  return {
    ...base,
    productionMode: "buildup2" as const,
    source: {
      id: "src-1",
      kind: "youtube" as const,
      title: "원본",
      channel: "채널",
      publishedAt: "",
      durationSeconds: 200,
      viewCount: 0,
      originalUrl: "https://example.com",
      summary: "",
      localFile: "/tmp/a.mp4",
      approved: true,
      requiresUpload: false,
      commentCount: 0,
      searchMetrics: null,
    },
    transcript,
    title: "공수처 연출\n체포 장면",
    reportScript: "직접 들어봐.\n어떻게 생각해?\n댓글로 남겨줘.",
    reportScenes: [
      {
        id: "buildup2-lead",
        narration: "직접 들어봐.",
        visual: "source" as const,
        sourceStart: 10,
        sourceEnd: 13,
      },
      {
        id: "buildup2-quote-cut-1",
        narration: "",
        visual: "quote" as const,
        sourceStart: 10,
        sourceEnd: 14,
      },
      {
        id: "buildup2-quote-cut-2",
        narration: "",
        visual: "quote" as const,
        sourceStart: 14,
        sourceEnd: 18,
      },
      {
        id: "end-cta",
        narration: "어떻게 생각해?\n댓글로 남겨줘.",
        visual: "source" as const,
        sourceStart: 10.5,
        sourceEnd: 13,
      },
    ],
    previewSignature: "old",
    renderSignature: "old",
  }
}

test("prepareRenderProject는 하이라이트 컷을 합치고 자막을 다시 만든다", () => {
  const { project, reason } = prepareRenderProject(
    sampleProject(),
    defaultNewsClipSettings
  )
  assert.equal(reason, "")
  assert.equal(
    project.reportScenes.some((scene) => scene.id === "buildup2-quote"),
    true
  )
  assert.equal(
    project.reportScenes.some((scene) =>
      /^buildup2-quote-cut-\d+/i.test(scene.id)
    ),
    false
  )
  assert.ok(project.subtitles.some((cue) => cue.sceneId === "buildup2-quote"))
  assert.equal(project.previewSignature, "old")
  assert.equal(project.renderSignature, "")
})

test("빌드업형 렌더 직전에도 원본 발언을 완결 문장까지 연장한다", () => {
  const base = sampleProject()
  const { project, reason } = prepareRenderProject(
    {
      ...base,
      reportScenes: base.reportScenes
        .filter((scene) => !scene.id.startsWith("buildup2-quote"))
        .toSpliced(1, 0, {
          id: "buildup2-quote",
          narration: "",
          visual: "quote" as const,
          sourceStart: 10,
          sourceEnd: 15,
        }),
    },
    defaultNewsClipSettings
  )
  const quote = project.reportScenes.find(
    (scene) => scene.id === "buildup2-quote"
  )

  assert.equal(reason, "")
  assert.equal(quote?.sourceStart, 10)
  assert.equal(quote?.sourceEnd, 18)
})

test("prepareRenderProject는 end-cta 구간·크롭을 유지한다", () => {
  const base = sampleProject()
  const withCrop = {
    ...base,
    reportScenes: base.reportScenes.map((scene) =>
      scene.id === "end-cta"
        ? {
            ...scene,
            sourceStart: 11,
            sourceEnd: 16,
            crop: { x: 22, y: 55, zoom: 1.4, faceTracking: false },
          }
        : scene
    ),
  }
  const { project, reason } = prepareRenderProject(
    withCrop,
    defaultNewsClipSettings
  )
  const cta = project.reportScenes.find((scene) => scene.id === "end-cta")

  assert.equal(reason, "")
  assert.equal(cta?.sourceStart, 11)
  assert.equal(cta?.sourceEnd, 16)
  assert.deepEqual(cta?.crop, {
    x: 22,
    y: 55,
    zoom: 1.4,
    faceTracking: false,
  })
})

test("빌드업 서두에 중복된 마무리 멘트를 렌더 전에 제거한다", () => {
  const base = sampleProject()
  const outro = "여러분 판단은 어때? 한마디 적어줘."
  const polluted = {
    ...base,
    reportScript: `직접 들어봐.\n${outro}`,
    reportScenes: base.reportScenes.map((scene) =>
      scene.id === "buildup2-lead"
        ? { ...scene, narration: `직접 들어봐. ${outro}` }
        : scene.id === "end-cta"
          ? { ...scene, narration: outro }
          : scene
    ),
  }
  const { project, reason } = prepareRenderProject(
    polluted,
    defaultNewsClipSettings
  )
  const lead = project.reportScenes.find(
    (scene) => scene.id === "buildup2-lead"
  )

  assert.equal(reason, "")
  assert.equal(lead?.narration, "직접 들어봐.")
  assert.equal(project.reportScript, `직접 들어봐.\n${outro}`)
})

test("prepareRenderProject는 수동 수정한 자막을 기본으로 유지한다", () => {
  const edited = {
    ...sampleProject(),
    subtitles: [
      {
        id: "manual-1",
        text: "사용자가 고친 자막",
        start: 0,
        end: 2,
        emphasis: [] as string[],
        emphasisColor: "yellow" as const,
        edited: true,
        sceneId: "buildup2-lead",
      },
    ],
  }
  const preserved = prepareRenderProject(edited, defaultNewsClipSettings)
  const rebuilt = prepareRenderProject(edited, defaultNewsClipSettings, {
    rebuildSubtitles: true,
  })

  assert.equal(preserved.reason, "")
  assert.equal(preserved.project.subtitles[0]?.text, "사용자가 고친 자막")
  assert.notEqual(rebuilt.project.subtitles[0]?.text, "사용자가 고친 자막")
})

test("렌더 계약은 quote 구간과 teaser 나레이션을 요구한다", () => {
  assert.equal(renderContractReason(sampleProject()), "")
  assert.equal(
    renderContractReason({
      ...sampleProject(),
      reportScenes: [
        {
          id: "buildup2-lead",
          narration: "",
          visual: "source",
          sourceStart: 10,
          sourceEnd: 13,
        },
      ],
    }),
    "report-scene-narration-required"
  )
})
