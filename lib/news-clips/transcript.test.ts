import assert from "node:assert/strict"
import test from "node:test"

import { buildSubtitles } from "./subtitles.ts"
import {
  automaticSubtitleLineCharacterLimit,
  fitTitleToLineLayouts,
  fitTitleToTwoLines,
  layoutTimedSubtitleCues,
  mergeSubtitleCueWithNext,
  normalizeSubtitleCues,
  reflowSubtitleTextPreservingContent,
  resetEditedSubtitleCue,
  updateEditedSubtitleCue,
  retimeSubtitleCues,
  resolveTextBox,
  splitIntroTitleLines,
  splitIntoSubtitleChunks,
  subtitleLineCharacterLimit,
  titleLineCharacterLimit,
  titleLineFontSize,
  titleLineFits,
  titleLineRenderMetrics,
} from "./text-layout.ts"
import {
  clearLegacyAutomaticCaptionBoundaries,
  mergeTranscriptSegmentWithNext,
  normalizeKoreanRecognitionText,
  parseTranscript,
  repairLegacyOverlappingTranscript,
  replaceTranscriptRange,
  serializeTranscript,
  splitTranscriptSegmentAtWord,
  transcriptRangeIsReviewed,
  transcriptRangeLooksHallucinated,
  updateTranscriptSegmentText,
} from "./transcript.ts"
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

test("선택 구간만 로컬 재전사 단어 시간으로 교체한다", () => {
  const original = parseTranscript(`1
00:00:00,000 --> 00:00:02,000
앞 문장

2
00:00:02,000 --> 00:00:05,000
동서 취소 특권법은

3
00:00:05,000 --> 00:00:07,000
뒤 문장`)
  const replacement = parseTranscript(
    JSON.stringify({
      format: "shortsfactory-word-timestamps-v1",
      segments: [
        {
          start: 2.1,
          end: 4.9,
          text: "공소 취소 특권법은",
          words: [
            { word: "공소", start: 2.1, end: 2.8 },
            { word: "취소", start: 2.9, end: 3.5 },
            { word: "특권법은", start: 3.6, end: 4.9 },
          ],
        },
      ],
    })
  )
  const result = replaceTranscriptRange(original, replacement, {
    start: 2,
    end: 5,
  })
  assert.deepEqual(
    result.map((segment) => segment.text),
    ["앞 문장", "공소 취소 특권법은", "뒤 문장"]
  )
  assert.equal(result[1]?.words[0]?.start, 2.1)
  assert.equal(result[1]?.words.at(-1)?.end, 4.9)
})

test("반복되는 한국어 법률용어 음성인식 오류만 교정한다", () => {
  assert.equal(
    normalizeKoreanRecognitionText(
      "공소치소 특검법은 이재명을 타록시키기 위한 타록법입니다."
    ),
    "공소 취소 특권법은 이재명을 탈옥시키기 위한 탈옥법입니다."
  )
})

test("같은 짧은 표현을 길게 반복한 Whisper 환각을 거부한다", () => {
  const hallucinated = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 10,
          end: 30,
          text: Array(12).fill("이재명을 죽고").join(" "),
          words: Array.from({ length: 24 }, (_, index) => ({
            word: index % 2 === 0 ? "이재명을" : "죽고",
            start: 10 + index * 0.8,
            end: 10.7 + index * 0.8,
            probability: 0.99,
          })),
        },
      ],
    })
  )
  const natural = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 10,
          end: 24,
          text: "범죄자 이재명의 모든 죄를 없애기 위한 법입니다 대한민국 법치주의가 무너지고 있다는 주장입니다",
          words:
            "범죄자 이재명의 모든 죄를 없애기 위한 법입니다 대한민국 법치주의가 무너지고 있다는 주장입니다 그리고 국민이 막아야 합니다"
              .split(" ")
              .map((word, index) => ({
                word,
                start: 10 + index * 0.7,
                end: 10.6 + index * 0.7,
                probability: 0.97,
              })),
        },
      ],
    })
  )
  assert.equal(
    transcriptRangeLooksHallucinated(hallucinated, { start: 10, end: 30 }),
    true
  )
  assert.equal(
    transcriptRangeLooksHallucinated(natural, { start: 10, end: 30 }),
    false
  )
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

test("두 자리 연도 뒤에 월과 일이 이어지면 달력 날짜로 복원한다", () => {
  const segments = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 70.92,
          end: 76,
          text: "26년",
          words: [{ word: "26년", start: 70.92, end: 72.8 }],
        },
        {
          start: 73,
          end: 77.84,
          text: "11월 6일",
          words: [
            { word: "11월", start: 73, end: 75.2 },
            { word: "6일", start: 75.3, end: 77.84 },
          ],
        },
      ],
    })
  )

  assert.equal(segments[0]?.text, "2026년")
  assert.equal(segments[0]?.words[0]?.text, "2026년")
  assert.equal(segments[0]?.words[0]?.start, 70.92)
  assert.equal(segments[1]?.text, "11월 6일")
})

test("기간을 뜻하는 두 자리 연도는 네 자리 연도로 바꾸지 않는다", () => {
  const [segment] = parseTranscript(`1
00:00:00,000 --> 00:00:02,000
26년 동안 이어졌어.`)

  assert.equal(segment?.text, "26년 동안 이어졌어.")
})

test("자동 자막 폭은 렌더 직전 단어 묶음에도 같은 기준을 제공한다", () => {
  const limit = automaticSubtitleLineCharacterLimit(
    defaultNewsClipSettings.bodySubtitleText
  )
  assert.ok(limit >= 4)
  assert.ok(
    limit < titleLineCharacterLimit(defaultNewsClipSettings.bodySubtitleText)
  )
})

test("수동 자막 편집은 자동 생성 여유 폭이 아닌 FFmpeg 전체 폭을 허용한다", () => {
  const automatic = automaticSubtitleLineCharacterLimit(
    defaultNewsClipSettings.bodySubtitleText
  )
  const editable = subtitleLineCharacterLimit(
    defaultNewsClipSettings.bodySubtitleText
  )

  assert.ok(editable > automatic)
})

test("자동 자막은 한 줄 최대 글자 단위를 넘기지 않고 다음 칸으로 배치한다", () => {
  const layout = defaultNewsClipSettings.bodySubtitleText
  const limit = automaticSubtitleLineCharacterLimit(layout)
  const original =
    "정부가 발표한 정책은 지역 주민의 세금 부담과 일자리 문제로 이어질 수 있다는 지적이 나왔습니다."
  const cues = layoutTimedSubtitleCues(
    [
      {
        id: "long-auto-caption",
        start: 0,
        end: 8,
        text: original,
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    layout
  )

  assert.ok(cues.length >= 2)
  assert.ok(
    cues.every((cue) =>
      cue.text.split("\n").every((line) => [...line].length <= limit)
    )
  )
  assert.equal(
    cues
      .map((cue) => cue.text.replace(/\n/g, " "))
      .join(" ")
      .replace(/\s+/g, " "),
    original
  )
})

test("같은 장면의 다음 자막을 합치면 전체 시간과 수정 문구를 보존한다", () => {
  const merged = mergeSubtitleCueWithNext(
    [
      {
        id: "date-1",
        sceneId: "scene-date",
        start: 1,
        end: 2,
        text: "26년",
        emphasis: [],
        emphasisColor: "yellow",
      },
      {
        id: "date-2",
        sceneId: "scene-date",
        start: 2.1,
        end: 3.4,
        text: "11월 6일",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    "date-1",
    defaultNewsClipSettings.bodySubtitleText
  )

  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.text.replace(/\n/g, " "), "2026년 11월 6일")
  assert.equal(merged[0]?.start, 1)
  assert.equal(merged[0]?.end, 3.4)
  assert.equal(merged[0]?.edited, true)
})

test("전사 오타 수정은 원본 단어 타임코드를 유지한다", () => {
  const [segment] = parseTranscript(`1
00:00:10,000 --> 00:00:12,000
예산이 늘어씀니다.`)
  const updated = updateTranscriptSegmentText(segment!, "예산이 늘었습니다.")

  assert.equal(updated.text, "예산이 늘었습니다.")
  assert.equal(updated.words[0]?.start, segment?.words[0]?.start)
  assert.equal(updated.words[1]?.end, segment?.words[1]?.end)
  assert.equal(
    parseTranscript(serializeTranscript([updated]))[0]?.text,
    "예산이 늘었습니다."
  )
})

test("단어 수가 달라지는 교정은 대응하는 원본 단어 범위에 고정한다", () => {
  const [segment] = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 1,
          end: 2.5,
          text: "그는 이제 명 대표다",
          words: [
            { word: "그는", start: 1, end: 1.3 },
            { word: "이제", start: 1.4, end: 1.65 },
            { word: "명", start: 1.68, end: 1.9 },
            { word: "대표다", start: 2, end: 2.5 },
          ],
        },
      ],
    })
  )
  const updated = updateTranscriptSegmentText(segment!, "그는 이재명 대표다")

  assert.equal(updated.words[0]?.start, 1)
  assert.equal(updated.words[1]?.text, "이재명")
  assert.equal(updated.words[1]?.start, 1.4)
  assert.equal(updated.words[1]?.end, 1.9)
  assert.equal(updated.words[2]?.start, 2)
  assert.equal(updated.originalWords?.length, 4)

  const restored = parseTranscript(serializeTranscript([updated]))[0]
  assert.equal(restored?.words[1]?.start, 1.4)
  assert.equal(restored?.originalWords?.[2]?.text, "명")

  const revisedAgain = updateTranscriptSegmentText(
    restored!,
    "그는 이재명 대표였다"
  )
  assert.equal(revisedAgain.words[1]?.start, 1.4)
  assert.equal(revisedAgain.words[1]?.end, 1.9)
  assert.equal(revisedAgain.originalWords?.[2]?.text, "명")
})

test("인접 원문을 합치면 두 구간의 전체 시간과 단어 시간을 보존한다", () => {
  const segments = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 10,
          end: 11,
          text: "한마디로",
          words: [{ word: "한마디로", start: 10.1, end: 10.8 }],
        },
        {
          start: 11,
          end: 13,
          text: "이재명 탈옥법입니다.",
          words: [
            { word: "이재명", start: 11.1, end: 11.6 },
            { word: "탈옥법입니다.", start: 11.7, end: 12.8 },
          ],
        },
      ],
    })
  )

  const merged = mergeTranscriptSegmentWithNext(
    segments,
    segments[0]!.id,
    segments[1]!.id
  )

  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.text, "한마디로 이재명 탈옥법입니다.")
  assert.equal(merged[0]?.start, 10)
  assert.equal(merged[0]?.end, 13)
  assert.equal(merged[0]?.words[1]?.start, 11.1)
  assert.equal(merged[0]?.words[2]?.end, 12.8)
  assert.equal(merged[0]?.captionBoundaryAfter, true)
})

test("3번과 4번을 합쳐도 5번 구간의 시작과 끝은 바뀌지 않는다", () => {
  const segments = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 10,
          end: 12,
          text: "대한민국은 죽고",
          caption_boundary_after: true,
          words: [
            { word: "대한민국은", start: 10.1, end: 10.9 },
            { word: "죽고", start: 11, end: 11.8 },
          ],
        },
        {
          start: 12,
          end: 15,
          text: "이재명만 살았습니다.",
          caption_boundary_after: true,
          words: [
            { word: "이재명만", start: 12.1, end: 13.2 },
            { word: "살았습니다.", start: 13.3, end: 14.8 },
          ],
        },
        {
          start: 15,
          end: 18,
          text: "공소취소 특권법은",
          caption_boundary_after: true,
          words: [
            { word: "공소취소", start: 15.1, end: 16.2 },
            { word: "특권법은", start: 16.3, end: 17.8 },
          ],
        },
      ],
    })
  )
  const fifthBefore = structuredClone(segments[2])

  const merged = mergeTranscriptSegmentWithNext(
    segments,
    segments[0]!.id,
    segments[1]!.id
  )

  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.start, 10)
  assert.equal(merged[0]?.end, 15)
  assert.equal(merged[0]?.captionBoundaryAfter, true)
  assert.equal(merged[0]?.captionBoundarySource, "manual")
  assert.deepEqual(merged[1], fifthBefore)
})

test("검수에서 확정한 자막 경계는 저장하고 다시 읽어도 유지된다", () => {
  const segments = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 1,
          end: 2,
          text: "확정 자막",
          caption_boundary_after: true,
          caption_boundary_source: "manual",
          words: [{ word: "확정 자막", start: 1, end: 2 }],
        },
      ],
    })
  )

  const restored = parseTranscript(serializeTranscript(segments))

  assert.equal(restored[0]?.captionBoundaryAfter, true)
  assert.equal(restored[0]?.captionBoundarySource, "manual")
})

test("예전 버전이 자동 저장한 긴 전사 경계만 제거한다", () => {
  const legacy = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 10,
          end: 14,
          text: "자동으로 잘못 고정된 긴 구간",
          caption_boundary_after: true,
        },
        {
          start: 14,
          end: 18,
          text: "사용자가 직접 확정한 구간",
          caption_boundary_after: true,
          caption_boundary_source: "manual",
        },
        {
          start: 18,
          end: 22,
          text: "새 방식으로 자동 확정한 짧은 호흡",
          caption_boundary_after: true,
          caption_boundary_source: "automatic",
        },
      ],
    })
  )

  const cleaned = clearLegacyAutomaticCaptionBoundaries(legacy, {
    start: 10,
    end: 22,
  })

  assert.equal(cleaned[0]?.captionBoundaryAfter, undefined)
  assert.equal(cleaned[1]?.captionBoundaryAfter, true)
  assert.equal(cleaned[1]?.captionBoundarySource, "manual")
  assert.equal(cleaned[2]?.captionBoundaryAfter, true)
  assert.equal(cleaned[2]?.captionBoundarySource, "automatic")
})

test("검수된 자동 구간과 사용자 수정 구간은 재전사 대상에서 제외한다", () => {
  const reviewed = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 10,
          end: 12,
          text: "자동 확정 구간",
          caption_boundary_after: true,
          caption_boundary_source: "automatic",
        },
        {
          start: 12,
          end: 14,
          text: "사용자 수정 구간",
          caption_boundary_after: true,
          caption_boundary_source: "manual",
        },
      ],
    })
  )

  assert.equal(
    transcriptRangeIsReviewed(reviewed, { start: 10, end: 14 }),
    true
  )
  assert.equal(
    transcriptRangeIsReviewed(
      reviewed.map((segment, index) =>
        index === 0
          ? {
              ...segment,
              captionBoundarySource: undefined,
            }
          : segment
      ),
      { start: 10, end: 14 }
    ),
    false
  )
})

test("겹친 문구를 합칠 때 중복을 없애고 오른쪽 발화 시간을 쓴다", () => {
  const segments = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 20,
          end: 22,
          text: "범죄자 이재명의 모든 죄를",
          words: [
            { word: "범죄자", start: 20, end: 20.4 },
            { word: "이재명의", start: 20.5, end: 21 },
            { word: "모든", start: 21.1, end: 21.4 },
            { word: "죄를", start: 21.5, end: 21.9 },
          ],
        },
        {
          start: 21.8,
          end: 24,
          text: "모든 죄를 없애기 위한",
          words: [
            { word: "모든", start: 21.9, end: 22.2 },
            { word: "죄를", start: 22.3, end: 22.7 },
            { word: "없애기", start: 22.8, end: 23.3 },
            { word: "위한", start: 23.4, end: 23.8 },
          ],
        },
      ],
    })
  )

  const merged = mergeTranscriptSegmentWithNext(segments, segments[0]!.id)

  assert.equal(merged[0]?.text, "범죄자 이재명의 모든 죄를 없애기 위한")
  assert.equal(
    merged[0]?.words.filter((word) => word.text === "모든").length,
    1
  )
  assert.equal(
    merged[0]?.words.find((word) => word.text === "모든")?.start,
    21.9
  )
  assert.equal(merged[0]?.end, 24)
})

test("원문 구간을 단어 경계에서 나누면 실제 단어 시간과 전체 범위를 보존한다", () => {
  const segments = parseTranscript(
    JSON.stringify({
      segments: [
        {
          start: 10,
          end: 13,
          text: "한마디로 이재명 탈옥법입니다.",
          words: [
            { word: "한마디로", start: 10.1, end: 10.8 },
            { word: "이재명", start: 11.1, end: 11.6 },
            { word: "탈옥법입니다.", start: 11.7, end: 12.8 },
          ],
        },
      ],
    })
  )

  const split = splitTranscriptSegmentAtWord(segments, segments[0]!.id, 1)

  assert.equal(split.length, 2)
  assert.equal(split[0]?.text, "한마디로")
  assert.equal(split[1]?.text, "이재명 탈옥법입니다.")
  assert.equal(split[0]?.start, 10)
  assert.equal(split[1]?.end, 13)
  assert.equal(split[0]?.end, split[1]?.start)
  assert.equal(split[0]?.words[0]?.start, 10.1)
  assert.equal(split[1]?.words[0]?.start, 11.1)
  assert.equal(split[0]?.captionBoundaryAfter, true)
  assert.equal(split[1]?.captionBoundaryAfter, true)
  assert.equal(split[0]?.captionBoundarySource, "manual")
  assert.equal(split[1]?.captionBoundarySource, "manual")
})

test("첫 단어나 마지막 단어 바깥에서는 원문 구간을 나누지 않는다", () => {
  const segments = parseTranscript("한마디로 이재명 탈옥법입니다.")

  assert.equal(
    splitTranscriptSegmentAtWord(segments, segments[0]!.id, 0),
    segments
  )
  assert.equal(
    splitTranscriptSegmentAtWord(
      segments,
      segments[0]!.id,
      segments[0]!.words.length
    ),
    segments
  )
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

test("미편집 레거시 원문의 겹친 시간을 SRT에서 다시 복구한다", () => {
  const legacy = [
    {
      id: "1",
      text: "26년",
      start: 70.92,
      end: 76,
      speaker: "speaker-1",
      words: [{ text: "26년", start: 70.92, end: 76 }],
    },
    {
      id: "2",
      text: "11월 6일",
      start: 73,
      end: 77.84,
      speaker: "speaker-1",
      words: [
        { text: "11월", start: 73, end: 75.42 },
        { text: "6일", start: 75.42, end: 77.84 },
      ],
    },
    {
      id: "3",
      text: "대한민국",
      start: 76,
      end: 80.28,
      speaker: "speaker-1",
      words: [{ text: "대한민국", start: 76, end: 80.28 }],
    },
  ]
  const repaired = repairLegacyOverlappingTranscript(
    legacy,
    `1
00:01:10,920 --> 00:01:16,000
26년

2
00:01:13,000 --> 00:01:17,840
11월 6일

3
00:01:16,000 --> 00:01:20,280
대한민국`
  )

  assert.equal(repaired[0]?.text, "2026년")
  assert.equal(repaired[0]?.end, repaired[1]?.start)
  assert.equal(repaired[1]?.end, repaired[2]?.start)
})

test("사용자가 교정한 레거시 원문은 자동 복구로 덮어쓰지 않는다", () => {
  const current = [
    {
      id: "1",
      text: "공소 취소",
      originalText: "동서 취소",
      start: 10,
      end: 14,
      speaker: "speaker-1",
      words: [{ text: "공소 취소", start: 10, end: 14 }],
    },
    {
      id: "2",
      text: "특검법",
      start: 12,
      end: 16,
      speaker: "speaker-1",
      words: [{ text: "특검법", start: 12, end: 16 }],
    },
  ]

  assert.equal(repairLegacyOverlappingTranscript(current, "새 전사"), current)
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

test("화면에 들어가더라도 한 줄 최대 글자 수를 넘으면 자동 줄바꿈한다", () => {
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
  assert.equal(cues[0].text, "2년간 시범\n시행됩니다.")
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

test("여유 폭을 넘어도 실제 화면에 들어가면 한글 어절을 자르지 않는다", () => {
  const cues = layoutTimedSubtitleCues(
    [
      {
        id: "caption-natural-korean-wrap",
        start: 0,
        end: 2,
        text: "제 눈앞에서 체포되셔서 가셨습니다.",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    {
      ...defaultNewsClipSettings.bodySubtitleText,
      fontSize: 75,
      letterSpacing: -4,
      width: 1058,
    }
  )

  assert.equal(cues.length, 1)
  assert.equal(cues[0]?.text, "제 눈앞에서 체포되셔서\n가셨습니다.")
  assert.equal(cues[0]?.text.includes("체포되\n셔서"), false)
})

test("확정 자막은 수정한 문구를 보존하면서 FFmpeg 폭에 맞게 재배치한다", () => {
  const layout = {
    ...defaultNewsClipSettings.bodySubtitleText,
    fontSize: 75,
    letterSpacing: -4,
    width: 1058,
  }
  const anger = reflowSubtitleTextPreservingContent(
    "우리를 분노케 한 것은\n이재명입니다.",
    layout
  )
  const together = reflowSubtitleTextPreservingContent(
    "이 자리에 함께했습니다.",
    layout
  )
  const limit = automaticSubtitleLineCharacterLimit(layout)

  assert.equal(anger, "우리를 분노케 한\n것은 이재명입니다.")
  assert.equal(together, "이 자리에\n함께했습니다.")
  assert.ok(
    [anger, together].every((caption) =>
      caption.split("\n").every((line) => [...line].length <= limit)
    )
  )
  assert.equal(anger.replace(/\s+/g, ""), "우리를분노케한것은이재명입니다.")
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
