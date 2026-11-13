import assert from "node:assert/strict"
import test from "node:test"

import {
  buildReportScenes,
  appendEndCtaScenes,
  canonicalReportScript,
  continuousSpeechWordBoundaries,
  contextualEndCtaText,
  ensureReportEndCta,
  splitEndCtaFromScript,
  estimateReportDuration,
  estimateReportScenesDuration,
  groupReportVisualContinuationSegments,
  normalizeQuoteScenes,
  quoteNarrationMatchesTranscript,
  quoteTranscriptAlignment,
  reportCaptionPhrases,
  reportSceneAudioMode,
  reportScriptFromScenes,
  reportVisualContinuationAnchor,
  resolveReportVisualContinuations,
  reportSubtitles,
  shortBreathReviewTranscript,
  subtitleCuesFromSpeechAlignment,
  applySubtitleTimingForRender,
  mergeEditedSubtitleText,
  retimeLockedSubtitleCuesToSpeech,
  retimeSubtitleCuesToScenes,
} from "./report.ts"
import {
  mergeTranscriptSegmentWithNext,
  updateTranscriptSegmentText,
} from "./transcript.ts"
import type { NewsReportScene, TranscriptSegment } from "./types.ts"

const transcript: TranscriptSegment[] = [
  {
    id: "segment-1",
    text: "정부는 오늘 새로운 대책을 발표했습니다.",
    start: 10,
    end: 15,
    speaker: "speaker-1",
    words: [],
  },
  {
    id: "segment-2",
    text: "지원 대상은 약 30만 명으로 예상됩니다.",
    start: 20,
    end: 25,
    speaker: "speaker-1",
    words: [],
  },
]

test("보도 대본의 모든 문장을 자료 화면으로 기본 배치한다", () => {
  const scenes = buildReportScenes(
    "정부가 새로운 대책을 발표했습니다. 지원 대상은 약 30만 명입니다. 세부 시행 일정은 추가로 공개될 예정입니다.",
    transcript,
    10,
    30
  )
  assert.equal(scenes.length, 3)
  assert.equal(scenes[0].visual, "source")
  assert.equal(scenes[0].part, "lead")
  assert.equal(scenes[0].audioMode, "tts")
  assert.equal(scenes[0].visualMode, "source")
  assert.equal(scenes[1].visual, "source")
  assert.equal(scenes[1].part, "body")
  assert.equal(scenes[1].audioMode, "tts")
  assert.equal(scenes[2].visual, "source")
  assert.ok(scenes[1].sourceStart >= 10)
  assert.ok(scenes[1].sourceEnd <= 30)
})

test("보도 대본은 장면 narration에서 한 방향으로 복원한다", () => {
  const scenes = buildReportScenes(
    "첫 문장입니다. 두 번째 문장입니다.",
    transcript,
    10,
    30
  )

  assert.equal(
    reportScriptFromScenes(scenes),
    "첫 문장입니다.\n두 번째 문장입니다."
  )
  assert.equal(
    canonicalReportScript("저장 시점이 오래된 대본", scenes),
    "첫 문장입니다.\n두 번째 문장입니다."
  )
  assert.equal(canonicalReportScript("레거시 대본", []), "레거시 대본")
})

test("보도형 재구성은 레거시 quote 장면도 풀 TTS 자료화면으로 정규화한다", () => {
  const [scene] = buildReportScenes("첫 문장입니다.", transcript, 10, 30, [
    {
      id: "legacy-quote",
      narration: "예전 직접 발언",
      visual: "quote",
      sourceStart: 10,
      sourceEnd: 15,
    },
  ])

  assert.equal(scene.visual, "source")
  assert.equal(scene.visualMode, "source")
  assert.equal(reportSceneAudioMode(scene), "tts")
})

test("문장별 장면에 핵심 원본 식별자를 기본 저장하고 보조 원본 선택을 보존한다", () => {
  const scenes = buildReportScenes(
    "첫 문장입니다. 두 번째 문장입니다.",
    transcript,
    10,
    30,
    [
      {
        id: "saved-scene",
        narration: "",
        visual: "source",
        sourceId: "supporting-source",
        sourceStart: 2,
        sourceEnd: 7,
        continuePreviousVisual: true,
      },
    ],
    "primary-source"
  )
  assert.equal(scenes[0].sourceId, "supporting-source")
  assert.equal(scenes[0].sourceStart, 2)
  assert.equal(scenes[0].sourceEnd, 7)
  assert.equal(scenes[0].continuePreviousVisual, true)
  assert.equal(scenes[1].sourceId, "primary-source")
})

test("이어진 보도형 자료화면은 첫 화면 설정을 유지한다", () => {
  const scenes: NewsReportScene[] = [
    {
      id: "scene-1",
      narration: "첫 문장",
      visual: "source",
      sourceId: "source-a",
      sourceStart: 2,
      sourceEnd: 7,
      crop: { x: 40, y: 55, zoom: 1.2, faceTracking: false },
      fit: "contain",
      motion: "zoom-in",
    },
    {
      id: "scene-2",
      narration: "둘째 문장",
      visual: "source",
      sourceId: "source-b",
      sourceStart: 10,
      sourceEnd: 14,
      continuePreviousVisual: true,
    },
    {
      id: "scene-3",
      narration: "셋째 문장",
      visual: "source",
      sourceId: "source-c",
      sourceStart: 20,
      sourceEnd: 24,
    },
  ]

  const resolved = resolveReportVisualContinuations(scenes)
  assert.equal(resolved[1]?.sourceId, "source-a")
  assert.equal(resolved[1]?.sourceStart, 2)
  assert.deepEqual(resolved[1]?.crop, scenes[0]?.crop)
  assert.equal(resolved[1]?.motion, "zoom-in")
  assert.equal(resolved[2]?.sourceId, "source-c")
  assert.equal(
    reportVisualContinuationAnchor(scenes, "scene-2")?.id,
    "scene-1"
  )

  const separated = resolveReportVisualContinuations(
    scenes.map((scene) =>
      scene.id === "scene-2"
        ? { ...scene, continuePreviousVisual: false }
        : scene
    )
  )
  assert.equal(separated[1]?.sourceId, "source-b")
  assert.equal(separated[1]?.sourceStart, 10)
  assert.equal(
    reportVisualContinuationAnchor(separated, "scene-2")?.id,
    "scene-2"
  )
})

test("이어진 보도형 자료화면만 한 렌더 세그먼트로 묶는다", () => {
  const scenes = [
    {
      id: "scene-1",
      narration: "첫 문장",
      visual: "source" as const,
      sourceId: "source-a",
      sourceStart: 2,
      sourceEnd: 7,
      start: 0,
      end: 2,
      duration: 2,
    },
    {
      id: "scene-2",
      narration: "둘째 문장",
      visual: "source" as const,
      sourceId: "source-b",
      sourceStart: 10,
      sourceEnd: 14,
      continuePreviousVisual: true,
      start: 2,
      end: 5.25,
      duration: 3.25,
    },
    {
      id: "scene-3",
      narration: "셋째 문장",
      visual: "source" as const,
      sourceId: "source-c",
      sourceStart: 20,
      sourceEnd: 24,
      start: 5.25,
      end: 7,
      duration: 1.75,
    },
  ]

  const grouped = groupReportVisualContinuationSegments(scenes)
  assert.equal(grouped.length, 2)
  assert.equal(grouped[0]?.sourceId, "source-a")
  assert.equal(grouped[0]?.start, 0)
  assert.equal(grouped[0]?.end, 5.25)
  assert.equal(grouped[0]?.duration, 5.25)
  assert.equal(grouped[1]?.sourceId, "source-c")
  assert.equal(grouped[1]?.start, 5.25)
})

test("장면 재구성 시 구간별 crop을 보존한다", () => {
  const scenes = buildReportScenes(
    "첫 문장입니다. 두 번째 문장입니다.",
    transcript,
    10,
    30,
    [
      {
        id: "saved-scene",
        narration: "첫 문장입니다.",
        visual: "source",
        sourceId: "primary-source",
        sourceStart: 10,
        sourceEnd: 15,
        crop: { x: 30, y: 40, zoom: 1.4, faceTracking: false },
      },
    ],
    "primary-source"
  )
  assert.deepEqual(scenes[0].crop, {
    x: 30,
    y: 40,
    zoom: 1.4,
    faceTracking: false,
  })
  assert.equal(scenes[1].crop, undefined)
})

test("문장별 TTS 길이를 기준으로 자막 타임라인을 연속 배치한다", () => {
  const scenes = buildReportScenes(
    "첫 번째 문장입니다. 두 번째 문장에는 30만 명이 포함됩니다.",
    transcript,
    10,
    30
  )
  const subtitles = reportSubtitles(scenes, [2.5, 3.75])
  assert.equal(subtitles[0].start, 0)
  assert.equal(subtitles[0].end, 2.5)
  assert.equal(subtitles[1].start, 2.5)
  assert.equal(subtitles[1].end, 6.25)
  assert.deepEqual(subtitles[1].emphasis, ["30만"])
})

test("대본에 지정한 자연스러운 자막 호흡을 그대로 보존한다", () => {
  const script = [
    "인구 감소 지역 주민에게,",
    "월 15만 원씩 지역 상품권을 주는",
    "농어촌 기본소득 사업이",
    "내년부터 2년간 시범 시행됩니다.",
  ].join("\n")
  const phrases = reportCaptionPhrases(script)
  const scenes = buildReportScenes(script, transcript, 10, 30)
  const subtitles = reportSubtitles(scenes, undefined, phrases)

  assert.deepEqual(
    subtitles.map((subtitle) => subtitle.text),
    phrases
  )
  assert.ok(
    subtitles.every((subtitle) => subtitle.id.startsWith("report-phrase-"))
  )
  assert.equal(subtitles[0].start, 0)
  assert.equal(subtitles.at(-1)?.end, estimateReportScenesDuration(scenes))
})

test("보도 대본 길이로 자연스러운 TTS 예상 시간을 계산한다", () => {
  const duration = estimateReportDuration("가".repeat(260), -4)
  assert.ok(duration >= 45)
  assert.ok(duration <= 48)
})

test("직접 발언 장면은 TTS 분량이 아닌 원본 구간 길이를 사용한다", () => {
  const scenes = buildReportScenes(
    "짧은 직접 발언입니다. 이어서 아나운서가 설명합니다.",
    transcript,
    10,
    30
  )
  scenes[0] = {
    ...scenes[0],
    audioMode: "original",
    visualMode: "quote",
    visual: "quote",
    sourceStart: 12.25,
    sourceEnd: 18.75,
  }
  // 원본 6.5초 구간은 원배속 그대로 출력 길이가 된다.
  assert.equal(estimateReportScenesDuration([scenes[0]]), 6.5)
  const subtitles = reportSubtitles(scenes, [6.5, 3.25])
  assert.equal(subtitles[0].end, 6.5)
  assert.equal(subtitles[1].start, 6.5)
  assert.equal(subtitles[1].end, 9.75)
})

test("원문과 발화 길이가 맞는 직접 발언은 원본 음성을 유지한다", () => {
  const quoteTranscript: TranscriptSegment[] = [
    {
      id: "quote-1",
      text: "대통령이 내란 한다라는 것 자체가 넌센스 아닙니까?",
      start: 43,
      end: 48.4,
      speaker: "speaker-1",
      words: [],
    },
  ]
  const scene: NewsReportScene = {
    id: "quote-scene",
    narration: "대통령이 내란 한다라는 것 자체가 넌센스 아닙니까?",
    visual: "quote",
    sourceId: "primary",
    sourceStart: 43,
    sourceEnd: 48.4,
  }

  assert.equal(quoteNarrationMatchesTranscript(scene, quoteTranscript), true)
  assert.equal(
    normalizeQuoteScenes([scene], { primary: quoteTranscript }, "primary")[0]
      .visual,
    "quote"
  )
})

test("직접 발언 자막을 원본 자막 타임코드에 맞춘다", () => {
  const scene: NewsReportScene = {
    id: "quote-scene",
    narration: "대통령이 내란 한다라는 것 자체가 넌센스 아닙니까?",
    visual: "quote",
    sourceId: "primary",
    sourceStart: 43.239,
    sourceEnd: 51.84,
  }
  const quoteTranscript: TranscriptSegment[] = [
    {
      id: "quote-1",
      text: "대통령이 내란 한다라는 것 자체가 넌",
      start: 43.239,
      end: 48.36,
      speaker: "speaker-1",
      words: [],
    },
    {
      id: "quote-2",
      text: "센스 아닙니까?",
      start: 46.32,
      end: 51.84,
      speaker: "speaker-1",
      words: [],
    },
    {
      id: "next-sentence",
      text: "그날 저는 현장에서 변론할 때",
      start: 48.36,
      end: 54.16,
      speaker: "speaker-1",
      words: [],
    },
  ]

  const alignment = quoteTranscriptAlignment(scene, quoteTranscript)

  // 겹친 ASR 조각은 문장 단위로 이어 붙이고, 다음 문장과 시간이 겹치지 않게 정리한다.
  assert.equal(alignment.length, 1)
  assert.match(alignment[0]?.text ?? "", /넌\s*센스 아닙니까\?/)
  assert.equal(alignment[0]?.start, 0)
  assert.equal(alignment[0]?.end, 8.601)
  assert.equal(alignment[0]?.boundaryAfter, true)
})

test("선택 경계에 걸친 문장은 버리지 않고 범위 안의 완전한 단어부터 자막화한다", () => {
  const scene = {
    id: "buildup2-quote",
    narration: "",
    visual: "quote" as const,
    sourceStart: 177.79,
    sourceEnd: 183.11,
  }
  const alignment = quoteTranscriptAlignment(scene, [
    {
      id: "boundary",
      text: "범죄자 이재명의 감옥행을 막는 것입니다.",
      start: 177.09,
      end: 183.11,
      speaker: "speaker-1",
      words: [
        { text: "범죄자", start: 175.59, end: 177.79 },
        { text: "이재명의", start: 177.79, end: 179.83 },
        { text: "감옥행을", start: 179.83, end: 181.47 },
        { text: "막는", start: 181.47, end: 182.59 },
        { text: "것입니다.", start: 182.59, end: 183.11 },
      ],
    },
  ])

  assert.equal(alignment[0]?.text, "이재명의")
  assert.equal(alignment[0]?.start, 0)
  assert.equal(
    alignment.some((word) => word.text === "범죄자"),
    false
  )
  assert.equal(alignment.at(-1)?.end, 5.32)
})

test("겹친 전사 단어 타임스탬프를 섞지 않고 문장 순서를 유지한다", () => {
  const scene: NewsReportScene = {
    id: "buildup2-quote",
    narration: "",
    visual: "quote",
    sourceStart: 80,
    sourceEnd: 100,
  }
  const quoteTranscript: TranscriptSegment[] = [
    {
      id: "a",
      text: "2026년 11월 1일",
      start: 80,
      end: 86,
      speaker: "a",
      words: [
        { text: "2026년", start: 80, end: 82 },
        { text: "11월", start: 82, end: 84 },
        { text: "1일", start: 84, end: 86 },
      ],
    },
    {
      id: "b",
      text: "대한민국은 죽고",
      start: 83,
      end: 88,
      speaker: "a",
      words: [
        { text: "대한민국은", start: 83, end: 85 },
        { text: "죽고", start: 85, end: 88 },
      ],
    },
    {
      id: "c",
      text: "이재명만 살았습니다.",
      start: 86,
      end: 92,
      speaker: "a",
      words: [
        { text: "이재명만", start: 86, end: 89 },
        { text: "살았습니다.", start: 89, end: 92 },
      ],
    },
  ]
  const alignment = quoteTranscriptAlignment(scene, quoteTranscript)
  const joined = alignment.map((item) => item.text).join(" ")
  assert.match(joined, /2026년 11월 1일/)
  assert.match(joined, /대한민국은 죽고/)
  assert.match(joined, /이재명만 살았습니다/)
  assert.equal(joined.includes("11월 대한민국은"), false)
  for (let index = 1; index < alignment.length; index += 1) {
    assert.ok(alignment[index]!.start >= alignment[index - 1]!.end)
  }
})

test("문장 뒤 긴 호흡이 다음 첫 단어 길이로 잡히면 자막 시작을 보정한다", () => {
  const alignment = quoteTranscriptAlignment(
    {
      id: "long-leading-breath",
      narration: "",
      visual: "quote",
      sourceStart: 10,
      sourceEnd: 14,
    },
    [
      {
        id: "breath-1",
        speaker: "speaker-1",
        start: 10,
        end: 11,
        text: "이전 문장이 끝났습니다.",
        words: [
          { text: "이전", start: 10, end: 10.3 },
          { text: "문장이", start: 10.3, end: 10.6 },
          { text: "끝났습니다.", start: 10.6, end: 11 },
        ],
      },
      {
        id: "breath-2",
        speaker: "speaker-1",
        start: 11,
        end: 14,
        text: "공수처가 영장을 제시했습니다.",
        words: [
          { text: "공수처가", start: 11, end: 12.5 },
          { text: "영장을", start: 12.5, end: 13 },
          { text: "제시했습니다.", start: 13, end: 14 },
        ],
      },
    ]
  )

  const firstNextSentenceWord = alignment.find(
    (word) => word.text === "공수처가"
  )
  assert.equal(firstNextSentenceWord?.start, 1.8)
  assert.equal(firstNextSentenceWord?.end, 2.5)
})

test("요약 대본보다 원본 음성이 지나치게 긴 직접 발언은 TTS 장면으로 바꾼다", () => {
  const quoteTranscript: TranscriptSegment[] = [
    {
      id: "quote-1",
      text: "대통령이 내란 한다라는 것 자체가 넌센스 아닙니까?",
      start: 43.239,
      end: 51.84,
      speaker: "speaker-1",
      words: [],
    },
  ]
  const scene: NewsReportScene = {
    id: "quote-scene",
    narration: "대통령이 내란을 한다는 것 자체가 넌센스라고 주장했어.",
    visual: "quote",
    sourceId: "primary",
    sourceStart: 43.239,
    sourceEnd: 51.84,
  }

  assert.equal(quoteNarrationMatchesTranscript(scene, quoteTranscript), false)
  assert.equal(
    normalizeQuoteScenes([scene], { primary: quoteTranscript }, "primary")[0]
      .visual,
    "source"
  )
})

test("자막 원문을 확인할 수 없는 보조 자료의 직접 발언은 TTS 장면으로 바꾼다", () => {
  const scene: NewsReportScene = {
    id: "supporting-quote",
    narration: "직접 발언입니다.",
    visual: "quote",
    sourceId: "supporting",
    sourceStart: 10,
    sourceEnd: 13,
  }

  assert.equal(
    normalizeQuoteScenes([scene], { primary: transcript }, "primary")[0].visual,
    "source"
  )
})

test("일반 자료 화면은 직접 발언 검증과 관계없이 유지한다", () => {
  const scene: NewsReportScene = {
    id: "source-scene",
    narration: "아나운서가 설명하는 장면입니다.",
    visual: "source",
    sourceId: "supporting",
    sourceStart: 10,
    sourceEnd: 13,
  }

  assert.equal(normalizeQuoteScenes([scene], {}, "primary")[0], scene)
})

test("무음컷으로 나눈 빈 나레이션 직접 발언은 원본 음성 장면으로 유지한다", () => {
  const scene: NewsReportScene = {
    id: "buildup2-quote-cut-2",
    narration: "",
    visual: "quote",
    sourceId: "primary",
    sourceStart: 12,
    sourceEnd: 14,
  }

  assert.equal(
    normalizeQuoteScenes([scene], { primary: transcript }, "primary")[0].visual,
    "quote"
  )
})

test("무음컷 첫 조각에 원문 대본이 남아 있어도 TTS로 바꾸지 않는다", () => {
  const scene: NewsReportScene = {
    id: "buildup2-quote-cut-1",
    narration: "현직 대통령이 체포되어 갔습니다.",
    visual: "quote",
    sourceId: "primary",
    sourceStart: 12,
    sourceEnd: 14,
  }

  assert.equal(
    normalizeQuoteScenes([scene], { primary: transcript }, "primary")[0].visual,
    "quote"
  )
})

test("실제 장면별 오디오 길이에 맞춰 자막 싱크를 다시 계산한다", () => {
  const scenes = buildReportScenes(
    "첫 장면 설명입니다. 직접 발언을 확인합니다. 마지막 설명입니다.",
    transcript,
    10,
    30
  )
  scenes[1] = {
    ...scenes[1],
    audioMode: "original",
    visualMode: "quote",
    visual: "quote",
    sourceStart: 20,
    sourceEnd: 28,
  }
  const cues = reportSubtitles(scenes, [2, 3, 2])
  const timedScenes = [
    { ...scenes[0], start: 0, end: 2 },
    { ...scenes[1], start: 2, end: 10 },
    { ...scenes[2], start: 10, end: 12.5 },
  ]

  const retimed = retimeSubtitleCuesToScenes(cues, scenes, timedScenes)

  assert.equal(retimed[0].start, 0)
  assert.equal(retimed[0].end, 2)
  assert.equal(retimed[1].start, 2)
  assert.equal(retimed[1].end, 10)
  assert.equal(retimed[2].start, 10)
  assert.equal(retimed[2].end, 12.5)
  assert.deepEqual(
    retimed.map((cue) => cue.sceneId),
    scenes.map((scene) => scene.id)
  )
})

test("잠긴 자막은 재렌더해도 승인한 타임코드와 문구를 유지한다", () => {
  const scenes = [
    {
      id: "scene-1",
      narration: "첫 장면입니다.",
      visual: "source" as const,
      sourceId: "source-1",
      sourceStart: 0,
      sourceEnd: 5,
      crop: { x: 50, y: 50, zoom: 1.02, faceTracking: false },
    },
  ]
  const edited = [
    {
      id: "cue-1",
      sceneId: "scene-1",
      start: 1.2,
      end: 3.4,
      text: "오타 수정 후",
      emphasis: ["수정"],
      emphasisColor: "yellow" as const,
      edited: true,
    },
  ]
  const timedScenes = [{ ...scenes[0], start: 0, end: 5 }]
  const rendered = applySubtitleTimingForRender(edited, scenes, timedScenes, {
    lockTimings: true,
  })
  // 잠긴 자막은 승인한 구간과 문구를 모두 유지한다.
  assert.equal(rendered[0].start, 1.2)
  assert.equal(rendered[0].end, 3.4)
  assert.equal(rendered[0].text, "오타 수정 후")
  assert.deepEqual(rendered[0].emphasis, ["수정"])
})

test("잠긴 자막은 미리보기를 다시 만들어도 문구와 구간 개수를 유지한다", () => {
  const scenes = [
    {
      id: "scene-locked",
      narration: "첫 문장과 둘째 문장",
      visual: "source" as const,
      sourceId: "source-1",
      sourceStart: 0,
      sourceEnd: 4,
      crop: { x: 50, y: 50, zoom: 1.02, faceTracking: false },
    },
  ]
  const locked = [
    {
      id: "locked-1",
      sceneId: "scene-locked",
      start: 0,
      end: 1,
      text: "첫 문장",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "locked-2",
      sceneId: "scene-locked",
      start: 1,
      end: 4,
      text: "둘째 문장",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
  ]
  const rendered = applySubtitleTimingForRender(
    locked,
    scenes,
    [
      {
        ...scenes[0],
        start: 0,
        end: 8,
        alignment: [{ text: "전혀 다른 분할", start: 0, end: 8 }],
      },
    ],
    { lockTimings: true }
  )

  assert.deepEqual(
    rendered.map((cue) => [cue.id, cue.text]),
    [
      ["locked-1", "첫 문장"],
      ["locked-2", "둘째 문장"],
    ]
  )
  assert.equal(rendered[0]?.start, 0)
  assert.equal(rendered[0]?.end, 1)
  assert.equal(rendered[1]?.start, 1)
  assert.equal(rendered[1]?.end, 4)
})

test("보도형 잠긴 자막은 문구와 줄바꿈을 유지하며 실제 TTS 단어 시간에 붙는다", () => {
  const scene: NewsReportScene & {
    start: number
    end: number
    alignment: Array<{ text: string; start: number; end: number }>
  } = {
    id: "report-body-1",
    narration: "민주당 서울 의원을 전수조사한 결과",
    part: "body",
    audioMode: "tts",
    visualMode: "source",
    visual: "source",
    sourceStart: 0,
    sourceEnd: 4,
    start: 5,
    end: 9,
    alignment: [
      { text: "민주당", start: 0.2, end: 0.5 },
      { text: "서울", start: 0.6, end: 0.9 },
      { text: "의원을", start: 1, end: 1.4 },
      { text: "전수조사한", start: 1.8, end: 2.4 },
      { text: "결과", start: 2.5, end: 2.8 },
    ],
  }
  const locked = [
    {
      id: "locked-1",
      sceneId: scene.id,
      start: 5.5,
      end: 7.5,
      text: "민주당 서울\n의원을",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "locked-2",
      sceneId: scene.id,
      start: 7.5,
      end: 9,
      text: "전수조사한 결과",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
  ]

  const rendered = retimeLockedSubtitleCuesToSpeech(locked, [scene])

  assert.deepEqual(
    rendered.map((cue) => cue.text),
    ["민주당 서울\n의원을", "전수조사한 결과"]
  )
  assert.deepEqual(
    rendered.map((cue) => [cue.start, cue.end]),
    [
      [5.2, 6.4],
      [6.8, 7.8],
    ]
  )
})

test("연속 TTS 장면 경계는 숫자 발음이 늘어나도 다음 문장의 첫 어절에서 나뉜다", () => {
  const boundaries = continuousSpeechWordBoundaries(
    [
      "세제 개편안을 수정해야 한다는 의견이 30%였어.",
      "그대로 가야 한다는 쪽은 24%에 그쳤다는 거야.",
      "민주당 이언주 의원은 상황을 설명했어.",
    ],
    [
      "세제",
      "개편안을",
      "수정해야",
      "한다는",
      "의견이",
      "삼십",
      "퍼센트였어.",
      "그대로",
      "가야",
      "한다는",
      "쪽은",
      "이십사",
      "퍼센트에",
      "그쳤다는",
      "거야.",
      "민주당",
      "이언주",
      "의원은",
      "상황을",
      "설명했어.",
    ].map((text) => ({ text }))
  )

  assert.deepEqual(boundaries, [0, 7, 15, 20])
})

test("표시 숫자가 발음 어절로 늘어나도 검수 문구를 유지하며 단어 시간에 붙인다", () => {
  const scene: NewsReportScene & {
    start: number
    end: number
    alignment: Array<{ text: string; start: number; end: number }>
  } = {
    id: "numeric-scene",
    narration: "수정해야 한다는 의견이 30%였어.",
    part: "body",
    audioMode: "tts",
    visualMode: "source",
    visual: "source",
    sourceStart: 0,
    sourceEnd: 3,
    start: 0,
    end: 3,
    alignment: [
      { text: "수정해야", start: 0.1, end: 0.4 },
      { text: "한다는", start: 0.45, end: 0.75 },
      { text: "의견이", start: 0.8, end: 1.1 },
      { text: "삼십", start: 1.2, end: 1.5 },
      { text: "퍼센트였어.", start: 1.55, end: 2.3 },
    ],
  }
  const rendered = retimeLockedSubtitleCuesToSpeech(
    [
      {
        id: "numeric-1",
        sceneId: scene.id,
        start: 0,
        end: 1,
        text: "수정해야 한다는 의견이",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "numeric-2",
        sceneId: scene.id,
        start: 1,
        end: 3,
        text: "30%였어.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    [scene]
  )

  assert.deepEqual(
    rendered.map((cue) => [cue.text, cue.start, cue.end]),
    [
      ["수정해야 한다는 의견이", 0.1, 1.1],
      ["30%였어.", 1.2, 2.3],
    ]
  )
})

test("편집 문구 병합은 id·장면 순서로 맞춘다", () => {
  const timed = [
    {
      id: "a",
      sceneId: "s1",
      start: 0,
      end: 1,
      text: "원본A",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "b",
      sceneId: "s1",
      start: 1,
      end: 2,
      text: "원본B",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
  ]
  const edited = [
    {
      id: "a",
      sceneId: "s1",
      start: 9,
      end: 9.5,
      text: "수정A",
      emphasis: ["A"],
      emphasisColor: "yellow" as const,
      edited: true,
    },
    {
      id: "other",
      sceneId: "s1",
      start: 9.5,
      end: 10,
      text: "수정B",
      emphasis: [],
      emphasisColor: "yellow" as const,
      edited: true,
    },
  ]
  const merged = mergeEditedSubtitleText(timed, edited)
  assert.equal(merged[0].text, "수정A")
  assert.equal(merged[0].start, 0)
  assert.equal(merged[0].edited, true)
  assert.equal(merged[1].text, "수정B")
  assert.equal(merged[1].start, 1)
  assert.equal(merged[1].edited, true)
})

test("앞 자막이 추가되어 id 순서가 밀려도 원래 문구가 같은 수정본에만 적용한다", () => {
  const timed = [
    {
      id: "caption-1",
      sceneId: "quote",
      start: 0,
      end: 1,
      text: "새로 복구한 첫 문장",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "caption-2",
      sceneId: "quote",
      start: 1,
      end: 2,
      text: "기존 자동 문장",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
  ]
  const edited = [
    {
      // 이전 렌더에서는 같은 id가 두 번째 문장을 가리켰다.
      id: "caption-1",
      sceneId: "quote",
      start: 1,
      end: 2,
      text: "사용자가 고친 문장",
      emphasis: [],
      emphasisColor: "yellow" as const,
      edited: true,
      originalText: "기존 자동 문장",
      originalEmphasis: [],
    },
  ]

  const merged = mergeEditedSubtitleText(timed, edited)
  assert.equal(merged[0]?.text, "새로 복구한 첫 문장")
  assert.equal(merged[1]?.text, "사용자가 고친 문장")
  assert.equal(merged[1]?.start, 1)
})

test("락된 자막은 문구만 덮고 start/end를 유지한다", () => {
  const timed = [
    {
      id: "a",
      sceneId: "s1",
      start: 0,
      end: 1,
      text: "새타이밍",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
  ]
  const edited = [
    {
      id: "a",
      sceneId: "s1",
      start: 0.4,
      end: 1.2,
      text: "오타수정",
      emphasis: ["오타"],
      emphasisColor: "yellow" as const,
      edited: true,
    },
  ]
  const merged = mergeEditedSubtitleText(timed, edited, { preserveTimes: true })
  assert.equal(merged[0]?.text, "오타수정")
  assert.equal(merged[0]?.start, 0.4)
  assert.equal(merged[0]?.end, 1.2)
  assert.deepEqual(merged[0]?.emphasis, ["오타"])
  assert.equal(merged[0]?.edited, true)
})

test("음성 단어 타임스탬프는 읽기 좋은 자막 칸으로 묶는다", () => {
  const scenes = buildReportScenes(
    "첫 장면은 두 자막으로 설명합니다.",
    transcript,
    10,
    20
  )
  const cues = reportSubtitles(
    scenes,
    [3],
    ["첫 장면은", "두 자막으로 설명합니다."]
  )
  const timedScenes = [
    {
      ...scenes[0],
      start: 5,
      end: 8,
      alignment: [
        { text: "첫", start: 0.05, end: 0.35 },
        { text: "장면은", start: 0.45, end: 1 },
        { text: "두", start: 1.2, end: 1.45 },
        { text: "자막으로", start: 1.55, end: 2.25 },
        { text: "설명합니다", start: 2.35, end: 2.95 },
      ],
    },
  ]

  const retimed = retimeSubtitleCuesToScenes(cues, scenes, timedScenes)

  // 단어 5개가 아니라 호흡 단위로 묶인다.
  assert.ok(retimed.length >= 1 && retimed.length <= 3)
  assert.equal(retimed[0].start, 5.05)
  assert.match(retimed[0].text, /첫/)
  assert.ok(retimed[0].text.includes(" "))
  assert.ok(retimed.at(-1)!.end <= 8)
  assert.ok(retimed.every((cue) => cue.id.startsWith("speech-caption-")))
  assert.ok(retimed.every((cue) => cue.sourceStart === undefined))
  assert.ok(retimed.every((cue) => cue.sourceEnd === undefined))
})

test("원본 음성 실측 자막은 소스 영상의 절대 구간을 함께 보관한다", () => {
  const scene: NewsReportScene = {
    id: "quote-source-range",
    narration: "직접발언",
    audioMode: "original",
    visual: "quote",
    sourceStart: 20,
    sourceEnd: 22,
  }
  const [cue] = retimeSubtitleCuesToScenes([], [scene], [
    {
      ...scene,
      start: 5,
      end: 7,
      alignment: [{ text: "직접발언", start: 0.25, end: 1.5 }],
    },
  ])

  assert.equal(cue?.start, 5.25)
  assert.equal(cue?.end, 6.5)
  assert.equal(cue?.sourceStart, 20.25)
  assert.equal(cue?.sourceEnd, 21.5)
})

test("원본 전사의 문장 경계는 글자 수와 관계없이 자막 전환으로 유지한다", () => {
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "quote-sentence-boundaries",
      narration: "",
      visual: "quote",
      sourceStart: 0,
      sourceEnd: 4,
      start: 0,
      end: 4,
      alignment: [
        {
          text: "첫 문장은 여기서 끝나",
          start: 0,
          end: 1.8,
          boundaryAfter: true,
        },
        {
          text: "둘째 문장은 여기서 시작해",
          start: 1.9,
          end: 3.8,
          boundaryAfter: true,
        },
      ],
    },
    { maxCharacters: 40 }
  )

  assert.deepEqual(
    cues.map((cue) => cue.text),
    ["첫 문장은 여기서 끝나", "둘째 문장은 여기서 시작해"]
  )
  assert.equal(cues[0]?.start, 0)
  assert.equal(cues[0]?.end, 1.8)
  assert.equal(cues[1]?.start, 1.9)
  assert.equal(cues[1]?.end, 3.8)
})

test("검수 자막 병합은 다음 자막의 음성 시작점을 움직이지 않는다", () => {
  const scene = {
    id: "reviewed-quote-boundaries",
    narration: "",
    visual: "quote" as const,
    sourceStart: 10,
    sourceEnd: 18,
    start: 0,
    end: 8,
  }
  const reviewed: TranscriptSegment[] = [
    {
      id: "caption-3",
      speaker: "speaker-1",
      start: 10,
      end: 12,
      text: "대한민국은 죽고",
      captionBoundaryAfter: true,
      words: [
        { text: "대한민국은", start: 10.1, end: 10.9 },
        { text: "죽고", start: 11, end: 11.8 },
      ],
    },
    {
      id: "caption-4",
      speaker: "speaker-1",
      start: 12,
      end: 15,
      text: "이재명만 살았습니다.",
      captionBoundaryAfter: true,
      words: [
        { text: "이재명만", start: 12.1, end: 13.2 },
        { text: "살았습니다.", start: 13.3, end: 14.8 },
      ],
    },
    {
      id: "caption-5",
      speaker: "speaker-1",
      start: 15,
      end: 18,
      text: "공소취소 특권법은",
      captionBoundaryAfter: true,
      words: [
        { text: "공소취소", start: 15.1, end: 16.2 },
        { text: "특권법은", start: 16.3, end: 17.8 },
      ],
    },
  ]
  const before = subtitleCuesFromSpeechAlignment(
    { ...scene, alignment: quoteTranscriptAlignment(scene, reviewed) },
    { maxCharacters: 40 }
  )
  const mergedTranscript = mergeTranscriptSegmentWithNext(
    reviewed,
    "caption-3",
    "caption-4"
  )
  const after = subtitleCuesFromSpeechAlignment(
    {
      ...scene,
      alignment: quoteTranscriptAlignment(scene, mergedTranscript),
    },
    { maxCharacters: 40 }
  )

  assert.equal(before.length, 3)
  assert.equal(after.length, 2)
  assert.equal(after[0]?.start, before[0]?.start)
  assert.equal(after[0]?.end, before[1]?.end)
  assert.equal(after[1]?.start, before[2]?.start)
  assert.equal(after[1]?.end, before[2]?.end)
  assert.equal(after[1]?.text, before[2]?.text)
})

test("검수 본문은 실제 단어 시작점의 짧은 호흡으로 먼저 고정한다", () => {
  const source: TranscriptSegment[] = [
    {
      id: "long-source-sentence",
      speaker: "speaker-1",
      start: 10,
      end: 18,
      text: "2026년 11월 1일 대한민국은 죽고 이재명만 살았습니다.",
      words: [
        { text: "2026년", start: 10, end: 10.8 },
        { text: "11월", start: 10.9, end: 11.5 },
        { text: "1일", start: 11.6, end: 12.1 },
        { text: "대한민국은", start: 12.4, end: 13.3 },
        { text: "죽고", start: 13.4, end: 14 },
        { text: "이재명만", start: 14.5, end: 15.4 },
        { text: "살았습니다.", start: 15.5, end: 17.5 },
      ],
    },
  ]

  const captions = shortBreathReviewTranscript(
    source,
    { start: 10, end: 18 },
    10
  )

  assert.ok(captions.length >= 3)
  assert.ok(
    captions.every((segment) => segment.captionBoundarySource === "automatic")
  )
  assert.ok(
    captions.every(
      (segment) =>
        Math.abs(segment.start - (segment.words[0]?.start ?? segment.start)) <
        0.001
    )
  )
  assert.ok(
    captions
      .slice(0, -1)
      .every((segment, index) => segment.end === captions[index + 1]?.start)
  )
  assert.deepEqual(
    captions.flatMap((segment) => segment.words.map((word) => word.text)),
    source[0]!.words.map((word) => word.text)
  )

  const thirdBefore = structuredClone(captions[2])
  const merged = mergeTranscriptSegmentWithNext(
    captions,
    captions[0]!.id,
    captions[1]!.id
  )

  assert.deepEqual(merged[1], thirdBefore)
  assert.equal(merged[0]?.captionBoundarySource, "manual")
})

test("짧은 호흡은 두 줄 범위 안에서 문법 덩어리를 보존한다", () => {
  const cases = [
    {
      text: "범죄자 이재명의 모든 죄를 없애기 위한 법입니다.",
      forbiddenEnds: [/죄를$/u, /없애기$/u, /위한$/u],
    },
    {
      text: "장동혁 대표가 이재명 탈옥법이 나왔다고 분노해 하고 있어.",
      forbiddenEnds: [/대표가 이재명$/u, /이재명$/u],
    },
    {
      text: "인구 감소 지역 주민에게, 월 15만 원씩 지역 상품권을 주는 농어촌 기본소득 사업이 내년부터 2년간 시범 시행됩니다.",
      forbiddenEnds: [/15만$/u, /상품권을$/u, /농어촌$/u, /시범$/u],
    },
  ]

  for (const { text, forbiddenEnds } of cases) {
    const words = text.split(/\s+/).map((word, index) => ({
      text: word,
      start: index * 0.5,
      end: index * 0.5 + 0.4,
    }))
    const reviewed = shortBreathReviewTranscript(
      [
        {
          id: `natural-${words.length}`,
          speaker: "speaker-1",
          start: 0,
          end: words.length * 0.5,
          text,
          words,
        },
      ],
      { start: 0, end: words.length * 0.5 },
      13
    )
    const phrases = reviewed.map((segment) => segment.text)

    assert.equal(phrases.join(" "), text)
    assert.ok(
      phrases.every((phrase) =>
        forbiddenEnds.every((pattern) => !pattern.test(phrase))
      ),
      phrases.join(" / ")
    )
  }
})

test("명사형 -고와 목적 관형구를 짧고 자연스러운 호흡으로 나눈다", () => {
  const cases = [
    {
      text: "대형 사고 원인을 밝히기 위해 조사위원회가 현장에 도착했습니다.",
      expected: [
        "대형 사고 원인을 밝히기 위해",
        "조사위원회가 현장에 도착했습니다.",
      ],
      forbiddenEnd: /대형 사고$/u,
    },
    {
      text: "감옥에 있어야 할 이재명을 탈옥시키기 위한 법입니다.",
      expected: [
        "감옥에 있어야 할 이재명을",
        "탈옥시키기 위한 법입니다.",
      ],
      forbiddenEnd: /탈옥시키기 위한$/u,
    },
  ]

  for (const { text, expected, forbiddenEnd } of cases) {
    const words = text.split(/\s+/).map((word, index) => ({
      text: word,
      start: index * 0.45,
      end: index * 0.45 + 0.38,
    }))
    const reviewed = shortBreathReviewTranscript(
      [
        {
          id: `natural-boundary-${words.length}`,
          speaker: "speaker-1",
          start: 0,
          end: words.length * 0.45,
          text,
          words,
        },
      ],
      { start: 0, end: words.length * 0.45 },
      13
    )
    const phrases = reviewed.map((segment) => segment.text)

    assert.deepEqual(phrases, expected)
    assert.ok(phrases.every((phrase) => !forbiddenEnd.test(phrase)))
    assert.equal(phrases.join(" "), text)
  }
})

test("13자 안의 방향·목적·강조어는 자연스러운 연결을 유지한다", () => {
  const text = "밖으로 나가기 위해 어떠한 노력을 했나"
  const words = text.split(" ").map((word, index) => ({
    text: word,
    start: index * 0.5,
    end: index * 0.5 + 0.4,
  }))
  const reviewed = shortBreathReviewTranscript(
    [
      {
        id: "direction-purpose-emphasis",
        speaker: "speaker-1",
        start: 0,
        end: words.length * 0.5,
        text,
        words,
      },
    ],
    { start: 0, end: words.length * 0.5 },
    13
  )

  assert.deepEqual(
    reviewed.map((segment) => segment.text),
    ["밖으로 나가기 위해", "어떠한 노력을 했나"]
  )
})

test("선택 시작 전에 발음이 끝난 표시용 자막 tail은 본문에 포함하지 않는다", () => {
  const source: TranscriptSegment[] = [
    {
      id: "previous-caption",
      speaker: "speaker-1",
      text: "목격했습니다.",
      start: 67.7,
      end: 71.44,
      words: [{ text: "목격했습니다.", start: 67.7, end: 70.3 }],
    },
    {
      id: "selected-caption",
      speaker: "speaker-1",
      text: "2026년 11월 6일 대한민국 법치주의가 사망했습니다.",
      start: 70.64,
      end: 81,
      words: [
        { text: "2026년", start: 70.64, end: 72.04 },
        { text: "11월", start: 72.04, end: 73.44 },
        { text: "6일", start: 73.44, end: 73.94 },
        { text: "대한민국", start: 73.94, end: 76.74 },
        { text: "법치주의가", start: 76.74, end: 78.7 },
        { text: "사망했습니다.", start: 78.7, end: 81 },
      ],
    },
  ]
  const range = { start: 70.3, end: 81 }
  const reviewed = shortBreathReviewTranscript(source, range, 10)
  const scene = {
    id: "selected-quote",
    narration: "",
    audioMode: "original" as const,
    visual: "quote" as const,
    sourceStart: range.start,
    sourceEnd: range.end,
  }
  const aligned = quoteTranscriptAlignment(scene, reviewed)

  assert.ok(reviewed.some((segment) => segment.text.includes("2026년")))
  // 선택 범위 밖 원문은 보존하되 본문 정렬에는 들어오지 않아야 한다.
  assert.ok(reviewed.some((segment) => segment.text === "목격했습니다."))
  assert.equal(aligned[0]?.text, "2026년")
  assert.ok(aligned.every((unit) => unit.text !== "목격했습니다."))
})

test("경계 단어는 앞뒤 자막에 중복되지 않고 수정 문구만 렌더한다", () => {
  const source: TranscriptSegment[] = [
    {
      id: "source",
      speaker: "speaker-1",
      start: 0,
      end: 5,
      text: "우리를 분노케 한 것은 이재명입니다.",
      words: [
        { text: "우리를", start: 0, end: 0.7 },
        { text: "분노케", start: 0.8, end: 1.5 },
        { text: "한", start: 1.6, end: 1.8 },
        { text: "것은", start: 1.9, end: 2.4 },
        { text: "이재명입니다.", start: 2.5, end: 4.8 },
      ],
    },
  ]
  const captions = shortBreathReviewTranscript(source, { start: 0, end: 5 }, 10)
  const target = captions[1]!
  const edited = captions.map((segment) =>
    segment.id === target.id
      ? {
          ...updateTranscriptSegmentText(segment, "문제의 핵심은 이재명이야."),
          captionBoundaryAfter: true,
          captionBoundarySource: "manual" as const,
        }
      : segment
  )
  const reviewed = shortBreathReviewTranscript(edited, { start: 0, end: 5 }, 10)
  const scene = {
    id: "edited-review",
    narration: "",
    visual: "quote" as const,
    sourceStart: 0,
    sourceEnd: 5,
    start: 0,
    end: 5,
  }
  const rendered = subtitleCuesFromSpeechAlignment(
    { ...scene, alignment: quoteTranscriptAlignment(scene, reviewed) },
    { maxCharacters: 20 }
  )
  const renderedText = rendered.map((cue) => cue.text).join(" ")
  const wordKeys = reviewed.flatMap((segment) =>
    segment.words.map(
      (word) => `${word.text}:${word.start.toFixed(3)}:${word.end.toFixed(3)}`
    )
  )

  assert.equal(new Set(wordKeys).size, wordKeys.length)
  assert.match(renderedText, /문제의 핵심은 이재명이야\./u)
  assert.doesNotMatch(renderedText, /분노케 한 것은/u)
})

test("원본 자막은 첫 단어가 발음되는 타임코드에서 시작한다", () => {
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "word-aligned-quote",
      narration: "",
      visual: "quote",
      sourceStart: 10,
      sourceEnd: 14,
      start: 3,
      end: 7,
      alignment: [
        { text: "정부가", start: 0.72, end: 1.2 },
        { text: "발표했어", start: 1.35, end: 2.1 },
      ],
    },
    { maxCharacters: 20 }
  )

  assert.equal(cues[0]?.text, "정부가 발표했어")
  assert.equal(cues[0]?.start, 3.72)
  assert.equal(cues[0]?.end, 5.1)
})

test("독립 지시어 이는 앞말에 조사처럼 붙이지 않는다", () => {
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "standalone-i",
      narration: "",
      visual: "quote",
      sourceStart: 0,
      sourceEnd: 2,
      start: 0,
      end: 2,
      alignment: [
        { text: "위해", start: 0, end: 0.5 },
        { text: "이", start: 0.55, end: 0.8 },
        { text: "자리에", start: 0.85, end: 1.4 },
      ],
    },
    { maxCharacters: 20 }
  )

  assert.equal(cues.map((cue) => cue.text).join(" "), "위해 이 자리에")
})

test("연월일은 Whisper 구간 경계와 관계없이 한 자막으로 유지한다", () => {
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "calendar-date",
      narration: "",
      visual: "quote",
      sourceStart: 0,
      sourceEnd: 4,
      start: 10,
      end: 14,
      alignment: [
        { text: "2026년", start: 0.2, end: 1, boundaryAfter: true },
        { text: "11월", start: 1.05, end: 1.7, boundaryAfter: true },
        { text: "6일", start: 1.75, end: 2.4, boundaryAfter: true },
      ],
    },
    { maxCharacters: 10 }
  )

  assert.equal(cues.length, 1)
  assert.equal(cues[0]?.text, "2026년 11월 6일")
  assert.equal(cues[0]?.start, 10.2)
  assert.equal(cues[0]?.end, 12.4)
})

test("교정된 연설문을 문장 중심으로 나누고 실제 단어 시간만 사용한다", () => {
  const text =
    "2026년 11월 1일 대한민국은 죽고 이재명만 살았습니다. 공소취소 특권법은 딱 한 사람 오로지 이재명을 위한 법입니다. 범죄자 이재명의 모든 죄를 없애기 위한 법입니다. 감옥에 있어야 할 이재명을 탈옥시키기 위한 법입니다."
  const words = text.split(/\s+/)
  const alignment = words.map((word, index) => ({
    text: word,
    start: index * 0.42,
    end: index * 0.42 + 0.34,
    boundaryAfter: /[.!?]$/u.test(word),
  }))
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "corrected-speech",
      narration: "",
      visual: "quote",
      sourceStart: 0,
      sourceEnd: 30,
      start: 0,
      end: 30,
      alignment,
    },
    { maxCharacters: 26 }
  )

  assert.equal(cues[0]?.text, "2026년 11월 1일")
  assert.equal(cues[1]?.text, "대한민국은 죽고 이재명만 살았습니다.")
  assert.ok(
    cues.every((cue) => !/(?:한|오로지|위한|대한|따른)$/u.test(cue.text))
  )
  assert.equal(cues.map((cue) => cue.text).join(" "), text)
  const wordStarts = new Set(alignment.map((word) => roundTest(word.start)))
  const wordEnds = new Set(alignment.map((word) => roundTest(word.end)))
  assert.ok(cues.every((cue) => wordStarts.has(roundTest(cue.start))))
  assert.ok(cues.every((cue) => wordEnds.has(roundTest(cue.end))))
})

function roundTest(value: number) {
  return Math.round(value * 1000) / 1000
}

test("Whisper 내부 구간이 의미가 이어지는 자막을 갈라놓지 않는다", () => {
  const scene = {
    id: "semantic-whisper-boundary",
    narration: "",
    visual: "quote" as const,
    sourceStart: 10,
    sourceEnd: 16,
  }
  const alignment = quoteTranscriptAlignment(scene, [
    {
      id: "segment-1",
      speaker: "speaker-1",
      start: 10,
      end: 12,
      text: "현직 대통령을 체포를",
      words: [
        { text: "현직", start: 10, end: 10.35 },
        { text: "대통령을", start: 10.4, end: 11.1 },
        { text: "체포를", start: 11.2, end: 12 },
      ],
    },
    {
      id: "segment-2",
      speaker: "speaker-1",
      start: 12.08,
      end: 14.2,
      text: "하면서 도파민 터지는 장면을",
      words: [
        { text: "하면서", start: 12.08, end: 12.5 },
        { text: "도파민", start: 12.55, end: 13.05 },
        { text: "터지는", start: 13.1, end: 13.55 },
        { text: "장면을", start: 13.6, end: 14.2 },
      ],
    },
    {
      id: "segment-3",
      speaker: "speaker-1",
      start: 14.28,
      end: 16,
      text: "연출하려고 그런 짓을 했습니다.",
      words: [
        { text: "연출하려고", start: 14.28, end: 14.9 },
        { text: "그런", start: 14.95, end: 15.2 },
        { text: "짓을", start: 15.25, end: 15.55 },
        { text: "했습니다.", start: 15.6, end: 16 },
      ],
    },
  ])
  const cues = subtitleCuesFromSpeechAlignment(
    { ...scene, start: 0, end: 6, alignment },
    { maxCharacters: 20 }
  )

  assert.ok(cues.every((cue) => !/체포를$/u.test(cue.text)))
  assert.ok(cues.every((cue) => cue.text !== "했습니다."))
  assert.equal(
    cues.map((cue) => cue.text).join(" "),
    "현직 대통령을 체포를 하면서 도파민 터지는 장면을 연출하려고 그런 짓을 했습니다."
  )
})

test("원본 음성 자막은 글자 수가 아니라 한국어 의미 단위에서 전환한다", () => {
  const words =
    "인구 감소 지역 주민에게 , 월 15만 원씩 지역 상품권을 주는 농어촌 기본소득 사업이 내년부터 2년간 시범 시행됩니다 .".split(
      " "
    )
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "buildup2-quote",
      narration: "",
      visual: "quote",
      sourceStart: 0,
      sourceEnd: 10,
      start: 0,
      end: 10,
      alignment: words.map((text, index) => ({
        text,
        start: index * 0.35,
        end: index * 0.35 + 0.3,
      })),
    },
    { maxCharacters: 20 }
  )

  assert.deepEqual(
    cues.map((cue) => cue.text),
    [
      "인구 감소 지역 주민에게,",
      "월 15만 원씩 지역 상품권을 주는",
      "농어촌 기본소득 사업이",
      "내년부터 2년간 시범 시행됩니다.",
    ]
  )
  assert.ok(cues.every((cue) => !/^(?:만|은|는|이|가|을|를)\s/u.test(cue.text)))
})

test("원본 자막은 부사와 뒤에 이어지는 목적어 사이를 가르지 않는다", () => {
  const words = "그 장면을 찍으려고 위법하게 촬영을 계속하고 있었어요.".split(
    " "
  )
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "adverb-object-boundary",
      narration: "",
      visual: "quote",
      sourceStart: 0,
      sourceEnd: 5,
      start: 0,
      end: 5,
      alignment: words.map((text, index) => ({
        text,
        start: index * 0.5,
        end: index * 0.5 + 0.4,
      })),
    },
    { maxCharacters: 20 }
  )

  assert.ok(cues.every((cue) => !/위법하게$/u.test(cue.text)))
  assert.equal(
    cues.map((cue) => cue.text).join(" "),
    "그 장면을 찍으려고 위법하게 촬영을 계속하고 있었어요."
  )
})

test("짧은 호흡이어도 조사와 의존 서술어 사이를 가르지 않는다", () => {
  const words =
    "오늘 우리는 이재명 맞서 대한민국을 지키는 것은 이재명입니다.".split(" ")
  const cues = subtitleCuesFromSpeechAlignment(
    {
      id: "dependent-predicate-boundary",
      narration: "",
      visual: "quote",
      sourceStart: 0,
      sourceEnd: 8,
      start: 0,
      end: 8,
      alignment: words.map((text, index) => ({
        text,
        start: index * 0.45,
        end: index * 0.45 + 0.38,
      })),
    },
    { maxCharacters: 18 }
  )

  assert.ok(cues.every((cue) => !/이재명$/u.test(cue.text)))
  assert.ok(cues.some((cue) => /이재명 맞서/.test(cue.text)))
  assert.equal(cues.map((cue) => cue.text).join(" "), words.join(" "))
})

test("장면 정보가 없는 기존 자막도 문장 순서로 장면 싱크를 복원한다", () => {
  const scenes = buildReportScenes(
    "첫 장면은 두 자막으로 설명합니다. 직접 발언은 길게 이어집니다.",
    transcript,
    10,
    30
  )
  const legacyCues = [
    {
      id: "report-phrase-1",
      start: 0,
      end: 1,
      text: "첫 장면은",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "report-phrase-2",
      start: 1,
      end: 2,
      text: "두 자막으로 설명합니다.",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
    {
      id: "report-phrase-3",
      start: 2,
      end: 4,
      text: "직접 발언은 길게 이어집니다.",
      emphasis: [],
      emphasisColor: "yellow" as const,
    },
  ]
  const timedScenes = [
    { ...scenes[0], start: 0, end: 3 },
    { ...scenes[1], start: 3, end: 11 },
  ]

  const retimed = retimeSubtitleCuesToScenes(legacyCues, scenes, timedScenes)

  assert.equal(retimed[1].end, 3)
  assert.equal(retimed[2].start, 3)
  assert.equal(retimed[2].end, 11)
  assert.equal(retimed[2].sceneId, scenes[1].id)
})

test("선택한 이슈의 핵심어를 반영해 자연스러운 마지막 질문을 만든다", () => {
  const issueCta = contextualEndCtaText("민주당 조작기소 특검법 논란", [
    "조작기소",
    "특검법",
  ])
  assert.match(issueCta, /^조작기소에 대해 어떻게 생각해\?/)
  assert.match(issueCta, /댓글로 남겨줘/)

  const personCta = contextualEndCtaText("김계리 발언 논란", ["김계리"])
  assert.match(personCta, /^김계리의 의견에 어떻게 생각해\?/)
})

test("댓글 유도 문구는 본편 다음 별도 장면으로 분리한다", () => {
  const script = ensureReportEndCta(
    "지원 대상과 재원 부담을 함께 봐야 해.",
    "농어촌 기본소득 논란",
    ["농어촌 기본소득"]
  )
  const { body, cta } = splitEndCtaFromScript(script)
  const scenes = appendEndCtaScenes(
    buildReportScenes(body, transcript, 10, 25),
    cta
  )
  const subtitles = reportSubtitles(
    scenes,
    undefined,
    reportCaptionPhrases(body)
  )

  assert.match(script, /댓글로 남겨줘\.$/)
  assert.equal(scenes.at(-1)?.id, "end-cta")
  assert.match(scenes.at(-1)?.narration ?? "", /댓글/)
  assert.ok(scenes.slice(0, -1).every((scene) => !/댓글/.test(scene.narration)))
  assert.match(subtitles.at(-1)?.text ?? "", /댓글/)
  assert.ok(subtitles.at(-1)?.id.startsWith("end-cta"))
  assert.equal(ensureReportEndCta(script, "다른 제목"), script)
})

test("문장부호 없는 서두와 마무리 CTA를 줄 단위로 분리한다", () => {
  const script = [
    "예산은 늘었다는데, 현장 얘기는 정반대야",
    "조작기소에 대해 어떻게 생각해?",
    "댓글로 남겨줘.",
  ].join("\n")
  const { body, cta } = splitEndCtaFromScript(script)
  assert.equal(body, "예산은 늘었다는데, 현장 얘기는 정반대야")
  assert.equal(cta, "조작기소에 대해 어떻게 생각해?\n댓글로 남겨줘.")
  assert.doesNotMatch(cta, /예산은/)
})

test("마무리 장면에 서두가 섞여 있어도 CTA만 골라낸다", () => {
  const polluted =
    "이 말, 앞뒤가 안 맞아.\n김계리의 의견에 어떻게 생각해?\n댓글로 남겨줘."
  const { body, cta } = splitEndCtaFromScript(polluted)
  assert.equal(body, "이 말, 앞뒤가 안 맞아.")
  assert.equal(cta, "김계리의 의견에 어떻게 생각해?\n댓글로 남겨줘.")
})

test("이미 있는 마무리 장면의 구간·크롭은 다시 붙일 때 유지한다", () => {
  const body = buildReportScenes(
    "지원 대상과 재원 부담을 함께 봐야 해.",
    transcript,
    10,
    25
  )
  const first = appendEndCtaScenes(body, "어떻게 생각해?\n댓글로 남겨줘.")
  const edited = first.map((scene) =>
    scene.id === "end-cta"
      ? {
          ...scene,
          sourceStart: 12,
          sourceEnd: 18,
          crop: { x: 40, y: 30, zoom: 1.25, faceTracking: false },
          fit: "contain" as const,
          motion: "pan-left" as const,
        }
      : scene
  )
  const again = appendEndCtaScenes(edited, "어떻게 생각해?\n댓글로 남겨줘.")
  const cta = again.at(-1)

  assert.equal(cta?.id, "end-cta")
  assert.equal(cta?.sourceStart, 12)
  assert.equal(cta?.sourceEnd, 18)
  assert.deepEqual(cta?.crop, {
    x: 40,
    y: 30,
    zoom: 1.25,
    faceTracking: false,
  })
  assert.equal(cta?.fit, "contain")
  assert.equal(cta?.motion, "pan-left")
})

test("직접발언 장면에 마무리 멘트 자막이 흘러들어가지 않는다", () => {
  const phrases = [
    "국민이 진실이라고 믿던 그 보도,",
    "알고 보니 불러주는 대로 받아쓴 거라는데?",
    "언론한테 반성하라는 이 발언, 직접 들어봐.",
    "김계리 발언에 대해 어떻게 생각해?",
    "댓글로 의견 남겨줘.",
  ]
  const quoteTranscript: TranscriptSegment[] = [
    {
      id: "q1",
      text: "공수처가 현직 대통령을 체포하는 장면을 연출한다",
      start: 20,
      end: 28,
      speaker: "speaker-1",
      words: [
        { text: "공수처가", start: 20, end: 21.5, speaker: "speaker-1" },
        { text: "현직", start: 21.5, end: 22.2, speaker: "speaker-1" },
        { text: "대통령을", start: 22.2, end: 23.5, speaker: "speaker-1" },
        { text: "체포하는", start: 23.5, end: 25, speaker: "speaker-1" },
        { text: "장면을", start: 25, end: 26, speaker: "speaker-1" },
        { text: "연출한다", start: 26, end: 28, speaker: "speaker-1" },
      ],
    },
  ]
  const scenes = [
    {
      id: "buildup2-lead",
      narration: phrases.slice(0, 3).join("\n"),
      visual: "source" as const,
      sourceStart: 10,
      sourceEnd: 13,
    },
    {
      id: "buildup2-quote",
      narration: "",
      visual: "quote" as const,
      sourceStart: 20,
      sourceEnd: 70,
    },
    {
      id: "end-cta",
      narration: phrases.slice(3).join("\n"),
      visual: "source" as const,
      sourceStart: 68,
      sourceEnd: 70,
    },
  ]
  const subtitles = reportSubtitles(
    scenes,
    [9, 50, 4],
    phrases,
    quoteTranscript
  )
  const quoteSubs = subtitles.filter((cue) => cue.sceneId === "buildup2-quote")
  const ctaSubs = subtitles.filter((cue) => cue.sceneId === "end-cta")

  assert.ok(quoteSubs.every((cue) => !/댓글|어떻게 생각/.test(cue.text)))
  assert.ok(quoteSubs.some((cue) => /공수처|대통령/.test(cue.text)))
  assert.ok(ctaSubs.some((cue) => /댓글/.test(cue.text)))
})
