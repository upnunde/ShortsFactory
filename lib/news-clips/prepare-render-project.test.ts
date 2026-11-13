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

test("확정한 본문 시작·종료는 검수 자막의 앞뒤 문장으로 확장되지 않는다", () => {
  const base = sampleProject()
  const lockedStart = 70.3
  const lockedEnd = 141.8
  const { project, reason } = prepareRenderProject(
    {
      ...base,
      selectedAngleId: "selected-date-angle",
      angleOptions: [
        {
          id: "selected-date-angle",
          title: "법치주의 사망 선언",
          summary: "11월 6일 발언부터 시작하는 구간",
          keywords: ["법치주의"],
          evidence: "2026년 11월 6일 대한민국 법치주의가 사망했습니다.",
          sourceStart: lockedStart,
          sourceEnd: lockedEnd,
        },
      ],
      transcript: [
        {
          id: "previous-caption",
          text: "목격했습니다.",
          start: 67.7,
          // 화면 표시 시간만 다음 자막 직전까지 이어진 상태다.
          end: 71.44,
          speaker: "a",
          words: [{ text: "목격했습니다.", start: 67.7, end: 70.3 }],
        },
        {
          id: "selected-caption",
          text: "2026년 11월 6일 대한민국 법치주의가 사망했습니다.",
          start: 70.64,
          end: 81,
          speaker: "a",
          words: [
            { text: "2026년", start: 70.64, end: 72.04 },
            { text: "11월", start: 72.04, end: 73.44 },
            { text: "6일", start: 73.44, end: 73.94 },
            { text: "대한민국", start: 73.94, end: 76.74 },
            { text: "법치주의가", start: 76.74, end: 78.7 },
            { text: "사망했습니다.", start: 78.7, end: 81 },
          ],
        },
        {
          id: "selected-ending",
          text: "지금 대한민국이 독재국가가 되고 있습니다.",
          start: 136.18,
          end: 141.76,
          speaker: "a",
          words: [
            { text: "지금", start: 136.18, end: 138.08 },
            { text: "대한민국이", start: 138.08, end: 139.12 },
            { text: "독재국가가", start: 139.12, end: 141.1 },
            { text: "되고", start: 141.1, end: 141.32 },
            { text: "있습니다.", start: 141.32, end: 141.76 },
          ],
        },
        {
          id: "following-caption",
          text: "우리가 막아야 하지 않겠습니까?",
          start: 149.49,
          end: 151.19,
          speaker: "a",
          words: [
            { text: "우리가", start: 149.49, end: 149.92 },
            { text: "막아야", start: 149.92, end: 150.34 },
            { text: "하지", start: 150.34, end: 150.77 },
            { text: "않겠습니까?", start: 150.77, end: 151.19 },
          ],
        },
      ],
      reportScenes: [
        {
          id: "buildup2-lead",
          narration: "이 발언부터 볼게.",
          visual: "source" as const,
          sourceStart: lockedStart,
          sourceEnd: 73.3,
        },
        {
          id: "buildup2-quote",
          narration: "",
          visual: "quote" as const,
          // 예전 오류로 저장된 범위도 선택 각도의 절대 경계로 복구한다.
          sourceStart: 67.7,
          sourceEnd: 151.19,
        },
        ...base.reportScenes.filter((scene) => scene.id === "end-cta"),
      ],
    },
    defaultNewsClipSettings
  )
  const quote = project.reportScenes.find(
    (scene) => scene.id === "buildup2-quote"
  )

  assert.equal(reason, "")
  assert.equal(quote?.sourceStart, lockedStart)
  assert.equal(quote?.sourceEnd, lockedEnd)
  const quoteCaptions = project.subtitles.filter(
    (cue) => cue.sceneId === "buildup2-quote"
  )
  assert.ok(quoteCaptions.every((cue) => !cue.text.includes("목격했습니다")))
  assert.ok(quoteCaptions.every((cue) => !cue.text.includes("우리가 막아야")))
})

test("잠긴 이전 프로젝트도 실제 자막 발화의 양끝으로 영상·음성을 줄인다", () => {
  const base = sampleProject()
  const { project, reason } = prepareRenderProject(
    {
      ...base,
      source: base.source ? { ...base.source, durationSeconds: 300 } : null,
      selectedAngleId: "legacy-angle",
      angleOptions: [
        {
          id: "legacy-angle",
          title: "괴물 특검 발언",
          summary: "이재명 탈옥 관련 발언",
          keywords: ["특검"],
          evidence: "이재명의 감옥행을 막는 것입니다.",
          sourceStart: 177.09,
          sourceEnd: 239.69,
        },
      ],
      transcript: [
        {
          id: "boundary-start",
          text: "범죄자 이재명의 감옥행을 막는 것입니다.",
          start: 177.09,
          end: 183.11,
          speaker: "a",
          words: [
            { text: "범죄자", start: 175.59, end: 177.79 },
            { text: "이재명의", start: 177.79, end: 179.83 },
            { text: "감옥행을", start: 179.83, end: 181.47 },
            { text: "막는", start: 181.47, end: 182.59 },
            { text: "것입니다.", start: 182.59, end: 183.11 },
          ],
        },
        {
          id: "boundary-end",
          text: "마지막 발언입니다.",
          start: 237.59,
          end: 238.37,
          speaker: "a",
          words: [
            { text: "마지막", start: 237.59, end: 238.01 },
            { text: "발언입니다.", start: 238.01, end: 238.37 },
          ],
        },
      ],
      reportScenes: [
        {
          id: "buildup2-lead",
          narration: "이 발언을 봐.",
          visual: "source" as const,
          sourceStart: 177.09,
          sourceEnd: 180.09,
        },
        {
          id: "buildup2-quote",
          narration: "",
          visual: "quote" as const,
          sourceStart: 177.09,
          sourceEnd: 239.69,
        },
        ...base.reportScenes.filter((scene) => scene.id === "end-cta"),
      ],
      subtitles: [
        {
          id: "saved-edit",
          sceneId: "buildup2-quote",
          start: 7.13,
          end: 10.63,
          text: "사용자가 고친 문구",
          emphasis: [],
          emphasisColor: "yellow" as const,
          edited: true,
        },
      ],
      subtitleTimingsLocked: true,
    },
    defaultNewsClipSettings,
    { lockTimeline: true }
  )
  const quote = project.reportScenes.find(
    (scene) => scene.id === "buildup2-quote"
  )

  assert.equal(reason, "")
  assert.equal(quote?.sourceStart, 177.79)
  assert.equal(quote?.sourceEnd, 238.37)
  assert.equal(project.subtitleTimingsLocked, false)
  assert.equal(
    project.subtitles.some((cue) => cue.text === "사용자가 고친 문구"),
    true
  )
})

test("잠긴 타임라인은 미리보기를 다시 만들어도 영상 컷 구간을 유지한다", () => {
  const base = sampleProject()
  const locked = {
    ...base,
    subtitleTimingsLocked: true,
    reportScenes: base.reportScenes.map((scene) =>
      scene.id === "buildup2-quote-cut-1"
        ? { ...scene, sourceStart: 10.25, sourceEnd: 13.75 }
        : scene
    ),
  }
  const { project, reason } = prepareRenderProject(
    locked,
    defaultNewsClipSettings,
    { lockTimeline: true }
  )
  const firstCut = project.reportScenes.find(
    (scene) => scene.id === "buildup2-quote-cut-1"
  )
  const secondCut = project.reportScenes.find(
    (scene) => scene.id === "buildup2-quote-cut-2"
  )

  assert.equal(reason, "")
  assert.equal(firstCut?.sourceStart, 10.25)
  assert.equal(firstCut?.sourceEnd, 13.75)
  assert.equal(secondCut?.sourceStart, 14)
  assert.equal(secondCut?.sourceEnd, 18)
})

test("수동 삭제한 본문 구간은 미리보기 준비 중에 다시 합쳐지지 않는다", () => {
  const base = sampleProject()
  const { project, reason } = prepareRenderProject(
    {
      ...base,
      selectedAngleId: "angle-1",
      angleOptions: [
        {
          id: "angle-1",
          title: "본문 컷 테스트",
          summary: "중간 구간을 제외한다.",
          keywords: ["본문"],
          evidence: "원본 발언",
          sourceStart: 10,
          sourceEnd: 18,
        },
      ],
      selectedCandidateId: "candidate-1",
      candidates: [
        {
          id: "candidate-1",
          sourceStart: 10,
          sourceEnd: 18,
          estimatedFinalSeconds: 8,
          reason: "테스트",
          preview: "원본 발언",
          contextRisk: "low" as const,
          scores: {
            audienceFit: 80,
            timeliness: 80,
            hook: 80,
            specificity: 80,
            standalone: 80,
            contextIntegrity: 80,
            mediaQuality: 80,
            total: 80,
          },
          titleOptions: ["본문 컷"],
        },
      ],
      removedRanges: [
        {
          id: "manual-cut",
          start: 14,
          end: 16,
          reason: "manual" as const,
          restored: false,
        },
      ],
      subtitles: [],
      subtitleTimingsLocked: false,
    },
    defaultNewsClipSettings,
    { rebuildSubtitles: true }
  )

  assert.equal(reason, "")
  assert.deepEqual(
    project.reportScenes
      .filter((scene) => scene.id.startsWith("buildup2-quote"))
      .map(({ id, sourceStart, sourceEnd }) => ({
        id,
        sourceStart,
        sourceEnd,
      })),
    [
      { id: "buildup2-quote-cut-1", sourceStart: 10, sourceEnd: 14 },
      { id: "buildup2-quote-cut-2", sourceStart: 16, sourceEnd: 18 },
    ]
  )
  assert.deepEqual(project.keepRanges, [
    { sourceStart: 10, sourceEnd: 14, outputStart: 0, outputEnd: 4 },
    { sourceStart: 16, sourceEnd: 18, outputStart: 4, outputEnd: 6 },
  ])
  assert.equal(
    project.subtitles.some((cue) => cue.sceneId === "buildup2-quote"),
    false
  )
})

test("잠긴 자막은 어떤 문구로 수정해도 자동 분할·병합 없이 그대로 유지한다", () => {
  const base = sampleProject()
  const subtitles = [
    {
      id: "fixed-caption",
      sceneId: "buildup2-quote-cut-1",
      start: 1.2,
      end: 2.8,
      text: "내가 직접 저장한 1줄\n내가 직접 저장한 2줄",
      emphasis: ["직접"],
      emphasisColor: "yellow" as const,
      edited: true,
    },
  ]
  const { project, reason } = prepareRenderProject(
    { ...base, subtitles, subtitleTimingsLocked: true },
    defaultNewsClipSettings,
    { lockTimeline: true }
  )

  assert.equal(reason, "")
  assert.deepEqual(project.subtitles, subtitles)
})

test("crop-only save preserves locked caption identity, text, and timing", () => {
  const base = sampleProject()
  const subtitles = [
    {
      id: "crop-locked-caption",
      sceneId: "buildup2-quote-cut-1",
      start: 1.2,
      end: 2.8,
      text: "saved first line\nsaved second line",
      emphasis: ["saved"],
      emphasisColor: "yellow" as const,
      edited: true,
    },
  ]
  const reportScenes = base.reportScenes.map((scene) =>
    scene.id === "buildup2-quote-cut-1"
      ? {
          ...scene,
          crop: { x: 27, y: 64, zoom: 1.53, faceTracking: false },
        }
      : scene
  )
  const { project, reason } = prepareRenderProject(
    {
      ...base,
      reportScenes,
      subtitles,
      subtitleTimingsLocked: true,
    },
    defaultNewsClipSettings,
    { lockTimeline: true }
  )
  const croppedScene = project.reportScenes.find(
    (scene) => scene.id === "buildup2-quote-cut-1"
  )

  assert.equal(reason, "")
  assert.equal(project.subtitleTimingsLocked, true)
  assert.deepEqual(croppedScene?.crop, {
    x: 27,
    y: 64,
    zoom: 1.53,
    faceTracking: false,
  })
  assert.equal(croppedScene?.sourceStart, 10)
  assert.equal(croppedScene?.sourceEnd, 14)
  assert.deepEqual(
    project.subtitles.map(({ id, text, start, end }) => ({
      id,
      text,
      start,
      end,
    })),
    subtitles.map(({ id, text, start, end }) => ({ id, text, start, end }))
  )
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

test("기존 프로젝트의 축약 날짜도 렌더 직전에 복원한다", () => {
  const dated = {
    ...sampleProject(),
    transcript: [
      {
        id: "date-year",
        text: "26년",
        start: 10,
        end: 11,
        speaker: "a",
        words: [{ text: "26년", start: 10, end: 11, speaker: "a" }],
      },
      {
        id: "date-month-day",
        text: "11월 6일",
        start: 11.1,
        end: 13,
        speaker: "a",
        words: [
          { text: "11월", start: 11.1, end: 12, speaker: "a" },
          { text: "6일", start: 12.1, end: 13, speaker: "a" },
        ],
      },
    ],
  }
  const { project, reason } = prepareRenderProject(
    dated,
    defaultNewsClipSettings,
    { rebuildSubtitles: true }
  )

  assert.equal(reason, "")
  assert.equal(project.transcript[0]?.text, "2026년")
  assert.ok(
    project.subtitles.some(
      (cue) => cue.text.replace(/\n/g, " ") === "2026년 11월 6일"
    )
  )
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

test("기존 보도형 quote 저장본도 풀 TTS 자료화면으로 마이그레이션한다", () => {
  const base = sampleProject()
  const prepared = prepareRenderProject(
    {
      ...base,
      productionMode: "report" as const,
      reportScript: "",
      reportScenes: [
        {
          id: "report-scene-1",
          narration: "먼저 이 이슈가 왜 나왔는지 볼게.",
          visual: "quote" as const,
          sourceStart: 10,
          sourceEnd: 14,
        },
        {
          id: "report-scene-2",
          narration: "핵심 근거는 이 장면에 담겨 있어.",
          visual: "source" as const,
          sourceStart: 14,
          sourceEnd: 18,
        },
      ],
    },
    defaultNewsClipSettings,
    { lockTimeline: true }
  )

  assert.equal(prepared.reason, "")
  assert.deepEqual(
    prepared.project.reportScenes.map((scene) => ({
      part: scene.part,
      audioMode: scene.audioMode,
      visualMode: scene.visualMode,
      visual: scene.visual,
    })),
    [
      {
        part: "lead",
        audioMode: "tts",
        visualMode: "source",
        visual: "source",
      },
      {
        part: "body",
        audioMode: "tts",
        visualMode: "source",
        visual: "source",
      },
    ]
  )
  assert.equal(
    prepared.project.reportScript,
    "먼저 이 이슈가 왜 나왔는지 볼게.\n핵심 근거는 이 장면에 담겨 있어."
  )
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
