import {
  quoteOutputDurationSeconds,
  scaleQuoteTimelineSeconds,
} from "./playback.ts"
import { snapSourceRangeToSpeech } from "./speech-bounds.ts"
import { clearLegacyAutomaticCaptionBoundaries } from "./transcript.ts"
import type {
  NewsReportScene,
  SubtitleCue,
  TranscriptSegment,
} from "./types.ts"

const EMPHASIS =
  /(?:\d[\d,.]*\s*(?:%|원|명|건|배|조|억|만)?|정부|국회|대통령|피해|세금|일자리|안보|외교|사법)/g

type SpeechAlignmentUnit = {
  text: string
  start: number
  end: number
  /** 원본 전사의 한 문장/발화 구간이 여기서 끝난다. */
  boundaryAfter?: boolean
}

type TimedSpeechToken = SpeechAlignmentUnit & {
  /** 날짜처럼 그 자체로 완결된 짧은 의미 단위 뒤를 우선 경계로 삼는다. */
  preferredBreakAfter?: boolean
}

export const NEWS_END_CTA_TEXT = "이건 어떻게 생각해?\n댓글로 남겨줘."
export const NEWS_INTRO_GAP_SECONDS = 0.5
export const NEWS_OUTRO_GAP_SECONDS = 0.5
export const NEWS_TOTAL_GAP_SECONDS =
  NEWS_INTRO_GAP_SECONDS + NEWS_OUTRO_GAP_SECONDS

export function reportHasEndCta(script: string) {
  const lines = script
    .trim()
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const lineTail = lines.slice(-2).join(" ")
  if (/댓글/.test(lineTail) && /(남겨|달아|적어|알려|써|의견)/.test(lineTail)) {
    return true
  }
  const tail = splitReportSentences(script).slice(-2).join(" ")
  return /댓글/.test(tail) && /(남겨|달아|적어|알려|써|의견)/.test(tail)
}

function isCtaCommentLine(line: string) {
  return /댓글/.test(line) && /(남겨|달아|적어|알려|써|의견)/.test(line)
}

function isCtaQuestionLine(line: string) {
  return /어떻게 생각|의견에|대해 어떻게/.test(line)
}

export function ensureReportEndCta(
  script: string,
  title: string,
  keywords: string[] = [],
  preferredCtaText = ""
) {
  const normalized = script.trim()
  if (!normalized || reportHasEndCta(normalized)) return normalized
  const ctaText =
    preferredCtaText.trim() || contextualEndCtaText(title, keywords, normalized)
  return `${normalized}\n${ctaText}`
}

export function isEndCtaScene(scene: Pick<NewsReportScene, "id">) {
  return scene.id === "end-cta" || scene.id.startsWith("end-cta-")
}

/** 본편 대본과 마무리 유도 멘트를 분리한다. */
export function splitEndCtaFromScript(script: string) {
  const normalized = script.trim()
  if (!normalized || !reportHasEndCta(normalized)) {
    return { body: normalized, cta: "" }
  }

  // CTA는 ensureReportEndCta가 줄바꿈으로 붙이므로, 줄 단위 분리를 우선한다.
  // 문장부호 없는 서두가 질문 문장과 한 문장으로 합쳐지는 걸 막는다.
  const lines = normalized
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length >= 1 && isCtaCommentLine(lines.at(-1)!)) {
    if (lines.length >= 2 && isCtaQuestionLine(lines.at(-2)!)) {
      return {
        body: lines.slice(0, -2).join("\n").trim(),
        cta: lines.slice(-2).join("\n").trim(),
      }
    }
    return {
      body: lines.slice(0, -1).join("\n").trim(),
      cta: lines.at(-1)!.trim(),
    }
  }

  const sentences = splitReportSentences(normalized)
  if (!sentences.length) return { body: normalized, cta: "" }

  let take = 1
  if (sentences.length >= 2) {
    const last = sentences.at(-1) ?? ""
    const prev = sentences.at(-2) ?? ""
    if (isCtaCommentLine(last) && isCtaQuestionLine(prev)) take = 2
    else if (isCtaCommentLine(last)) take = 1
  }
  const ctaSentences = sentences.slice(-take)
  const bodySentences = sentences.slice(0, -take)
  return {
    body: bodySentences.join("\n").trim(),
    cta: ctaSentences.join("\n").trim(),
  }
}

/** 본편 장면 뒤에 마무리 TTS 장면을 붙인다. */
export function appendEndCtaScenes(
  scenes: NewsReportScene[],
  cta: string,
  primarySourceId = ""
): NewsReportScene[] {
  const text = cta.trim()
  if (!text) return scenes.filter((scene) => !isEndCtaScene(scene))
  const existingCta = scenes.find((scene) => isEndCtaScene(scene))
  const bodyScenes = scenes.filter((scene) => !isEndCtaScene(scene))
  if (!bodyScenes.length) return scenes
  const anchor =
    [...bodyScenes].reverse().find((scene) => scene.visual === "source") ??
    bodyScenes.at(-1)!
  const defaultStart = Math.max(0, anchor.sourceEnd - 2.5)
  const defaultEnd = Math.max(defaultStart + 0.8, anchor.sourceEnd)
  const sourceStart = Number.isFinite(existingCta?.sourceStart)
    ? existingCta!.sourceStart
    : defaultStart
  const sourceEnd = Number.isFinite(existingCta?.sourceEnd)
    ? Math.max(sourceStart + 0.8, existingCta!.sourceEnd)
    : defaultEnd
  return [
    ...bodyScenes,
    {
      id: "end-cta",
      narration: text,
      visual: "source",
      sourceId:
        existingCta?.sourceId ||
        anchor.sourceId ||
        primarySourceId ||
        undefined,
      sourceStart: round(sourceStart),
      sourceEnd: round(sourceEnd),
      ...(existingCta?.crop ? { crop: existingCta.crop } : {}),
    },
  ]
}

const CTA_GENERIC_TERMS = new Set([
  "정부",
  "민주당",
  "국민의힘",
  "대통령",
  "국회",
  "정책",
  "논란",
  "관련",
  "오늘",
  "뉴스",
])

export function splitReportSentences(script: string) {
  return (
    script
      .replace(/\r?\n+/g, " ")
      .match(/[^.!?。！？]+[.!?。！？]?/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? []
  )
}

export function estimateReportDuration(script: string, ratePercent = -4) {
  const compact = script.replace(/\s+/g, "").length
  const punctuation = (script.match(/[,.!?。！？，]/g) ?? []).length
  const base = compact / 5.8 + punctuation * 0.12
  return round(base / Math.max(0.85, 1 + ratePercent / 100))
}

export function estimateReportScenesDuration(
  scenes: NewsReportScene[],
  ratePercent = -4
) {
  return round(
    scenes.reduce(
      (total, scene) =>
        total +
        (scene.visual === "quote"
          ? quoteOutputDurationSeconds(scene.sourceStart, scene.sourceEnd)
          : estimateReportDuration(scene.narration, ratePercent)),
      0
    )
  )
}

export type TranscriptBySource = Record<string, TranscriptSegment[] | undefined>

export function quoteNarrationMatchesTranscript(
  scene: NewsReportScene,
  transcript: TranscriptSegment[],
  ratePercent = -4
) {
  if (scene.visual !== "quote") return true
  const quoteDuration = scene.sourceEnd - scene.sourceStart
  const narrationDuration = estimateReportDuration(scene.narration, ratePercent)
  if (
    !Number.isFinite(quoteDuration) ||
    quoteDuration < Math.max(0.6, narrationDuration * 0.55 - 0.25) ||
    quoteDuration > narrationDuration * 1.6 + 0.3
  ) {
    return false
  }

  const relevant = transcript.filter(
    (segment) =>
      segment.end > scene.sourceStart && segment.start < scene.sourceEnd
  )
  if (!relevant.length) return false
  const candidates = relevant.flatMap((_, start) =>
    Array.from({ length: Math.min(4, relevant.length - start) }, (__, offset) =>
      relevant
        .slice(start, start + offset + 1)
        .map((segment) => segment.text)
        .join(" ")
    )
  )
  candidates.push(relevant.map((segment) => segment.text).join(" "))
  return candidates.some(
    (candidate) =>
      ngramRecall(scene.narration, candidate, 2) >= 0.82 &&
      ngramDice(scene.narration, candidate, 2) >= 0.56
  )
}

export function normalizeQuoteScenes(
  scenes: NewsReportScene[],
  transcripts: TranscriptBySource,
  primarySourceId: string,
  ratePercent = -4
) {
  return scenes.map((scene) => {
    if (scene.visual !== "quote") return scene
    // 무음컷 조각은 원본 음성을 유지한다. (빈 narration 또는 …-cut-N id)
    if (!scene.narration.trim() || /-cut-\d+/i.test(scene.id)) return scene
    const sourceId = scene.sourceId || primarySourceId
    const transcript = transcripts[sourceId]
    return transcript?.length &&
      quoteNarrationMatchesTranscript(scene, transcript, ratePercent)
      ? scene
      : { ...scene, visual: "source" as const }
  })
}

export function quoteTranscriptAlignment(
  scene: NewsReportScene,
  transcript: TranscriptSegment[]
) {
  if (scene.visual !== "quote") return []
  // 단어 타임스탬프를 전 구간 flat 정렬하면, 겹친 ASR 구간 단어가 섞여
  // "2026년 11월 대한민국은 / 1일 죽고…"처럼 문장이 깨지고 자막이 겹친다.
  // 전사 문장(segment) 단위로 맞추고 시간 겹침만 정리한다.
  const overlapping = transcript.filter(
    (segment) =>
      segment.text.trim() &&
      segment.end > scene.sourceStart &&
      segment.start < scene.sourceEnd
  )
  const contained = overlapping.filter(
    (segment) =>
      segment.start >= scene.sourceStart - 0.15 &&
      segment.end <= scene.sourceEnd + 0.15
  )
  const pool = (contained.length ? contained : overlapping)
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end)

  // 1) 겹친 ASR 문장은 문장 순서로 정리한다.
  const keptSegments: TranscriptSegment[] = []
  for (const segment of pool) {
    const text = segment.text.replace(/\s+/g, " ").trim()
    if (!text) continue
    const start = Math.max(scene.sourceStart, segment.start)
    const end = Math.max(start + 0.08, Math.min(scene.sourceEnd, segment.end))
    const previous = keptSegments.at(-1)
    if (!previous) {
      keptSegments.push({ ...segment, start, end, text })
      continue
    }
    if (start < previous.end - 0.05) {
      if (previous.text.includes(text) || text.includes(previous.text)) {
        previous.end = Math.max(previous.end, end)
        if (text.length > previous.text.length) {
          previous.text = text
          previous.words = segment.words
        }
        continue
      }
      if (!/[.!?。！？]$/.test(previous.text)) {
        // 문장 미완 겹침도 단어 타임코드를 버리지 않는다.
        previous.text = `${previous.text} ${text}`.replace(/\s+/g, " ").trim()
        previous.end = Math.max(previous.end, end)
        previous.words = mergeTranscriptWords(previous.words, segment.words)
        continue
      }
      if (segment.words.length) {
        // 롤링 ASR의 segment end는 다음 문장 첫 단어 뒤까지 겹칠 수 있다.
        // 문장 start를 앞 segment end로 밀면 첫 단어가 필터에서 사라지므로,
        // 단어 시간이 있는 문장은 원래 범위를 유지하고 아래 단어 단계에서 정리한다.
        keptSegments.push({ ...segment, start, end, text })
        continue
      }
      const clampedStart = previous.end
      if (end - clampedStart < 0.12) {
        previous.text = `${previous.text} ${text}`.replace(/\s+/g, " ").trim()
        previous.end = Math.max(previous.end, end)
        previous.words = mergeTranscriptWords(previous.words, segment.words)
        continue
      }
      keptSegments.push({ ...segment, start: clampedStart, end, text })
      continue
    }
    keptSegments.push({ ...segment, start, end, text })
  }

  // 2) 고른 문장 안에서만 단어 타임스탬프를 펼친다(문장 간 단어 섞임 방지).
  const resolved: SpeechAlignmentUnit[] = []
  for (const [segmentIndex, segment] of keptSegments.entries()) {
    const nextSegment = keptSegments[segmentIndex + 1]
    const previousSegment = keptSegments[segmentIndex - 1]
    const preserveSegmentBoundary = isSemanticTranscriptBoundary(
      segment,
      nextSegment
    )
    const words = (segment.words ?? []).filter(
      (word) =>
        word.text.trim() &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end >= word.start &&
        word.end > segment.start - 0.05 &&
        word.start < segment.end + 0.05
    )
    // 겹친 롤링 전사에서는 타임코드 정렬이 문장 단어 순서를 뒤섞는다.
    // STT가 반환한 문장 내부 단어 순서를 그대로 신뢰한다.
    if (words.length) {
      for (const [wordIndex, word] of words.entries()) {
        const text = word.text.replace(/\s+/g, " ").trim()
        if (!text) continue
        const boundaryAfter =
          wordIndex === words.length - 1 && preserveSegmentBoundary
        let start = Math.max(segment.start, word.start)
        let end = Math.max(start + 0.06, Math.min(segment.end, word.end))
        // Whisper가 문장 사이의 긴 호흡을 다음 문장 첫 단어 길이로
        // 포함하는 경우가 있다. 비정상적으로 긴 첫 단어만 시작을 당겨
        // 자막이 무음 구간에서 먼저 뜨는 현상을 막는다.
        if (
          wordIndex === 0 &&
          previousSegment &&
          /[.!?。！？]["'”’)]*$/.test(cleanPhrase(previousSegment.text))
        ) {
          const syllables = Math.max(1, (text.match(/[가-힣]/gu) ?? []).length)
          const naturalDuration = Math.min(
            0.9,
            Math.max(0.6, syllables * 0.15 + 0.1)
          )
          if (end - start > 1.2) start = Math.max(start, end - naturalDuration)
        }
        const previous = resolved.at(-1)
        if (previous && start < previous.end) {
          const sameWord =
            comparableSpeechWord(previous.text) === comparableSpeechWord(text)
          if (sameWord) {
            previous.end = Math.max(previous.end, end)
            if (boundaryAfter) previous.boundaryAfter = true
            continue
          }
          // 서로 다른 단어를 하나로 합치면 이후 비례 분할로 싱크가 무너진다.
          // 겹친 폭의 중간점만 경계로 잡아 각 단어의 독립 시간을 유지한다.
          const unionEnd = Math.max(previous.end, end)
          const previousWeight = Math.max(1, comparableLength(previous.text))
          const currentWeight = Math.max(1, comparableLength(text))
          const boundary = Math.max(
            previous.start + 0.04,
            Math.min(
              unionEnd - 0.04,
              previous.start +
                ((unionEnd - previous.start) * previousWeight) /
                  (previousWeight + currentWeight)
            )
          )
          previous.end = boundary
          start = boundary
          end = Math.max(start + 0.04, unionEnd)
        }
        resolved.push({ text, start, end, boundaryAfter })
      }
      continue
    }
    resolved.push({
      text: segment.text,
      start: segment.start,
      end: segment.end,
      boundaryAfter: preserveSegmentBoundary,
    })
  }

  return resolved.map((segment) => ({
    text: segment.text,
    start: round(Math.max(0, segment.start - scene.sourceStart)),
    end: round(
      Math.max(
        segment.start - scene.sourceStart + 0.04,
        segment.end - scene.sourceStart
      )
    ),
    boundaryAfter: segment.boundaryAfter,
  }))
}

/**
 * 검수용 본문은 실제 단어 시작점과 짧은 호흡을 기준으로 먼저 잘게 고정한다.
 * 사용자는 이 안전한 구간을 합치기만 하므로 뒤 자막의 시작점은 움직이지 않는다.
 */
export function shortBreathReviewTranscript(
  transcript: TranscriptSegment[],
  range: { start: number; end: number },
  maxCharacters = 18
) {
  const sourceStart = Math.min(range.start, range.end)
  const sourceEnd = Math.max(range.start, range.end)
  if (sourceEnd - sourceStart < 0.2) return transcript
  const cleanedTranscript = clearLegacyAutomaticCaptionBoundaries(transcript, {
    start: sourceStart,
    end: sourceEnd,
  })
  const overlapping = cleanedTranscript.filter(
    (segment) => segment.end > sourceStart && segment.start < sourceEnd
  )
  if (!overlapping.length) return cleanedTranscript
  if (
    overlapping.every((segment) => segment.captionBoundarySource !== undefined)
  ) {
    return repairReviewTranscriptWordOwnership(
      cleanedTranscript,
      sourceStart,
      sourceEnd
    )
  }
  // 이미 사용자가 확정한 구간은 자동 재분할하지 않는다.
  if (
    overlapping.some((segment) => segment.captionBoundarySource === "manual")
  ) {
    return cleanedTranscript
  }

  const scene: NewsReportScene = {
    id: "review-quote",
    narration: "",
    visual: "quote",
    sourceStart,
    sourceEnd,
  }
  const alignment = quoteTranscriptAlignment(scene, cleanedTranscript)
  const duration = sourceEnd - sourceStart
  const cues = subtitleCuesFromSpeechAlignment(
    { ...scene, start: 0, end: duration, alignment },
    { maxCharacters: Math.max(10, Math.floor(maxCharacters)) }
  )
  if (!cues.length) return cleanedTranscript

  const tokens = timedSubtitleTokens(alignment)
  const generated: TranscriptSegment[] = cues.map((cue, index) => {
    const next = cues[index + 1]
    const wordWindowEnd = next?.start ?? cue.end + 0.001
    const cueWords = tokens
      .filter(
        (word) =>
          word.start >= cue.start - 0.001 && word.start < wordWindowEnd - 0.001
      )
      .map((word) => ({
        text: cleanPhrase(word.text),
        start: round(sourceStart + word.start),
        end: round(sourceStart + word.end),
      }))
      .filter((word) => word.text)
    const start = round(sourceStart + cue.start)
    const end = round(sourceStart + (next?.start ?? cue.end))
    return {
      id: `review-caption-${Math.round(start * 1000)}-${index + 1}`,
      text: cue.text.replace(/\s*\n\s*/g, " ").trim(),
      start,
      end: Math.max(start + 0.04, end),
      speaker: "speaker-1",
      words: cueWords,
      captionBoundaryAfter: true,
      captionBoundarySource: "automatic",
    }
  })

  return [
    ...cleanedTranscript.filter((segment) => segment.end <= sourceStart),
    ...generated,
    ...cleanedTranscript.filter((segment) => segment.start >= sourceEnd),
  ].sort((left, right) => left.start - right.start || left.end - right.end)
}

/** 각 단어는 시작점이 속한 자막 하나에만 둔다. */
function repairReviewTranscriptWordOwnership(
  transcript: TranscriptSegment[],
  sourceStart: number,
  sourceEnd: number
) {
  const overlapping = transcript
    .filter((segment) => segment.end > sourceStart && segment.start < sourceEnd)
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const repairedById = new Map<string, TranscriptSegment>()
  let changed = false

  for (const [index, segment] of overlapping.entries()) {
    const nextStart = overlapping[index + 1]?.start ?? sourceEnd + 0.001
    const seen = new Set<string>()
    const words = segment.words.filter((word) => {
      if (
        word.start < segment.start - 0.001 ||
        word.start >= nextStart - 0.001
      ) {
        return false
      }
      const key = `${comparableSpeechWord(word.text)}:${round(word.start)}:${round(word.end)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const originalWords = segment.originalWords?.filter(
      (word) =>
        word.start >= segment.start - 0.001 && word.start < nextStart - 0.001
    )
    const automaticText = words.reduce(
      (text, word) => joinSpokenTokens(text, cleanPhrase(word.text)),
      ""
    )
    const text =
      segment.captionBoundarySource === "manual" || !automaticText
        ? segment.text
        : automaticText
    const wordsChanged =
      words.length !== segment.words.length ||
      words.some(
        (word, wordIndex) =>
          word.text !== segment.words[wordIndex]?.text ||
          word.start !== segment.words[wordIndex]?.start ||
          word.end !== segment.words[wordIndex]?.end
      )
    const originalWordsChanged =
      Boolean(segment.originalWords) &&
      originalWords?.length !== segment.originalWords?.length
    if (!wordsChanged && !originalWordsChanged && text === segment.text) {
      repairedById.set(segment.id, segment)
      continue
    }
    changed = true
    repairedById.set(segment.id, {
      ...segment,
      text,
      words,
      ...(segment.originalWords ? { originalWords } : {}),
    })
  }

  if (!changed) return transcript
  return transcript.map((segment) => repairedById.get(segment.id) ?? segment)
}

function comparableSpeechWord(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase()
}

/**
 * Whisper segment는 모델의 처리 단위일 뿐 문장 경계가 아니다.
 * 문장부호나 실제 호흡 간격이 있을 때만 화면 전환을 고정해,
 * `체포를 / 하면서`처럼 의미가 이어지는 표현이 모델 내부 구간 때문에
 * 갈라지지 않게 한다. 단어 start/end는 변경하지 않는다.
 */
function isSemanticTranscriptBoundary(
  segment: TranscriptSegment,
  next?: TranscriptSegment
) {
  // 3번 검수에서 확정한 구간은 문장 재분석보다 우선한다. 합치기는 중간
  // segment 자체를 없애므로 다음 자막의 시작점은 그대로 유지된다.
  if (segment.captionBoundaryAfter === true) return true
  const text = cleanPhrase(segment.text)
  if (!next) return true
  if (/[.!?。！？]["'”’)]*$/.test(text)) return true
  const gap = next.start - segment.end
  if (gap >= 0.38) return true
  if (startsWithClauseConnector(next.text)) return true
  return false
}

function mergeTranscriptWords(
  left: TranscriptSegment["words"],
  right: TranscriptSegment["words"]
) {
  if (!left.length) return right.map((word) => ({ ...word }))
  if (!right.length) return left.map((word) => ({ ...word }))
  const comparable = (value: string) =>
    value
      .normalize("NFKC")
      .replace(/[\s\p{P}\p{S}]+/gu, "")
      .toLowerCase()
  let overlap = Math.min(left.length, right.length)
  while (overlap > 0) {
    const suffix = left.slice(-overlap).map((word) => comparable(word.text))
    const prefix = right.slice(0, overlap).map((word) => comparable(word.text))
    if (suffix.every((word, index) => word && word === prefix[index])) break
    overlap -= 1
  }
  return [
    ...left.map((word) => ({ ...word })),
    ...right.slice(overlap).map((word) => ({ ...word })),
  ]
}

export function buildReportScenes(
  script: string,
  transcript: TranscriptSegment[],
  sourceStart: number,
  sourceEnd: number,
  preferred?: NewsReportScene[],
  defaultSourceId = ""
) {
  const sentences = splitReportSentences(script)
  const available = Math.max(1, sourceEnd - sourceStart)
  return sentences.map((narration, index) => {
    const saved = preferred?.[index]
    const segment = bestSourceSegment(
      narration,
      transcript,
      sourceStart,
      sourceEnd
    )
    const fallbackStart = sourceStart + (available * index) / sentences.length
    const requestedStart = saved?.sourceStart ?? segment?.start ?? fallbackStart
    const usesSupportingSource = Boolean(
      saved?.sourceId && defaultSourceId && saved.sourceId !== defaultSourceId
    )
    const start = usesSupportingSource
      ? Math.max(0, requestedStart)
      : Math.max(sourceStart, Math.min(sourceEnd - 0.5, requestedStart))
    const requestedEnd = saved?.sourceEnd ?? segment?.end ?? start + 5
    const end = usesSupportingSource
      ? Math.max(start + 0.5, requestedEnd)
      : Math.max(start + 0.5, Math.min(sourceEnd, requestedEnd))
    const snapped = usesSupportingSource
      ? { start, end }
      : snapSourceRangeToSpeech(start, end, transcript)
    return {
      id: saved?.id || `report-scene-${index + 1}`,
      narration,
      visual: saved?.visual ?? "source",
      sourceId: saved?.sourceId || defaultSourceId,
      sourceStart: round(snapped.start),
      sourceEnd: round(Math.max(snapped.start + 0.5, snapped.end)),
      ...(saved?.crop ? { crop: saved.crop } : {}),
    } satisfies NewsReportScene
  })
}

export function reportSubtitles(
  scenes: NewsReportScene[],
  durations?: number[],
  captionPhrases?: string[],
  transcript: TranscriptSegment[] = [],
  options: { maxCaptionCharacters?: number } = {}
) {
  const sceneWeights = scenes.map((scene, index) =>
    Math.max(
      0.5,
      durations?.[index] ??
        (scene.visual === "quote"
          ? quoteOutputDurationSeconds(scene.sourceStart, scene.sourceEnd)
          : estimateReportDuration(scene.narration))
    )
  )
  const phrases = captionPhrases?.map(cleanPhrase).filter(Boolean) ?? []
  const phraseGroups = assignCaptionPhrasesToScenes(scenes, phrases)
  let cursor = 0
  let phraseIndex = 0
  return scenes.flatMap((scene, sceneIndex) => {
    const duration = sceneWeights[sceneIndex]
    const sceneStart = cursor
    cursor += duration

    // 직접 발언: 원본 전사 타임코드를 출력 타임라인에 붙인다.
    if (scene.visual === "quote" && transcript.length) {
      const alignment = quoteTranscriptAlignment(scene, transcript).map(
        (item) => ({
          ...item,
          start: scaleQuoteTimelineSeconds(item.start),
          end: scaleQuoteTimelineSeconds(item.end),
        })
      )
      const quoteCues = subtitleCuesFromSpeechAlignment(
        {
          ...scene,
          start: sceneStart,
          end: sceneStart + duration,
          alignment,
        },
        { maxCharacters: options.maxCaptionCharacters }
      )
      if (quoteCues.length) return quoteCues
    }

    const texts = phraseGroups[sceneIndex] ?? []
    const weights = texts.map((text) =>
      Math.max(0.5, estimateReportDuration(text))
    )
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let elapsedWeight = 0
    return texts.map((text, textIndex) => {
      const start =
        sceneStart + (duration * elapsedWeight) / Math.max(0.5, totalWeight)
      elapsedWeight += weights[textIndex]
      const end =
        textIndex === texts.length - 1
          ? cursor
          : sceneStart + (duration * elapsedWeight) / Math.max(0.5, totalWeight)
      phraseIndex += 1
      const usesPhraseIds = phrases.length > 0 && scene.visual !== "quote"
      return {
        id: isEndCtaScene(scene)
          ? `end-cta-${textIndex + 1}`
          : usesPhraseIds
            ? `report-phrase-${phraseIndex}`
            : `report-caption-${sceneIndex + 1}-${textIndex + 1}`,
        sceneId: scene.id,
        start: round(start),
        end: round(end),
        text,
        emphasis: [...new Set(text.match(EMPHASIS) ?? [])],
        emphasisColor: "yellow",
      } satisfies SubtitleCue
    })
  })
}

/** 직접발언 장면에는 글로벌 문구를 흘리지 않고, 장면 나레이션만 쓴다. */
function assignCaptionPhrasesToScenes(
  scenes: NewsReportScene[],
  phrases: string[]
) {
  if (!phrases.length) {
    return scenes.map((scene) => captionLinesForScene(scene))
  }
  const groups = scenes.map((scene) =>
    scene.visual === "quote" || isEndCtaScene(scene)
      ? captionLinesForScene(scene)
      : ([] as string[])
  )
  const sourceIndexes = scenes
    .map((scene, index) =>
      scene.visual === "quote" || isEndCtaScene(scene) ? -1 : index
    )
    .filter((index) => index >= 0)
  if (!sourceIndexes.length) return groups

  const bodyPhrases = phrases.filter(
    (phrase) => !/댓글/.test(phrase) && !/어떻게 생각/.test(phrase)
  )
  const sourceScenes = sourceIndexes.map((index) => scenes[index])
  const sourceGroups = groupSequentialTextsByScene(
    sourceScenes,
    bodyPhrases.length ? bodyPhrases : phrases
  )
  sourceIndexes.forEach((sceneIndex, groupIndex) => {
    groups[sceneIndex] = sourceGroups[groupIndex] ?? []
  })
  return groups
}

function captionLinesForScene(scene: NewsReportScene) {
  if (!scene.narration.trim()) return [] as string[]
  const lines = scene.narration
    .split(/\r?\n+/)
    .map(cleanPhrase)
    .filter(Boolean)
  if (lines.length >= 2) return lines
  if (scene.visual === "quote") return chunkCaptionText(scene.narration)
  if (lines.length === 1) return lines
  const sentences = splitReportSentences(scene.narration)
    .map(cleanPhrase)
    .filter(Boolean)
  return sentences.length
    ? sentences
    : [cleanPhrase(scene.narration)].filter(Boolean)
}

function chunkCaptionText(value: string, maxChars = 24) {
  const compact = cleanPhrase(value)
  if (!compact) return [] as string[]
  if (comparableLength(compact) <= maxChars) return [compact]
  const tokens = compact.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  let current = ""
  for (const token of tokens) {
    const next = current ? `${current} ${token}` : token
    if (current && comparableLength(next) > maxChars) {
      chunks.push(current)
      current = token
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * 1) 음성/ASR 단어 타임스탬프 → 자막 내용·구간
 * 2) 없으면 실측 장면 길이에 대본 문구를 얹음
 * lockTimings면 승인된 자막의 문구·개수·구분·start/end를 그대로 유지한다.
 */
export function applySubtitleTimingForRender(
  cues: SubtitleCue[],
  plannedScenes: NewsReportScene[],
  timedScenes: Array<
    NewsReportScene & {
      start: number
      end: number
      alignment?: Array<{ text: string; start: number; end: number }>
    }
  >,
  options: {
    lockTimings?: boolean
    captionPhrases?: string[]
    transcript?: TranscriptSegment[]
    maxCaptionCharacters?: number
  } = {}
) {
  if (options.lockTimings && cues.length) {
    return cues
  }
  const durations = timedScenes.map((scene) =>
    Math.max(0.1, scene.end - scene.start)
  )
  // 기존 UI 자막 캐시는 쓰지 않고, 음성 실측 타임라인 기준으로 다시 만든다.
  const fresh = reportSubtitles(
    plannedScenes,
    durations,
    options.captionPhrases,
    options.transcript ?? [],
    { maxCaptionCharacters: options.maxCaptionCharacters }
  )
  const timed = retimeSubtitleCuesToScenes(fresh, plannedScenes, timedScenes, {
    maxCaptionCharacters: options.maxCaptionCharacters,
  })
  return timed
}

/** 실측으로 다시 잡은 구간에 사용자가 고친 문구·강조만 얹는다. */
export function mergeEditedSubtitleText(
  timed: SubtitleCue[],
  edited: SubtitleCue[],
  options: { preserveTimes?: boolean } = {}
) {
  const manual = edited.filter((cue) => cue.edited === true)
  if (!manual.length) return timed
  const byId = new Map(manual.map((cue) => [cue.id, cue] as const))
  const byScene = new Map<string, SubtitleCue[]>()
  for (const cue of manual) {
    if (!cue.sceneId) continue
    const list = byScene.get(cue.sceneId) ?? []
    list.push(cue)
    byScene.set(cue.sceneId, list)
  }
  const usedEdited = new Set<string>()
  const sceneCursor = new Map<string, number>()
  const preserveTimes = options.preserveTimes === true
  return timed.map((cue) => {
    const byExactId = byId.get(cue.id)
    if (byExactId) {
      usedEdited.add(byExactId.id)
      return {
        ...cue,
        ...(preserveTimes
          ? { start: byExactId.start, end: byExactId.end }
          : {}),
        text: byExactId.text,
        emphasis: byExactId.emphasis,
        emphasisColor: byExactId.emphasisColor,
        edited: true,
        originalText: cue.text,
        originalEmphasis: [...cue.emphasis],
      }
    }
    if (!cue.sceneId) return cue
    const list = byScene.get(cue.sceneId) ?? []
    let index = sceneCursor.get(cue.sceneId) ?? 0
    while (index < list.length && usedEdited.has(list[index].id)) {
      index += 1
    }
    sceneCursor.set(cue.sceneId, index + 1)
    const match = list[index]
    if (!match) return cue
    usedEdited.add(match.id)
    return {
      ...cue,
      ...(preserveTimes ? { start: match.start, end: match.end } : {}),
      text: match.text,
      emphasis: match.emphasis,
      emphasisColor: match.emphasisColor,
      edited: true,
      originalText: cue.text,
      originalEmphasis: [...cue.emphasis],
    }
  })
}

export function retimeSubtitleCuesToScenes(
  cues: SubtitleCue[],
  plannedScenes: NewsReportScene[],
  timedScenes: Array<
    NewsReportScene & {
      start: number
      end: number
      alignment?: Array<{ text: string; start: number; end: number }>
    }
  >,
  options: { maxCaptionCharacters?: number } = {}
) {
  if (!timedScenes.length) return []
  // 레거시 end-cta 오버레이(장면 없음)만 제외. 장면 기반 end-cta 자막은 유지.
  const usableCues = cues.filter(
    (cue) => cue.sceneId || !cue.id.startsWith("end-cta")
  )
  const grouped = groupCuesByScene(usableCues, plannedScenes)

  return timedScenes.flatMap((scene, sceneIndex) => {
    // 음성이 만든 단어 타임스탬프가 있으면 내용·구간 모두 그걸 우선한다.
    const speechCues = subtitleCuesFromSpeechAlignment(scene, {
      maxCharacters: options.maxCaptionCharacters,
    })
    if (speechCues.length) return speechCues

    const sceneCues = grouped[sceneIndex]?.length
      ? grouped[sceneIndex]
      : captionLinesForScene(scene).map((text, textIndex) => ({
          id: isEndCtaScene(scene)
            ? `end-cta-${textIndex + 1}`
            : `report-caption-${sceneIndex + 1}-${textIndex + 1}`,
          sceneId: scene.id,
          start: scene.start,
          end: scene.end,
          text,
          emphasis: [...new Set(text.match(EMPHASIS) ?? [])],
          emphasisColor: "yellow" as const,
        }))
    if (!sceneCues.length) return []
    const duration = Math.max(0.1, scene.end - scene.start)
    const weights = sceneCues.map((cue) =>
      Math.max(0.1, cue.end - cue.start || estimateReportDuration(cue.text))
    )
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let elapsedWeight = 0
    return sceneCues.map((cue, cueIndex) => {
      const start = scene.start + (duration * elapsedWeight) / totalWeight
      elapsedWeight += weights[cueIndex]
      const end =
        cueIndex === sceneCues.length - 1
          ? scene.end
          : scene.start + (duration * elapsedWeight) / totalWeight
      return {
        ...cue,
        sceneId: scene.id,
        start: round(start),
        end: round(end),
      }
    })
  })
}

/** TTS/ASR 단어 정렬 → 읽기 좋은 자막 칸(내용+시간). 단어 하나씩 깜빡이지 않게 묶는다. */
export function subtitleCuesFromSpeechAlignment(
  scene: NewsReportScene & {
    start: number
    end: number
    alignment?: SpeechAlignmentUnit[]
  },
  options: { maxCharacters?: number } = {}
) {
  const segments = combineCalendarDateTokens(
    timedSubtitleTokens(scene.alignment ?? []).filter(
      (segment) =>
        segment.text.trim() &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end >= segment.start
    )
  ).sort((left, right) => left.start - right.start)
  if (!segments.length) return [] as SubtitleCue[]

  const sceneDuration = Math.max(0.2, scene.end - scene.start)
  const maxChars = Math.max(10, Math.floor(options.maxCharacters ?? 30))
  const groups = partitionSpeechTokens(segments, maxChars).map((group) => ({
    text: group.text,
    start: Math.max(0, group.start),
    end: Math.max(
      Math.max(0, group.start) + 0.12,
      Math.min(sceneDuration, group.end)
    ),
  }))

  const idPrefix = scene.visual === "quote" ? "quote-caption" : "speech-caption"
  return groups.map((chunk, index) => ({
    id: `${idPrefix}-${scene.id}-${index + 1}`,
    sceneId: scene.id,
    start: round(scene.start + Math.max(0, chunk.start)),
    end: round(
      Math.max(
        scene.start + chunk.start + 0.2,
        scene.start + Math.min(sceneDuration, chunk.end)
      )
    ),
    text: chunk.text,
    emphasis: [...new Set(chunk.text.match(EMPHASIS) ?? [])],
    emphasisColor: "yellow" as const,
  })) satisfies SubtitleCue[]
}

function timedSubtitleTokens(segments: SpeechAlignmentUnit[]) {
  return segments.flatMap((segment) => {
    const text = cleanPhrase(segment.text)
    if (!text) return []
    const tokens = text.split(/\s+/).filter(Boolean)
    if (tokens.length <= 1) {
      return [{ ...segment, text } satisfies TimedSpeechToken]
    }
    const weights = tokens.map((token) => Math.max(1, comparableLength(token)))
    const total = weights.reduce((sum, value) => sum + value, 0)
    const duration = Math.max(0.12, segment.end - segment.start)
    let elapsed = 0
    return tokens.map((token, index) => {
      const start = segment.start + (duration * elapsed) / total
      elapsed += weights[index]!
      const end =
        index === tokens.length - 1
          ? segment.end
          : segment.start + (duration * elapsed) / total
      return {
        text: token,
        start,
        end,
        boundaryAfter:
          index === tokens.length - 1 && segment.boundaryAfter === true,
      } satisfies TimedSpeechToken
    })
  })
}

/** 연·월·일은 Whisper 구간이 갈려도 하나의 날짜 자막 단위로 유지한다. */
function combineCalendarDateTokens(tokens: TimedSpeechToken[]) {
  const combined: typeof tokens = []
  for (let index = 0; index < tokens.length; index += 1) {
    const year = tokens[index]
    const month = tokens[index + 1]
    const day = tokens[index + 2]
    if (
      year &&
      month &&
      day &&
      /^\d{4}년$/u.test(cleanPhrase(year.text)) &&
      /^\d{1,2}월$/u.test(cleanPhrase(month.text)) &&
      /^\d{1,2}일$/u.test(cleanPhrase(day.text))
    ) {
      combined.push({
        text: `${cleanPhrase(year.text)} ${cleanPhrase(month.text)} ${cleanPhrase(day.text)}`,
        start: year.start,
        end: day.end,
        boundaryAfter: day.boundaryAfter,
        preferredBreakAfter: true,
      })
      index += 2
      continue
    }
    if (year) combined.push(year)
  }
  return combined
}

/**
 * 전체 발화를 한 번에 최적화한다. 각 자막은 반드시 연속된 단어 범위이며,
 * 시작·끝 시간은 그 범위의 첫 단어와 마지막 단어에서만 가져온다.
 */
function partitionSpeechTokens(tokens: TimedSpeechToken[], maxChars: number) {
  const best = Array<{
    score: number
    end: number
    text: string
  } | null>(tokens.length + 1).fill(null)
  best[tokens.length] = { score: 0, end: tokens.length, text: "" }

  for (let start = tokens.length - 1; start >= 0; start -= 1) {
    let text = ""
    let selected: (typeof best)[number] = null
    for (let end = start; end < tokens.length; end += 1) {
      const token = tokens[end]!
      text = joinSpokenTokens(text, cleanPhrase(token.text))
      const length = captionVisualUnits(text)
      if (end > start && length > maxChars) break

      const next = tokens[end + 1]
      const continuation = best[end + 1]
      if (!continuation) continue
      const hardBoundary =
        token.boundaryAfter === true ||
        /[,;:，；：–—.!?。！？]["'”’)]*$/.test(text)
      const remainingLength = captionVisualUnits(
        spokenTextUntilBoundary(tokens, end + 1)
      )
      let score =
        spokenCaptionBoundaryScore({
          text,
          nextText: next?.text ?? "",
          gap: next ? next.start - token.end : 0,
          duration: token.end - tokens[start]!.start,
          length,
          maxChars,
          remainingLength,
          isLast: end === tokens.length - 1,
        }) + continuation.score

      // 자막 수를 필요 이상 늘리지 않되, 날짜·문장 끝은 독립 의미 단위로 둔다.
      score -= 22
      if (token.preferredBreakAfter) score += 82
      if (hardBoundary) score += 32
      if (/[,;:，；：–—]$/u.test(text)) score += 70
      if (/^(?:오로지|바로|딱|절대|결코)$/u.test(cleanPhrase(token.text))) {
        score -= 100
      }
      if (next && splitsFixedExpression(token.text, next.text)) score -= 180

      if (!selected || score > selected.score) {
        selected = { score, end, text }
      }
      if (hardBoundary) break
    }

    // 한 어절이 설정 폭보다 길어도 단어를 잘라 시간을 조작하지 않는다.
    best[start] = selected ?? {
      score: (best[start + 1]?.score ?? 0) - 200,
      end: start,
      text: cleanPhrase(tokens[start]!.text),
    }
  }

  const groups: Array<{ text: string; start: number; end: number }> = []
  let cursor = 0
  while (cursor < tokens.length) {
    const selected = best[cursor]!
    const end = Math.max(cursor, selected.end)
    groups.push({
      text: selected.text,
      start: tokens[cursor]!.start,
      end: tokens[end]!.end,
    })
    cursor = end + 1
  }
  return groups
}

function splitsFixedExpression(left: string, right: string) {
  const current = cleanPhrase(left)
  const next = cleanPhrase(right)
  return (
    startsWithBoundParticle(next) ||
    splitsNumberAndUnit(current, next) ||
    (endsWithCaseParticle(current) && startsWithDependentPredicate(next)) ||
    (/(?:있어야|해야|되어야|돼야)$/u.test(current) &&
      /^(?:할|될|하는|되는)(?:\s|$)/u.test(next)) ||
    (/(?:오로지|바로|딱|절대|결코)$/u.test(current) &&
      /^[가-힣0-9]/u.test(next))
  )
}

function spokenCaptionBoundaryScore(input: {
  text: string
  nextText: string
  gap: number
  duration: number
  length: number
  maxChars: number
  remainingLength: number
  isLast: boolean
}) {
  const minimum = input.maxChars * 0.42
  const preferred = input.maxChars * 0.78
  let score = -Math.abs(input.length - preferred)
  if (input.length < minimum) score -= (minimum - input.length) * 3
  if (input.isLast) score += 100
  if (/[.!?。！？]["'”’)]*$/.test(input.text)) score += 80
  else if (/[,;:，；：–—]$/.test(input.text)) score += 72
  if (input.gap >= 0.38) score += 38
  else if (input.gap >= 0.22) score += 20
  if (startsWithClauseConnector(input.nextText)) score += 22
  if (isBareClauseConnector(input.text)) score -= 180
  if (looksLikeSpokenPredicateEnd(input.text)) score += 14
  // 주격·목적격 조사는 한국어 호흡 경계가 될 수 있다. 단,
  // 뒤에 연결 서술어가 오면 아래 패널티가 이 점수보다 우선한다.
  if (/(?:이|가|을|를)[,.;:!?。！？]?$/u.test(input.text)) score += 12
  if (input.duration >= 3.8) score += 8
  if (startsWithBoundParticle(input.nextText)) score -= 120
  if (
    endsWithCaseParticle(input.text) &&
    startsWithDependentPredicate(input.nextText)
  ) {
    score -= 120
  }
  if (
    startsWithClauseConnector(input.text) &&
    endsWithCaseParticle(input.text)
  ) {
    score -= 100
  }
  if (endsWithDanglingModifier(input.text)) score -= 45
  if (endsWithAdverbBeforeArgument(input.text, input.nextText)) score -= 100
  if (splitsNumberAndUnit(input.text, input.nextText)) score -= 140
  // 문장 끝에 0.2~0.4초짜리 한 어절 자막이 혼자 남지 않게 한다.
  // 앞 자막을 조금 일찍 끝내면 마지막 문구를 자연스럽게 묶을 수 있다.
  if (input.remainingLength > 0 && input.remainingLength < minimum * 0.9) {
    score -= 50 + (minimum * 0.9 - input.remainingLength) * 5
  }
  return score
}

function spokenTextUntilBoundary(
  segments: Array<{ text: string; boundaryAfter?: boolean }>,
  startIndex: number
) {
  let text = ""
  for (let index = startIndex; index < segments.length; index += 1) {
    text = joinSpokenTokens(text, cleanPhrase(segments[index]!.text))
    if (segments[index]!.boundaryAfter || /[.!?。！？]["'”’)]*$/.test(text)) {
      break
    }
  }
  return text
}

function joinSpokenTokens(left: string, right: string) {
  if (!left) return right
  if (!right) return left
  const standaloneI =
    cleanPhrase(right) === "이" && !endsWithFinalConsonant(left)
  return (!standaloneI && startsWithBoundParticle(right)) ||
    /^[,.;:!?%…)}\]”’]/.test(right)
    ? `${left}${right}`
    : `${left} ${right}`
}

function endsWithFinalConsonant(value: string) {
  const last = [...cleanPhrase(value).replace(/[^가-힣]/gu, "")].at(-1)
  if (!last) return false
  return (last.charCodeAt(0) - 0xac00) % 28 !== 0
}

function startsWithBoundParticle(value: string) {
  return /^(?:은|는|이|가|을|를|의|에|에서|에게|께|로|으로|와|과|도|만|부터|까지|보다|처럼|마다|조차|마저|라도|이나|나)(?:\s|$|[,.;:!?])/u.test(
    cleanPhrase(value)
  )
}

function startsWithClauseConnector(value: string) {
  return /^(?:그런데|하지만|그러나|그래서|그리고|다만|반면|결국|따라서|한편|즉|또)(?:\s|$|[,.;:!?])/u.test(
    cleanPhrase(value)
  )
}

function isBareClauseConnector(value: string) {
  return /^(?:그런데|하지만|그러나|그래서|그리고|다만|반면|결국|따라서|한편|즉|또)[,.;:!?]?$/u.test(
    cleanPhrase(value)
  )
}

function endsWithCaseParticle(value: string) {
  return /(?:은|는|이|가|을|를|의|에|에서|에게|로|으로)$/u.test(
    cleanPhrase(value)
  )
}

function startsWithDependentPredicate(value: string) {
  return /^(?:아니라|하면서|있어야|해야|되어야|돼야|할|될|위한|대한|따른|[가-힣]+(?:고|고자|하며|하면서|해서|하여|려고|려는|려던|는|던|도록|다가|지만|는데))(?:\s|$)/u.test(
    cleanPhrase(value)
  )
}

function looksLikeSpokenPredicateEnd(value: string) {
  return /(?:했어|됐어|있어|없어|이야|거야|한다|했다|된다|됐다|있다|없다|입니다|습니다|까요|일까|아닐까|거든|잖아|는데|지만)[,.;:!?。！？]?$/u.test(
    cleanPhrase(value)
  )
}

function endsWithDanglingModifier(value: string) {
  const text = cleanPhrase(value)
  return (
    /(?:의|에|에서|에게|께|로|으로|와|과|위한|대한|따른)$/u.test(text) ||
    /(?:^|\s)(?:그|이|저|어떤|무슨|이런|그런|저런|한|두|세|네|모든|각)$/u.test(
      text
    )
  )
}

function endsWithAdverbBeforeArgument(left: string, right: string) {
  return (
    /(?:하게|히)$/u.test(cleanPhrase(left)) &&
    /^[가-힣]+(?:을|를|이|가|은|는)(?:\s|$)/u.test(cleanPhrase(right))
  )
}

function splitsNumberAndUnit(left: string, right: string) {
  return (
    /[\d,.%]$/u.test(cleanPhrase(left)) &&
    /^(?:원|명|개|건|번|배|조|억|만|천|백|년|월|일|시간|분|초|%|은|는|이|가|을|를|도|만)(?:\s|$)/u.test(
      cleanPhrase(right)
    )
  )
}

function groupCuesByScene(cues: SubtitleCue[], scenes: NewsReportScene[]) {
  const sceneIndexes = new Map(
    scenes.map((scene, index) => [scene.id, index] as const)
  )
  if (cues.every((cue) => cue.sceneId && sceneIndexes.has(cue.sceneId))) {
    const grouped = scenes.map(() => [] as SubtitleCue[])
    for (const cue of cues) {
      grouped[sceneIndexes.get(cue.sceneId!)!].push(cue)
    }
    return grouped
  }
  return groupSequentialItemsByScene(scenes, cues, (cue) => cue.text)
}

function groupSequentialTextsByScene(
  scenes: NewsReportScene[],
  texts: string[]
) {
  return groupSequentialItemsByScene(scenes, texts, (text) => text)
}

function groupSequentialItemsByScene<T>(
  scenes: NewsReportScene[],
  items: T[],
  textOf: (item: T) => string
) {
  const grouped = scenes.map(() => [] as T[])
  let itemIndex = 0
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
    const targetLength = comparableLength(scenes[sceneIndex].narration)
    let assignedLength = 0
    while (itemIndex < items.length) {
      const remainingScenes = scenes.length - sceneIndex - 1
      const remainingItems = items.length - itemIndex
      if (assignedLength > 0 && remainingItems <= remainingScenes) break
      const item = items[itemIndex]
      grouped[sceneIndex].push(item)
      assignedLength += comparableLength(textOf(item))
      itemIndex += 1
      if (assignedLength >= Math.max(1, targetLength * 0.9)) break
    }
  }
  if (itemIndex < items.length && grouped.length) {
    grouped[grouped.length - 1].push(...items.slice(itemIndex))
  }
  return grouped
}

function comparableLength(value: string) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, "").length
}

/** FFmpeg 미리보기와 같은 기준으로 자막 폭을 계산한다. */
function captionVisualUnits(value: string) {
  const visual = [...value].reduce((sum, character) => {
    if (/\s/.test(character)) return sum + 0.35
    if (/[\u0000-\u024f]/.test(character)) return sum + 0.58
    return sum + 1
  }, 0)
  return Math.max(visual, [...value].length)
}

function ngramRecall(left: string, right: string, size: number) {
  const leftGrams = ngrams(left, size)
  const rightGrams = new Set(ngrams(right, size))
  if (!leftGrams.length) return 0
  return (
    leftGrams.filter((gram) => rightGrams.has(gram)).length / leftGrams.length
  )
}

function ngramDice(left: string, right: string, size: number) {
  const leftGrams = new Set(ngrams(left, size))
  const rightGrams = new Set(ngrams(right, size))
  if (!leftGrams.size || !rightGrams.size) return 0
  let shared = 0
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) shared += 1
  }
  return (2 * shared) / (leftGrams.size + rightGrams.size)
}

function ngrams(value: string, size: number) {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]/g, "")
  if (normalized.length < size) return normalized ? [normalized] : []
  return Array.from({ length: normalized.length - size + 1 }, (_, index) =>
    normalized.slice(index, index + size)
  )
}

export function reportCaptionPhrases(script: string) {
  const phrases = script
    .split(/\r?\n+/)
    .map(cleanPhrase)
    .filter(Boolean)
  return phrases.length >= 2 ? phrases : []
}

export function contextualEndCtaText(
  title: string,
  keywords: string[] = [],
  script = ""
) {
  const candidates = [
    ...keywords,
    ...title.replace(/[^0-9A-Za-z가-힣\s]/g, " ").split(/\s+/),
    ...script.replace(/[^0-9A-Za-z가-힣\s]/g, " ").split(/\s+/),
  ]
    .map((value) => value.trim())
    .filter(
      (value) =>
        value.length >= 2 &&
        value.length <= 8 &&
        !CTA_GENERIC_TERMS.has(value) &&
        !/^(?:합니다|입니다|있습니다|했습니다)$/.test(value)
    )
  const topic = candidates[0]
  if (!topic) return NEWS_END_CTA_TEXT
  const question = looksLikePersonName(topic)
    ? `${topic}의 의견에 어떻게 생각해?`
    : `${topic}에 대해 어떻게 생각해?`
  return `${question}\n댓글로 남겨줘.`
}

function looksLikePersonName(value: string) {
  // 한글 성명은 보통 2~3글자. 4글자 이상 합성어(조작기소 등)는 주제로 본다.
  if (!/^[가-힣]{2,3}$/.test(value)) return false
  return !/(?:법|세|당|국|부|원|회|안|론|비|금|표|률|특검|검찰|정부|국회|기자)$/.test(
    value
  )
}

function cleanPhrase(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function bestSourceSegment(
  narration: string,
  transcript: TranscriptSegment[],
  sourceStart: number,
  sourceEnd: number
) {
  const tokens = new Set(
    narration
      .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  )
  return transcript
    .filter((segment) => segment.end > sourceStart && segment.start < sourceEnd)
    .map((segment) => ({
      ...segment,
      score: [...tokens].filter((token) => segment.text.includes(token)).length,
    }))
    .sort((left, right) => right.score - left.score)[0]
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
