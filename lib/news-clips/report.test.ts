import assert from "node:assert/strict"
import test from "node:test"

import {
  bodyDurationWithEndCta,
  buildReportScenes,
  contextualEndCtaText,
  estimateReportDuration,
  estimateReportScenesDuration,
  reportCaptionPhrases,
  reportSubtitles,
  retimeSubtitleCuesToScenes,
  withEndCta,
} from "./report.ts"
import type { TranscriptSegment } from "./types.ts"

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
  assert.equal(scenes[1].visual, "source")
  assert.equal(scenes[2].visual, "source")
  assert.ok(scenes[1].sourceStart >= 10)
  assert.ok(scenes[1].sourceEnd <= 30)
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
      },
    ],
    "primary-source"
  )
  assert.equal(scenes[0].sourceId, "supporting-source")
  assert.equal(scenes[0].sourceStart, 2)
  assert.equal(scenes[0].sourceEnd, 7)
  assert.equal(scenes[1].sourceId, "primary-source")
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
    visual: "quote",
    sourceStart: 12.25,
    sourceEnd: 18.75,
  }
  assert.equal(estimateReportScenesDuration([scenes[0]]), 6.5)
  const subtitles = reportSubtitles(scenes, [6.5, 3.25])
  assert.equal(subtitles[0].end, 6.5)
  assert.equal(subtitles[1].start, 6.5)
  assert.equal(subtitles[1].end, 9.75)
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

test("Typecast 단어 타임스탬프를 자막 경계에 우선 적용한다", () => {
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

  assert.equal(retimed[0].start, 5)
  assert.equal(retimed[0].end, 6.2)
  assert.equal(retimed[1].start, 6.2)
  assert.equal(retimed[1].end, 8)
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

test("마지막 일반 자막과 겹치지 않게 댓글 유도 문구를 자동 배치한다", () => {
  const subtitles = withEndCta(
    [
      {
        id: "report-caption-1",
        start: 0,
        end: 10,
        text: "마지막 결론입니다.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    10
  )
  const cta = subtitles.at(-1)
  assert.equal(cta?.id, "end-cta-action")
  assert.match(cta?.text ?? "", /댓글/)
  assert.equal(subtitles[0].end, subtitles.at(-2)?.start)
  assert.equal(cta?.end, 10)
  assert.equal(
    withEndCta(subtitles, 10).filter((cue) => cue.id.startsWith("end-cta"))
      .length,
    2
  )
})

test("댓글 유도 자막은 발화가 끝난 뒤 별도 구간에 표시한다", () => {
  const narrationDuration = 10
  const outputDuration = bodyDurationWithEndCta(narrationDuration)
  const subtitles = withEndCta(
    [
      {
        id: "report-caption-1",
        start: 0,
        end: narrationDuration,
        text: "마지막 발화까지 자막이 일치합니다.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    outputDuration,
    "쟁점, 어떻게 봐?\n댓글로 의견 남겨줘.",
    narrationDuration
  )

  assert.equal(subtitles[0].end, narrationDuration)
  assert.equal(subtitles[1].start, narrationDuration)
  assert.equal(subtitles.at(-1)?.end, outputDuration)
})

test("선택한 이슈의 핵심어를 반영해 자연스러운 마지막 질문을 만든다", () => {
  const cta = contextualEndCtaText("민주당 조작기소 특검법 논란", [
    "민주당",
    "조작기소",
    "특검법",
  ])
  assert.match(cta, /^조작기소, 어떻게 봐\?/)
  assert.match(cta, /댓글로 의견 남겨줘/)
})
