import assert from "node:assert/strict"
import test from "node:test"

import { buildSubtitles } from "./subtitles.ts"
import {
  fitTitleToLineLayouts,
  fitTitleToTwoLines,
  layoutTimedSubtitleCues,
  normalizeSubtitleCues,
  resetEditedSubtitleCue,
  updateEditedSubtitleCue,
  retimeSubtitleCues,
  resolveTextBox,
  splitIntroTitleLines,
  splitIntoSubtitleChunks,
  titleLineCharacterLimit,
  titleLineFontSize,
  titleLineFits,
  titleLineRenderMetrics,
} from "./text-layout.ts"
import { parseTranscript } from "./transcript.ts"
import { defaultNewsClipSettings } from "./types.ts"

test("SRT 시간 코드와 단어 시간을 읽는다", () => {
  const segments = parseTranscript(`1
00:00:10,000 --> 00:00:12,000
세금이 20% 늘었습니다.

2
00:00:13,000 --> 00:00:15,000
국민 부담으로 이어집니다.`)
  assert.equal(segments.length, 2)
  assert.equal(segments[0].start, 10)
  assert.equal(segments[1].end, 15)
  assert.ok(segments[0].words.length > 0)
})

test("Whisper JSON의 실제 단어 타임스탬프를 그대로 보존한다", () => {
  const segments = parseTranscript(
    JSON.stringify({
      format: "shortsfactory-word-timestamps-v1",
      segments: [
        {
          start: 1,
          end: 2.4,
          text: "예산이 늘었어",
          words: [
            { word: "예산이", start: 1.08, end: 1.55, probability: 0.97 },
            { word: "늘었어", start: 1.62, end: 2.31, probability: 0.94 },
          ],
        },
      ],
    })
  )

  assert.equal(segments.length, 1)
  assert.equal(segments[0]?.words[0]?.start, 1.08)
  assert.equal(segments[0]?.words[1]?.end, 2.31)
  assert.equal(segments[0]?.words[0]?.confidence, 0.97)
})

test("겹치는 롤링 SRT 구간을 순차 타임라인으로 정리한다", () => {
  const segments = parseTranscript(`1
00:00:23,920 --> 00:00:28,800
오늘 우리는

2
00:00:26,199 --> 00:00:31,320
이재명 독재 정권의`)

  assert.equal(segments.length, 2)
  assert.equal(segments[0]?.end, segments[1]?.start)
  assert.ok(segments[0]!.end <= segments[1]!.start)
})

test("삭제된 시간을 반영해 자막을 다시 맞춘다", () => {
  const segments = parseTranscript(`1
00:00:10,000 --> 00:00:12,000
세금이 20% 늘었습니다.

2
00:00:14,000 --> 00:00:16,000
국민 피해가 커집니다.`)
  const captions = buildSubtitles(segments, [
    { sourceStart: 10, sourceEnd: 12, outputStart: 0, outputEnd: 2 },
    { sourceStart: 14, sourceEnd: 16, outputStart: 2, outputEnd: 4 },
  ])
  assert.ok(captions.length >= 2)
  assert.equal(captions.at(-1)?.end, 4)
  assert.ok(captions.flatMap((caption) => caption.emphasis).includes("20%"))
})

test("인트로 제목은 의미가 분리된 두 개의 한 줄 제목으로 맞춘다", () => {
  const original = "세금 인상 배경\n국민 부담 두 배"
  const fitted = fitTitleToTwoLines(
    original,
    defaultNewsClipSettings.titleCardText
  )
  const lines = splitIntroTitleLines(
    fitted,
    defaultNewsClipSettings.titleCardText
  )

  assert.equal(fitted, original)
  assert.deepEqual(lines, ["세금 인상 배경", "국민 부담 두 배"])
})

test("사용자가 수정한 인트로 제목은 두 단으로 유지한다", () => {
  const title = "농어촌 기본소득!\n지방 재정 예산 비상!!"
  const lines = splitIntroTitleLines(
    title,
    defaultNewsClipSettings.titleCardText
  )

  assert.deepEqual(lines, ["농어촌 기본소득!", "지방 재정 예산 비상!!"])
})

test("인트로 각 단은 설정한 글자 크기를 그대로 쓴다", () => {
  const layout = {
    ...defaultNewsClipSettings.titleCardText,
    fontSize: 150,
    letterSpacing: -4,
    width: 972,
  }
  const fitted = titleLineFontSize("지방 재정 예산 비상!!", layout, 0.35)

  const metrics = titleLineRenderMetrics("지방 재정 예산 비상!!", layout, 0.35)
  assert.equal(fitted, layout.fontSize)
  assert.equal(metrics.scaleX, 1)
  assert.equal(titleLineCharacterLimit(layout), 6)
  assert.equal(titleLineFits("지방 재정 예산 비상!!", layout), false)
  assert.equal(titleLineFits("예산 비상!!", layout), true)
})

test("제목 허용 글자 수는 폭·크기·자간 변경을 함께 반영한다", () => {
  const base = {
    ...defaultNewsClipSettings.titleCardText,
    fontSize: 100,
    letterSpacing: 0,
    width: 1008,
  }

  // width 설정값을 그대로 반영해 글자 수를 계산한다.
  assert.equal(titleLineCharacterLimit(base), 9)
  assert.equal(titleLineCharacterLimit({ ...base, fontSize: 125 }), 7)
  assert.equal(titleLineCharacterLimit({ ...base, width: 808 }), 7)
  assert.equal(titleLineCharacterLimit({ ...base, letterSpacing: 10 }), 8)
})

test("자동 제목은 1단과 2단의 서로 다른 크기에 맞춰 짧게 쓴다", () => {
  const firstLayout = {
    ...defaultNewsClipSettings.titleCardText,
    fontSize: 114,
    letterSpacing: -4,
    width: 972,
  }
  const secondLayout = { ...firstLayout, fontSize: 150 }
  const fitted = fitTitleToLineLayouts(
    "농어촌 기본소득!\n지방 재정 예산 비상!!",
    firstLayout,
    secondLayout
  )
  const [firstLine, secondLine] = splitIntroTitleLines(fitted, firstLayout)

  assert.equal(firstLine, "농어촌 기본소득!")
  assert.equal(secondLine, "예산 비상!!")
  assert.equal(titleLineFits(firstLine, firstLayout), true)
  assert.equal(titleLineFits(secondLine, secondLayout), true)
})

test("원본 음성 자막은 합치지 않고 타임코드를 유지한다", () => {
  const cues = normalizeSubtitleCues(
    [
      {
        id: "quote-caption-buildup2-quote-1",
        sceneId: "buildup2-quote",
        start: 3.2,
        end: 4.1,
        text: "공수처가 현직",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "quote-caption-buildup2-quote-2",
        sceneId: "buildup2-quote",
        start: 4.1,
        end: 5.4,
        text: "대통령을 체포",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "end-cta-1",
        sceneId: "end-cta",
        start: 20,
        end: 22,
        text: "댓글로 남겨줘",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    defaultNewsClipSettings.bodySubtitleText
  )

  assert.equal(cues.length, 3)
  assert.equal(cues[0]?.start, 3.2)
  assert.equal(cues[0]?.end, 4.1)
  assert.equal(cues[1]?.start, 4.1)
  assert.equal(cues[1]?.end, 5.4)
  assert.equal(cues[2]?.start, 20)
})

test("긴 본문 자막은 자연스러운 의미 단위와 최대 두 줄로 나눈다", () => {
  const cues = normalizeSubtitleCues(
    [
      {
        id: "caption-long",
        start: 0,
        end: 8,
        text: "정부는 세금을 올렸습니다. 국민 부담은 예상보다 훨씬 커졌습니다. 기업과 일자리에도 직접적인 영향이 이어지고 있습니다.",
        emphasis: ["세금", "국민 부담", "일자리"],
        emphasisColor: "yellow",
      },
    ],
    defaultNewsClipSettings.bodySubtitleText
  )

  assert.ok(cues.length >= 2)
  assert.equal(cues[0].start, 0)
  assert.equal(cues.at(-1)?.end, 8)
  assert.ok(cues.every((cue) => cue.text.split("\n").length <= 2))
  assert.ok(
    cues.every((cue, index) => index === 0 || cue.start >= cues[index - 1].end)
  )
})

test("한 줄을 넘는 문장은 단어를 보존한 두 줄 자막으로 구성한다", () => {
  const cues = normalizeSubtitleCues(
    [
      {
        id: "caption-sentences",
        start: 0,
        end: 6,
        text: "정부가 대책을 발표했습니다. 시행 시점은 아직 정해지지 않았습니다.",
        emphasis: ["정부"],
        emphasisColor: "yellow",
      },
    ],
    defaultNewsClipSettings.bodySubtitleText
  )

  assert.equal(cues.length, 2)
  assert.equal(cues[0].text.replace(/\n/g, " "), "정부가 대책을 발표했습니다.")
  assert.equal(
    cues[1].text.replace(/\n/g, " "),
    "시행 시점은 아직 정해지지 않았습니다."
  )
  assert.ok(cues.every((cue) => cue.text.split("\n").length <= 2))
  assert.equal(cues[0].start, 0)
  assert.equal(cues[1].end, 6)
})

test("실제 글리프 폭으로 들어가는 짧은 문장은 한 줄로 유지한다", () => {
  const cues = normalizeSubtitleCues(
    [
      {
        id: "caption-one-line",
        start: 0,
        end: 2,
        text: "2년간 시범 시행됩니다.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    {
      ...defaultNewsClipSettings.bodySubtitleText,
      fontSize: 58,
      letterSpacing: 0,
      width: 1037,
    }
  )

  assert.equal(cues.length, 1)
  assert.equal(cues[0].text, "2년간 시범 시행됩니다.")
})

test("첫 미리보기 자막은 수정 여유를 위해 한 줄 최대 폭의 80%만 사용한다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    fontSize: 58,
    letterSpacing: 0,
    width: 1037,
  }
  const cues = normalizeSubtitleCues(
    [
      {
        id: "caption-with-editing-room",
        start: 0,
        end: 3,
        text: "정부정책변화이지역경제와일자리에미치는영향",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    layout
  )
  const automaticLimit = Math.floor(titleLineCharacterLimit(layout) * 0.8)

  assert.ok(cues.length >= 1)
  assert.ok(
    cues.every((cue) =>
      cue.text.split("\n").every((line) => [...line].length <= automaticLimit)
    )
  )
})

test("사용자가 제거한 불필요한 줄바꿈은 편집 완료 후 다시 생기지 않는다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    fontSize: 58,
    letterSpacing: 0,
    width: 1037,
  }
  const original = [
    {
      id: "caption-7",
      start: 12,
      end: 15,
      text: "이 결정은\n논란을 키웠습니다.",
      emphasis: ["논란"],
      emphasisColor: "yellow" as const,
    },
  ]

  const updated = updateEditedSubtitleCue(
    original,
    "caption-7",
    "2년간 시범 시행됩니다.",
    layout
  )

  assert.equal(updated[0].text, "2년간 시범 시행됩니다.")
  assert.equal(updated[0].text.includes("\n"), false)
  assert.equal(updated[0].start, 12)
  assert.deepEqual(updated[0].emphasis, ["논란"])
})

test("자막 수정 시 사용자가 넣은 줄바꿈을 유지한다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    fontSize: 58,
    letterSpacing: 0,
    width: 1037,
  }
  const updated = updateEditedSubtitleCue(
    [
      {
        id: "caption-lead-1",
        start: 0,
        end: 2,
        text: "이전 문구",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    "caption-lead-1",
    "예산은 늘었다는데,\n현장 얘기는 정반대야.",
    layout
  )
  assert.equal(updated[0]?.text, "예산은 늘었다는데,\n현장 얘기는 정반대야.")
})

test("자막별 초기화는 자동 생성 문구와 강조를 복원한다", () => {
  const layout = defaultNewsClipSettings.bodySubtitleText
  const original = [
    {
      id: "caption-reset-1",
      start: 0,
      end: 2,
      text: "자동 생성 자막",
      emphasis: ["자동"],
      emphasisColor: "yellow" as const,
    },
  ]
  const edited = updateEditedSubtitleCue(
    original,
    "caption-reset-1",
    "사용자가 수정한 자막",
    layout
  )
  const reset = resetEditedSubtitleCue(edited, "caption-reset-1")

  assert.equal(reset[0]?.text, "자동 생성 자막")
  assert.deepEqual(reset[0]?.emphasis, ["자동"])
  assert.equal(reset[0]?.edited, false)
})

test("빈 자막 수정은 구간을 삭제하지 않고 자동 문구로 초기화한다", () => {
  const layout = defaultNewsClipSettings.bodySubtitleText
  const edited = updateEditedSubtitleCue(
    [
      {
        id: "caption-empty-1",
        start: 1,
        end: 3,
        text: "사라지면 안 되는 자막",
        emphasis: [],
        emphasisColor: "yellow" as const,
      },
    ],
    "caption-empty-1",
    "",
    layout
  )

  assert.equal(edited[0]?.text, "사라지면 안 되는 자막")
  assert.equal(edited[0]?.start, 1)
  assert.equal(edited[0]?.end, 3)
  assert.equal(edited[0]?.edited, false)
})

test("여유 폭으로 나눈 자막도 자연스러운 절 경계를 우선한다", () => {
  const cues = layoutTimedSubtitleCues(
    [
      {
        id: "caption-natural-break",
        start: 0,
        end: 3,
        text: "예산은 늘었다는데, 현장 얘기는 정반대야.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    {
      ...defaultNewsClipSettings.bodySubtitleText,
      width: 700,
      fontSize: 58,
    }
  )

  assert.equal(cues.length, 2)
  assert.equal(cues[0]?.text.replace(/\n/g, " "), "예산은 늘었다는데,")
  assert.equal(cues[1]?.text.replace(/\n/g, " "), "현장 얘기는 정반대야.")
})

test("짧은 문장도 단어를 자르지 않는 한 줄 자막으로 유지한다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    width: 464,
    fontSize: 58,
  }
  const chunks = splitIntoSubtitleChunks(
    "정부 정책 변화 이후 국민 부담 증가 우려가 계속 커지고 있습니다. 끝입니다.",
    layout
  )

  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every((chunk) => !chunk.includes("\n")))
  assert.ok(chunks.at(-1)?.endsWith("끝입니다."))
})

test("숫자 뒤 조사를 다음 자막으로 분리하지 않는다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    width: 540,
    fontSize: 96,
  }
  const cues = normalizeSubtitleCues(
    [
      {
        id: "caption-particle-1",
        start: 0,
        end: 1.8,
        text: "다만 정부는 사업비의 40%",
        emphasis: ["40%"],
        emphasisColor: "yellow",
      },
      {
        id: "caption-particle-2",
        start: 1.8,
        end: 4,
        text: "만 지원해 나머지 60%는 부담합니다.",
        emphasis: ["60%"],
        emphasisColor: "yellow",
      },
    ],
    layout
  )

  assert.ok(cues.some((cue) => cue.text.includes("40%만")))
  assert.ok(
    cues.every((cue) => !cue.text.replace(/\n/g, " ").startsWith("만 "))
  )
  assert.ok(cues.every((cue) => cue.text.split("\n").length <= 2))
})

test("실측 싱크 자막은 합치지 않고 줄바꿈만 다시 맞춘다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    width: 972,
    fontSize: 58,
  }
  const cues = layoutTimedSubtitleCues(
    [
      {
        id: "report-caption-1",
        sceneId: "scene-a",
        start: 0,
        end: 1.4,
        text: "첫 문장입니다",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "report-caption-2",
        sceneId: "scene-a",
        start: 1.4,
        end: 3.1,
        text: "이어서 두 번째 문장입니다",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    layout
  )

  assert.equal(cues.length, 2)
  assert.equal(cues[0]?.start, 0)
  assert.equal(cues[0]?.end, 1.4)
  assert.equal(cues[1]?.start, 1.4)
  assert.equal(cues[1]?.end, 3.1)
})

test("공백 없는 긴 한글 자막은 글자를 버리지 않고 칸을 나눈다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    width: 1037,
    fontSize: 58,
  }
  const long =
    "정부가발표한이번대책은서민생활안정과물가안정을동시에겨냥한조치입니다그리고추가설명문장입니다"
  const cues = layoutTimedSubtitleCues(
    [
      {
        id: "quote-caption-1",
        sceneId: "scene-quote",
        start: 0,
        end: 4,
        text: long,
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    layout
  )
  assert.ok(cues.length >= 1)
  const joined = cues.map((cue) => cue.text.replace(/\n/g, "")).join("")
  assert.equal(joined, long)
  const limit = titleLineCharacterLimit(layout)
  for (const cue of cues) {
    for (const line of cue.text.split("\n")) {
      assert.ok(
        [...line].length <= limit + 2,
        `line too wide: "${line}" (${[...line].length} > ${limit})`
      )
    }
  }
  assert.equal(cues[0]?.start, 0)
  assert.equal(cues.at(-1)?.end, 4)
})

test("수동 편집한 자막 구간은 실제 음성 길이에 맞춰 비율을 유지한다", () => {
  const cues = retimeSubtitleCues(
    [
      {
        id: "caption-1",
        start: 0,
        end: 2,
        text: "첫 번째 자막입니다.",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "caption-2",
        start: 2,
        end: 6,
        text: "두 번째 자막입니다.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    9
  )

  assert.equal(cues[0].start, 0)
  assert.equal(cues[0].end, 3)
  assert.equal(cues[1].start, 3)
  assert.equal(cues[1].end, 9)
})

test("텍스트 폭과 정렬을 화면 대비 좌우 여백으로 계산한다", () => {
  const centered = resolveTextBox(
    defaultNewsClipSettings.titleCardText,
    defaultNewsClipSettings.safeMarginPercent
  )
  const left = resolveTextBox(
    { ...defaultNewsClipSettings.titleCardText, alignment: "left" },
    defaultNewsClipSettings.safeMarginPercent
  )
  const full = resolveTextBox(
    { ...defaultNewsClipSettings.titleCardText, width: 1080 },
    defaultNewsClipSettings.safeMarginPercent
  )

  assert.equal(centered.widthPercent, 80)
  assert.equal(centered.leftPercent, 10)
  assert.equal(centered.rightPercent, 10)
  assert.equal(left.leftPercent, 7)
  assert.equal(left.rightPercent, 13)
  assert.equal(full.widthPercent, 100)
  assert.equal(full.leftPercent, 0)
  assert.equal(full.rightPercent, 0)
})
