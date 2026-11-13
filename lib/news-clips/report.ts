import {
  quoteOutputDurationSeconds,
  scaleQuoteTimelineSeconds,
  unscaleQuoteTimelineSeconds,
} from "./playback.ts"
import { snapSourceRangeToSpeech } from "./speech-bounds.ts"
import { clearLegacyAutomaticCaptionBoundaries } from "./transcript.ts"
import type {
  NewsReportAudioMode,
  NewsReportScene,
  NewsReportVisualMode,
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

/** 신규 음성 정책을 우선하고, 저장된 레거시 장면만 visual로 복원한다. */
export function reportSceneAudioMode(
  scene: Pick<NewsReportScene, "audioMode" | "visual">
): NewsReportAudioMode {
  return scene.audioMode ?? (scene.visual === "quote" ? "original" : "tts")
}

/** 화면 역할은 음성 정책과 독립적이며 레거시 visual은 최후 호환값이다. */
export function reportSceneVisualMode(
  scene: Pick<NewsReportScene, "visualMode" | "visual">
): NewsReportVisualMode {
  return scene.visualMode ?? scene.visual
}

/** 보도형 TTS 장면은 유지하고, 이어진 자료화면의 시각 설정만 앞 장면에서 받는다. */
export function resolveReportVisualContinuations<T extends NewsReportScene>(
  scenes: T[]
): T[] {
  let anchor: T | undefined
  return scenes.map((scene, index) => {
    if (index === 0 || scene.continuePreviousVisual !== true || !anchor) {
      anchor = scene
      return scene
    }
    return {
      ...scene,
      visual: anchor.visual,
      visualMode: anchor.visualMode,
      sourceId: anchor.sourceId,
      sourceStart: anchor.sourceStart,
      sourceEnd: anchor.sourceEnd,
      crop: anchor.crop ? { ...anchor.crop } : undefined,
      fit: anchor.fit,
      motion: anchor.motion,
    }
  })
}

/** 합쳐진 자료화면 그룹에서 실제 화면 설정을 소유한 첫 장면을 찾는다. */
export function reportVisualContinuationAnchor<T extends NewsReportScene>(
  scenes: T[],
  sceneId: string
): T | undefined {
  let index = scenes.findIndex((scene) => scene.id === sceneId)
  if (index < 0) return undefined
  while (index > 0 && scenes[index]?.continuePreviousVisual === true) {
    index -= 1
  }
  return scenes[index]
}

/**
 * 보도형의 음성·자막 장면은 그대로 두고, 이어 쓰기로 지정한 자료화면만
 * 하나의 FFmpeg 재생 구간으로 묶는다. 첫 장면의 시작 시각과 화면 설정을
 * 유지하고 마지막 장면 끝까지 길이만 늘리므로 중간에서 영상·모션이
 * 재시작되지 않는다.
 */
export function groupReportVisualContinuationSegments<
  T extends NewsReportScene & { end: number; duration: number },
>(scenes: T[]): T[] {
  const resolved = resolveReportVisualContinuations(scenes)
  return resolved.reduce<T[]>((groups, scene, index) => {
    const previous = groups.at(-1)
    if (index > 0 && scene.continuePreviousVisual === true && previous) {
      groups[groups.length - 1] = {
        ...previous,
        end: scene.end,
        duration:
          Math.round((previous.duration + scene.duration) * 1000) / 1000,
      }
      return groups
    }
    groups.push(scene)
    return groups
  }, [])
}

/** 저장 가능한 전체 대본은 장면 narration에서만 파생한다. */
export function reportScriptFromScenes(scenes: NewsReportScene[]) {
  return scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join("\n")
}

/**
 * 장면이 존재하면 scene narration을 정본으로 사용한다. 장면이 없던 기존
 * 저장 데이터만 reportScript를 유지해 점진적으로 마이그레이션할 수 있다.
 */
export function canonicalReportScript(
  reportScript: string,
  scenes: NewsReportScene[]
) {
  return scenes.length ? reportScriptFromScenes(scenes) : reportScript.trim()
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
    [...bodyScenes]
      .reverse()
      .find((scene) => reportSceneAudioMode(scene) === "tts") ??
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
      part: "outro",
      audioMode: "tts",
      visualMode:
        reportSceneVisualMode(existingCta ?? anchor) === "supporting"
          ? "supporting"
          : "source",
      visual: "source",
      sourceId:
        existingCta?.sourceId ||
        anchor.sourceId ||
        primarySourceId ||
        undefined,
      sourceStart: round(sourceStart),
      sourceEnd: round(sourceEnd),
      ...(existingCta?.crop ? { crop: existingCta.crop } : {}),
      ...(existingCta?.fit ? { fit: existingCta.fit } : {}),
      ...(existingCta?.motion ? { motion: existingCta.motion } : {}),
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
        (reportSceneAudioMode(scene) === "original"
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
  if (reportSceneAudioMode(scene) !== "original") return true
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
    if (reportSceneAudioMode(scene) !== "original") return scene
    // 무음컷 조각은 원본 음성을 유지한다. (빈 narration 또는 …-cut-N id)
    if (!scene.narration.trim() || /-cut-\d+/i.test(scene.id)) return scene
    const sourceId = scene.sourceId || primarySourceId
    const transcript = transcripts[sourceId]
    return transcript?.length &&
      quoteNarrationMatchesTranscript(scene, transcript, ratePercent)
      ? scene
      : {
          ...scene,
          audioMode: "tts" as const,
          visualMode:
            reportSceneVisualMode(scene) === "quote"
              ? ("source" as const)
              : reportSceneVisualMode(scene),
          visual: "source" as const,
        }
  })
}

export function quoteTranscriptAlignment(
  scene: NewsReportScene,
  transcript: TranscriptSegment[]
) {
  if (reportSceneAudioMode(scene) !== "original") return []
  // 단어 타임스탬프를 전 구간 flat 정렬하면, 겹친 ASR 구간 단어가 섞여
  // "2026년 11월 대한민국은 / 1일 죽고…"처럼 문장이 깨지고 자막이 겹친다.
  // 전사 문장(segment) 단위로 맞추고 시간 겹침만 정리한다.
  const overlapping = transcript.filter((segment) => {
    const speech = transcriptSegmentSpeechBounds(segment)
    return (
      segment.text.trim() &&
      speech.end > scene.sourceStart + 0.001 &&
      speech.start < scene.sourceEnd - 0.001
    )
  })
  // 경계에 걸친 문장 하나를 통째로 버리면 영상은 재생되는데 자막만 몇 초 뒤에
  // 시작한다. 겹친 문장은 유지하고, 아래 단어 단계에서 범위 안의 완전한 단어만 쓴다.
  const pool = overlapping
    .slice()
    .sort((left, right) => left.start - right.start || left.end - right.end)

  // 1) 겹친 ASR 문장은 문장 순서로 정리한다.
  const keptSegments: TranscriptSegment[] = []
  for (const segment of pool) {
    const text = segment.text.replace(/\s+/g, " ").trim()
    if (!text) continue
    const speech = transcriptSegmentSpeechBounds(segment)
    const start = Math.max(scene.sourceStart, speech.start)
    const end = Math.max(start + 0.08, Math.min(scene.sourceEnd, speech.end))
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
    const timedWords = (segment.words ?? []).filter(
      (word) =>
        word.text.trim() &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start
    )
    const words = timedWords.filter(
      (word) =>
        word.start >= scene.sourceStart - 0.01 &&
        word.end <= scene.sourceEnd + 0.01 &&
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
    // 단어 시간이 있는데 모든 단어가 선택 경계 밖이면 텍스트만 임의로 얹지 않는다.
    if (timedWords.length) continue
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
  lineCharacters = 18
) {
  const sourceStart = Math.min(range.start, range.end)
  const sourceEnd = Math.max(range.start, range.end)
  if (sourceEnd - sourceStart < 0.2) return transcript
  const cleanedTranscript = clearLegacyAutomaticCaptionBoundaries(transcript, {
    start: sourceStart,
    end: sourceEnd,
  })
  const overlapping = cleanedTranscript.filter((segment) => {
    const speech = transcriptSegmentSpeechBounds(segment)
    return speech.end > sourceStart + 0.001 && speech.start < sourceEnd - 0.001
  })
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
    part: "body",
    audioMode: "original",
    visualMode: "quote",
    visual: "quote",
    sourceStart,
    sourceEnd,
  }
  const alignment = quoteTranscriptAlignment(scene, cleanedTranscript)
  const duration = sourceEnd - sourceStart
  const preferredCharacters = Math.max(10, Math.floor(lineCharacters))
  const cues = subtitleCuesFromSpeechAlignment(
    { ...scene, start: 0, end: duration, alignment },
    {
      maxCharacters: preferredCharacters * 2,
      preferredCharacters,
    }
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
    ...cleanedTranscript.filter(
      (segment) => transcriptSegmentSpeechBounds(segment).end <= sourceStart
    ),
    ...generated,
    ...cleanedTranscript.filter(
      (segment) => transcriptSegmentSpeechBounds(segment).start >= sourceEnd
    ),
  ].sort((left, right) => left.start - right.start || left.end - right.end)
}

/** 표시용 segment tail과 실제 발화 범위를 분리한다. */
function transcriptSegmentSpeechBounds(segment: TranscriptSegment) {
  const words = segment.words.filter(
    (word) =>
      word.text.trim() &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start
  )
  if (!words.length) return { start: segment.start, end: segment.end }
  return {
    start: Math.min(...words.map((word) => word.start)),
    end: Math.max(...words.map((word) => word.end)),
  }
}

/** 각 단어는 시작점이 속한 자막 하나에만 둔다. */
function repairReviewTranscriptWordOwnership(
  transcript: TranscriptSegment[],
  sourceStart: number,
  sourceEnd: number
) {
  const overlapping = transcript
    .filter((segment) => {
      const speech = transcriptSegmentSpeechBounds(segment)
      return speech.end > sourceStart && speech.start < sourceEnd
    })
    .slice()
    .sort((left, right) => {
      const leftSpeech = transcriptSegmentSpeechBounds(left)
      const rightSpeech = transcriptSegmentSpeechBounds(right)
      return (
        leftSpeech.start - rightSpeech.start || leftSpeech.end - rightSpeech.end
      )
    })
  const repairedById = new Map<string, TranscriptSegment>()
  let changed = false

  for (const [index, segment] of overlapping.entries()) {
    const segmentStart = transcriptSegmentSpeechBounds(segment).start
    const nextSegment = overlapping[index + 1]
    const nextStart = nextSegment
      ? transcriptSegmentSpeechBounds(nextSegment).start
      : sourceEnd + 0.001
    const seen = new Set<string>()
    const words = segment.words.filter((word) => {
      if (
        word.start < segmentStart - 0.001 ||
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
        word.start >= segmentStart - 0.001 && word.start < nextStart - 0.001
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
): NewsReportScene[] {
  const sentences = splitReportSentences(script)
  const available = Math.max(1, sourceEnd - sourceStart)
  return sentences.map((narration, index) => {
    const saved = preferred?.[index]
    const part =
      saved?.part === "lead" || saved?.part === "body"
        ? saved.part
        : index === 0
          ? "lead"
          : "body"
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
    const visualMode =
      saved?.visualMode === "still"
        ? "still"
        : usesSupportingSource
          ? "supporting"
          : "source"
    return {
      id:
        saved?.id ||
        (part === "lead" ? "report-lead-1" : `report-body-${index}`),
      narration,
      part,
      // 보도형은 항상 TTS가 기준 음성이고 원본은 무음 자료화면으로만 쓴다.
      audioMode: "tts",
      visualMode,
      visual: "source",
      sourceId: saved?.sourceId || defaultSourceId,
      sourceStart: round(snapped.start),
      sourceEnd: round(Math.max(snapped.start + 0.5, snapped.end)),
      ...(saved?.crop ? { crop: saved.crop } : {}),
      ...(saved?.fit ? { fit: saved.fit } : {}),
      ...(saved?.motion ? { motion: saved.motion } : {}),
      ...(saved?.continuePreviousVisual === true
        ? { continuePreviousVisual: true }
        : {}),
    } satisfies NewsReportScene
  })
}

export function reportSubtitles(
  scenes: NewsReportScene[],
  durations?: number[],
  captionPhrases?: string[],
  transcript: TranscriptSegment[] = [],
  options: {
    maxCaptionCharacters?: number
    preferredCaptionCharacters?: number
  } = {}
) {
  const sceneWeights = scenes.map((scene, index) =>
    Math.max(
      0.5,
      durations?.[index] ??
        (reportSceneAudioMode(scene) === "original"
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
    if (reportSceneAudioMode(scene) === "original" && transcript.length) {
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
        {
          maxCharacters: options.maxCaptionCharacters,
          preferredCharacters: options.preferredCaptionCharacters,
        }
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
      const usesPhraseIds =
        phrases.length > 0 && reportSceneAudioMode(scene) !== "original"
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

/**
 * 여러 장면을 한 번에 합성한 TTS 단어열에서 각 장면의 시작 단어를 찾는다.
 * 글자 수 비례만 사용하면 `30%`가 `삼십 / 퍼센트`로 발음되는 순간 이후
 * 장면 경계가 한 어절씩 밀리므로, 다음 문장의 실제 첫 어절들을 우선 매칭한다.
 */
export function continuousSpeechWordBoundaries(
  narrations: string[],
  words: Array<{ text: string }>
) {
  if (!narrations.length) return [0]
  if (!words.length) {
    return Array.from({ length: narrations.length + 1 }, () => 0)
  }

  const sceneWeights = narrations.map(spokenUnitCount)
  const totalSceneWeight = sceneWeights.reduce((sum, value) => sum + value, 0)
  const boundaries = [0]
  let elapsedSceneWeight = 0

  for (let sceneIndex = 1; sceneIndex < narrations.length; sceneIndex += 1) {
    elapsedSceneWeight += sceneWeights[sceneIndex - 1]!
    const fallback = Math.round(
      (words.length * elapsedSceneWeight) / Math.max(1, totalSceneWeight)
    )
    const previous = boundaries.at(-1) ?? 0
    const remainingScenes = narrations.length - sceneIndex
    const minimum = Math.min(
      words.length,
      previous + (words.length >= narrations.length ? 1 : 0)
    )
    const maximum = Math.max(
      minimum,
      words.length - Math.min(remainingScenes, words.length)
    )
    const opening = narrations[sceneIndex]!
      .split(/\s+/)
      .map(speechMatchKey)
      .filter(Boolean)
      .slice(0, 4)
    const requiredMatches = Math.min(2, opening.length)
    let selected = -1
    let selectedMatches = -1
    let selectedDistance = Number.POSITIVE_INFINITY

    if (requiredMatches > 0) {
      for (let candidate = minimum; candidate <= maximum; candidate += 1) {
        let matches = 0
        while (
          matches < opening.length &&
          candidate + matches < words.length &&
          speechMatchKey(words[candidate + matches]!.text) === opening[matches]
        ) {
          matches += 1
        }
        if (matches < requiredMatches) continue
        const distance = Math.abs(candidate - fallback)
        if (
          matches > selectedMatches ||
          (matches === selectedMatches && distance < selectedDistance)
        ) {
          selected = candidate
          selectedMatches = matches
          selectedDistance = distance
        }
      }
    }

    boundaries.push(
      selected >= 0 ? selected : Math.max(minimum, Math.min(maximum, fallback))
    )
  }
  boundaries.push(words.length)
  return boundaries
}

function speechMatchKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
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
    reportSceneAudioMode(scene) === "original" || isEndCtaScene(scene)
      ? captionLinesForScene(scene)
      : ([] as string[])
  )
  const sourceIndexes = scenes
    .map((scene, index) =>
      reportSceneAudioMode(scene) === "original" || isEndCtaScene(scene)
        ? -1
        : index
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
  if (reportSceneAudioMode(scene) === "original") {
    return chunkCaptionText(scene.narration)
  }
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
    preferredCaptionCharacters?: number
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
    {
      maxCaptionCharacters: options.maxCaptionCharacters,
      preferredCaptionCharacters: options.preferredCaptionCharacters,
    }
  )
  const timed = retimeSubtitleCuesToScenes(fresh, plannedScenes, timedScenes, {
    maxCaptionCharacters: options.maxCaptionCharacters,
    preferredCaptionCharacters: options.preferredCaptionCharacters,
  })
  return timed
}

/** 실측으로 다시 잡은 구간에 사용자가 고친 문구·강조만 얹는다. */
export function mergeEditedSubtitleText(
  timed: SubtitleCue[],
  edited: SubtitleCue[],
  options: { preserveTimes?: boolean; trustExactId?: boolean } = {}
) {
  const manual = edited.filter((cue) => cue.edited === true)
  if (!manual.length) return timed
  const byId = new Map(manual.map((cue) => [cue.id, cue] as const))
  const byScene = new Map<string, SubtitleCue[]>()
  for (const cue of manual) {
    if (!cue.sceneId) continue
    const sceneId = cue.sceneId ?? ""
    const list = byScene.get(sceneId) ?? []
    list.push(cue)
    byScene.set(sceneId, list)
  }
  const usedEdited = new Set<string>()
  const sceneCursor = new Map<string, number>()
  const preserveTimes = options.preserveTimes === true
  return timed.map((cue) => {
    const byExactId = byId.get(cue.id)
    const exactIdStillMatches =
      byExactId &&
      (options.trustExactId === true ||
        !byExactId.originalText ||
        captionMatchKey(byExactId.originalText) === captionMatchKey(cue.text))
    let match = exactIdStillMatches ? byExactId : undefined
    if (!cue.sceneId && !match) return cue
    const sceneId = cue.sceneId ?? ""
    const list = byScene.get(sceneId) ?? []
    const textMatch = list.find(
      (item) =>
        !usedEdited.has(item.id) &&
        Boolean(item.originalText) &&
        captionMatchKey(item.originalText ?? "") === captionMatchKey(cue.text)
    )
    match ??= textMatch
    if (!match) {
      // originalText가 없는 레거시 수정만 장면 안 순서로 복원한다. 기준 문구가
      // 있는데 일치하지 않는 수정본을 새 자막에 순서대로 덮으면 싱크가 섞인다.
      const legacy = list.filter((item) => !item.originalText)
      let index = sceneCursor.get(sceneId) ?? 0
      while (index < legacy.length && usedEdited.has(legacy[index].id)) {
        index += 1
      }
      sceneCursor.set(sceneId, index + 1)
      match = legacy[index]
    }
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

function captionMatchKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
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
  options: {
    maxCaptionCharacters?: number
    preferredCaptionCharacters?: number
  } = {}
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
      preferredCharacters: options.preferredCaptionCharacters,
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

/**
 * 보도형의 잠긴 문구·줄바꿈·자막 개수는 유지하되, 시간은 실제 TTS 단어
 * 타임스탬프에 다시 붙인다. 대본 길이로 미리 추정한 시간을 그대로 쓰면
 * Typecast의 실제 호흡과 문장별 속도 차이가 누적되어 뒤로 갈수록 어긋난다.
 */
export function retimeLockedSubtitleCuesToSpeech(
  cues: SubtitleCue[],
  timedScenes: Array<
    NewsReportScene & {
      start: number
      end: number
      alignment?: SpeechAlignmentUnit[]
    }
  >
) {
  if (!cues.length || !timedScenes.length) return cues
  const grouped = groupCuesByScene(cues, timedScenes)

  return timedScenes.flatMap((scene, sceneIndex) => {
    const sceneCues = grouped[sceneIndex] ?? []
    if (!sceneCues.length) return []
    const words = (scene.alignment ?? [])
      .filter(
        (word) =>
          word.text.trim() &&
          Number.isFinite(word.start) &&
          Number.isFinite(word.end) &&
          word.end >= word.start
      )
      .sort((left, right) => left.start - right.start)
    if (!words.length) return sceneCues

    const boundaries = displayCueWordBoundaries(
      sceneCues.map((cue) => cue.text),
      words
    )

    const sceneDuration = Math.max(0.1, scene.end - scene.start)
    return sceneCues.map((cue, cueIndex) => {
      const first = words[boundaries[cueIndex] ?? 0]
      const last = words[Math.max(0, (boundaries[cueIndex + 1] ?? 0) - 1)]
      const fallbackStart =
        scene.start + (sceneDuration * cueIndex) / sceneCues.length
      const fallbackEnd =
        scene.start + (sceneDuration * (cueIndex + 1)) / sceneCues.length
      const start = first ? scene.start + first.start : fallbackStart
      const end = last ? scene.start + last.end : fallbackEnd
      return {
        ...cue,
        sceneId: scene.id,
        start: round(Math.max(scene.start, Math.min(scene.end, start))),
        end: round(
          Math.max(
            Math.max(scene.start, Math.min(scene.end, start)) + 0.04,
            Math.min(scene.end, end)
          )
        ),
      }
    })
  })
}

/** 검수 대본 문구는 보존하고 실제 TTS 어절의 앞뒤 경계만 대응한다. */
function displayCueWordBoundaries(
  cueTexts: string[],
  words: Array<{ text: string }>
) {
  if (!cueTexts.length) return [0]
  if (!words.length) return Array.from({ length: cueTexts.length + 1 }, () => 0)
  const cueWeights = cueTexts.map(spokenUnitCount)
  const totalCueWeight = cueWeights.reduce((sum, value) => sum + value, 0)
  const boundaries = [0]
  let elapsedCueWeight = 0

  for (let cueIndex = 1; cueIndex < cueTexts.length; cueIndex += 1) {
    elapsedCueWeight += cueWeights[cueIndex - 1]!
    const fallback = Math.round(
      (words.length * elapsedCueWeight) / Math.max(1, totalCueWeight)
    )
    const previousBoundary = boundaries.at(-1) ?? 0
    const remainingCues = cueTexts.length - cueIndex
    const minimum = Math.min(
      words.length,
      previousBoundary + (words.length >= cueTexts.length ? 1 : 0)
    )
    const maximum = Math.max(
      minimum,
      words.length - Math.min(remainingCues, words.length)
    )
    const nextOpening = cueTexts[cueIndex]!
      .split(/\s+/)
      .map(speechMatchKey)
      .filter(Boolean)
      .slice(0, 4)
    const previousClosing = cueTexts[cueIndex - 1]!
      .split(/\s+/)
      .map(speechMatchKey)
      .filter(Boolean)
      .slice(-4)
    const requiredOpening = Math.min(2, nextOpening.length)
    const requiredClosing = Math.min(2, previousClosing.length)
    let selected = -1
    let selectedScore = Number.NEGATIVE_INFINITY

    for (let candidate = minimum; candidate <= maximum; candidate += 1) {
      let openingMatches = 0
      while (
        openingMatches < nextOpening.length &&
        candidate + openingMatches < words.length &&
        speechMatchKey(words[candidate + openingMatches]!.text) ===
          nextOpening[openingMatches]
      ) {
        openingMatches += 1
      }
      let closingMatches = 0
      while (
        closingMatches < previousClosing.length &&
        candidate - closingMatches - 1 >= 0 &&
        speechMatchKey(words[candidate - closingMatches - 1]!.text) ===
          previousClosing[previousClosing.length - closingMatches - 1]
      ) {
        closingMatches += 1
      }
      const openingValid =
        requiredOpening > 0 && openingMatches >= requiredOpening
      const closingValid =
        requiredClosing > 0 && closingMatches >= requiredClosing
      if (!openingValid && !closingValid) continue
      const score =
        openingMatches * 100 +
        closingMatches * 90 -
        Math.abs(candidate - fallback)
      if (score > selectedScore) {
        selected = candidate
        selectedScore = score
      }
    }

    boundaries.push(
      selected >= 0 ? selected : Math.max(minimum, Math.min(maximum, fallback))
    )
  }
  boundaries.push(words.length)
  return boundaries
}

/** TTS/ASR 단어 정렬 → 읽기 좋은 자막 칸(내용+시간). 단어 하나씩 깜빡이지 않게 묶는다. */
export function subtitleCuesFromSpeechAlignment(
  scene: NewsReportScene & {
    start: number
    end: number
    alignment?: SpeechAlignmentUnit[]
  },
  options: { maxCharacters?: number; preferredCharacters?: number } = {}
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
  const preferredChars = Math.max(
    4,
    Math.min(maxChars, Math.floor(options.preferredCharacters ?? maxChars))
  )
  const groups = partitionSpeechTokens(segments, maxChars, preferredChars).map(
    (group) => ({
      text: group.text,
      start: Math.max(0, group.start),
      end: Math.max(
        Math.max(0, group.start) + 0.12,
        Math.min(sceneDuration, group.end)
      ),
    })
  )

  const idPrefix =
    reportSceneAudioMode(scene) === "original"
      ? "quote-caption"
      : "speech-caption"
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
    ...subtitleCueSourceRange(scene, chunk),
    text: chunk.text,
    emphasis: [...new Set(chunk.text.match(EMPHASIS) ?? [])],
    emphasisColor: "yellow" as const,
  })) satisfies SubtitleCue[]
}

function subtitleCueSourceRange(
  scene: NewsReportScene,
  chunk: { start: number; end: number }
): Pick<SubtitleCue, "sourceStart" | "sourceEnd"> | Record<string, never> {
  if (
    reportSceneAudioMode(scene) !== "original" ||
    !Number.isFinite(scene.sourceStart) ||
    !Number.isFinite(scene.sourceEnd) ||
    scene.sourceEnd <= scene.sourceStart
  ) {
    return {}
  }
  const sourceStart = Math.max(
    scene.sourceStart,
    Math.min(
      scene.sourceEnd,
      scene.sourceStart + unscaleQuoteTimelineSeconds(chunk.start)
    )
  )
  const sourceEnd = Math.max(
    sourceStart,
    Math.min(
      scene.sourceEnd,
      scene.sourceStart + unscaleQuoteTimelineSeconds(chunk.end)
    )
  )
  return { sourceStart: round(sourceStart), sourceEnd: round(sourceEnd) }
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
function partitionSpeechTokens(
  tokens: TimedSpeechToken[],
  maxChars: number,
  preferredChars: number
) {
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
      const following = tokens[end + 2]
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
          followingText: following?.text ?? "",
          gap: next ? next.start - token.end : 0,
          duration: token.end - tokens[start]!.start,
          length,
          maxChars,
          preferredChars,
          remainingLength,
          isLast: end === tokens.length - 1,
        }) + continuation.score

      // 자막 수를 필요 이상 늘리지 않되, 날짜·문장 끝은 독립 의미 단위로 둔다.
      score -= 8
      if (token.preferredBreakAfter) score += 82
      if (hardBoundary) score += 32
      if (/[,;:，；：–—]$/u.test(text)) score += 70
      if (/^(?:오로지|바로|딱|절대|결코)$/u.test(cleanPhrase(token.text))) {
        score -= 100
      }
      if (
        next &&
        splitsFixedExpression(token.text, next.text) &&
        !canSplitNestedObjectBeforePurposePhrase(
          text,
          next.text,
          following?.text ?? ""
        )
      ) {
        score -= 180
      }

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
    (endsWithCoreArgumentParticle(current) &&
      startsWithDependentPredicate(next)) ||
    (/(?:기|함)$/u.test(current) &&
      /^(?:위한|위해|위해서|위하여)(?:\s|$)/u.test(next)) ||
    (/(?:위한|대한|따른)$/u.test(current) && /^[가-힣A-Za-z0-9]/u.test(next)) ||
    splitsNominalCompound(current, next) ||
    (/(?:있어야|해야|되어야|돼야)$/u.test(current) &&
      /^(?:할|될|하는|되는)(?:\s|$)/u.test(next)) ||
    (/(?:오로지|바로|딱|절대|결코)$/u.test(current) &&
      /^[가-힣0-9]/u.test(next))
  )
}

function splitsNominalCompound(left: string, right: string) {
  const current = cleanPhrase(left)
  const next = cleanPhrase(right)
  // `밝히기 위해 / 조사위원회가`처럼 목적구 끝은 뒤 주어부와
  // 붙은 명사구가 아니라 자연스러운 호흡 경계다.
  if (/^(?:위해|위해서|위하여)$/u.test(current)) return false
  // `사고 원인`, `보고서 내용`처럼 명사가 -고/-서로 끝나는 경우를
  // 연결 어미로 오인하지 않고 뒤 명사구와 함께 보존한다.
  if (
    /(?:사고|원고|피고|선고|광고|경고|해고|최고|재고|참고|보고서|문서|순서|질서|부서)$/u.test(
      current
    ) &&
    /^[가-힣A-Za-z0-9]+(?:은|는|이|가|을|를|의|에|에서|로|으로|와|과|도|만)[,.;:!?。！？]?$/u.test(
      next
    )
  ) {
    return true
  }
  if (
    endsWithSpokenClauseBreak(current) ||
    looksLikeSpokenPredicateEnd(current) ||
    /^(?:어떠한|어떤|무슨|이런|그런|저런)$/u.test(current)
  ) {
    return false
  }
  return (
    /^[가-힣A-Za-z0-9]+$/u.test(current) &&
    /^[가-힣A-Za-z0-9]+(?:은|는|이|가|을|를|의|에|에서|로|으로|와|과|도|만)[,.;:!?。！？]?$/u.test(
      next
    )
  )
}

function spokenCaptionBoundaryScore(input: {
  text: string
  nextText: string
  followingText: string
  gap: number
  duration: number
  length: number
  maxChars: number
  preferredChars: number
  remainingLength: number
  isLast: boolean
}) {
  const minimum = input.preferredChars * 0.42
  const preferred = input.preferredChars * 0.78
  // 글자 수는 상한·하한만 강하게, 중간 길이는 의미 경계보다 약하게 본다.
  let score = -Math.abs(input.length - preferred) * 0.4
  if (input.length < minimum) score -= (minimum - input.length) * 3.5
  if (input.length > input.preferredChars) {
    score -= (input.length - input.preferredChars) * 6
  }
  if (input.isLast) score += 100
  if (/[.!?。！？]["'”’)]*$/.test(input.text)) score += 90
  else if (/[,;:，；：–—]$/.test(input.text)) score += 78
  if (endsWithSpokenClauseBreak(input.text)) {
    // 같은 칸에 나머지 절이 들어가면 -고/-서 뒤에서 미리 자르지 않는다.
    const restFits =
      input.remainingLength > 0 &&
      input.length + input.remainingLength <= input.maxChars * 1.02
    score += restFits ? 6 : 62
  }
  if (endsWithPurposePhrase(input.text)) score += 58
  if (input.gap >= 0.38) score += 42
  else if (input.gap >= 0.22) score += 24
  if (startsWithClauseConnector(input.nextText)) score += 48
  if (isBareClauseConnector(input.text)) score -= 180
  if (looksLikeSpokenPredicateEnd(input.text)) score += 36
  // 주제·주어부는 짧은 호흡이 될 수 있지만, 목적어와 뒤 서술어는 붙인다.
  if (/(?:은|는|이|가)[,.;:!?。！？]?$/u.test(input.text)) {
    score += startsWithDependentPredicate(input.nextText) ? -18 : 20
  }
  if (/(?:을|를)[,.;:!?。！？]?$/u.test(input.text)) {
    if (
      startsWithClauseConnector(input.nextText) ||
      input.gap >= 0.28 ||
      startsWithNewSpokenClause(input.nextText)
    ) {
      score += 18
    } else {
      score -= 36
    }
  }
  if (input.duration >= 3.8) score += 8
  if (startsWithBoundParticle(input.nextText)) score -= 140
  if (
    endsWithCoreArgumentParticle(input.text) &&
    startsWithDependentPredicate(input.nextText) &&
    !canSplitNestedObjectBeforePurposePhrase(
      input.text,
      input.nextText,
      input.followingText
    )
  ) {
    score -= 160
  }
  if (
    startsWithClauseConnector(input.text) &&
    endsWithCaseParticle(input.text)
  ) {
    score -= 100
  }
  if (
    endsWithDanglingModifier(input.text) &&
    !isStandaloneDirectionalPhrase(input.text, input.nextText)
  ) {
    score -= 55
  }
  if (endsWithAdverbBeforeArgument(input.text, input.nextText)) score -= 100
  if (splitsNumberAndUnit(input.text, input.nextText)) score -= 140
  // 문장 끝에 0.2~0.4초짜리 한 어절 자막이 혼자 남지 않게 한다.
  // 앞 자막을 조금 일찍 끝내면 마지막 문구를 자연스럽게 묶을 수 있다.
  if (input.remainingLength > 0 && input.remainingLength < minimum * 0.9) {
    score -= 50 + (minimum * 0.9 - input.remainingLength) * 5
  }
  return score
}

/**
 * `감옥에 있어야 할 이재명을 / 탈옥시키기 위한 법`처럼
 * 앞의 관형절+목적어가 이미 완결된 경우에만 목적구 앞 호흡을 허용한다.
 * 일반적인 `죄를 없애기 위한`은 계속 한 덩어리로 보존한다.
 */
function canSplitNestedObjectBeforePurposePhrase(
  left: string,
  right: string,
  following: string
) {
  return (
    /(?:있어야|해야|되어야|돼야)\s+(?:할|될|하는|되는)\s+\S+(?:을|를)$/u.test(
      cleanPhrase(left)
    ) &&
    /^[가-힣A-Za-z0-9]+기$/u.test(cleanPhrase(right)) &&
    /^(?:위한|위해|위해서|위하여)$/u.test(cleanPhrase(following))
  )
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

function endsWithCoreArgumentParticle(value: string) {
  return /(?:은|는|이|가|을|를)$/u.test(cleanPhrase(value))
}

function startsWithDependentPredicate(value: string) {
  return /^(?:아니라|맞서서?|향해|통해|대해|관해|하면서|있어야|해야|되어야|돼야|할|될|위한|대한|따른|[가-힣]+기|[가-힣]+(?:나|냐|니|는가|을까|했나|했냐|했니|하는지|했는지|고|고자|하며|하면서|해서|하여|려고|려는|려던|는|던|도록|다가|지만|는데))(?:\s|$)/u.test(
    cleanPhrase(value)
  )
}

function endsWithPurposePhrase(value: string) {
  return /(?:위해|위해서|위하여)$/u.test(cleanPhrase(value))
}

function isStandaloneDirectionalPhrase(left: string, right: string) {
  return (
    /(?:로|으로)$/u.test(cleanPhrase(left)) &&
    /^[가-힣]+기(?:\s|$)/u.test(cleanPhrase(right))
  )
}

function startsWithNewSpokenClause(value: string) {
  return (
    startsWithClauseConnector(value) ||
    /^(?:또|또한|아울러|게다가|반면|한편|결국|따라서|내년|올해|작년|오늘|내일|지금|앞으로|이후|최근)(?:부터|에는|에|은|는)?(?:\s|$)/u.test(
      cleanPhrase(value)
    )
  )
}

function endsWithSpokenClauseBreak(value: string) {
  const text = cleanPhrase(value)
  if (
    /(?:고자|면서|면서도|니까|는데|지만|라고|하며|하고|해서|하여|돼서|되어|되고|으며|거나)[,.;:!?。！？]?$/u.test(
      text
    )
  ) {
    return true
  }
  // -고/-서/-며 연결은 살리되, 에서·으로 같은 조사 끝은 제외한다.
  if (/(?:에서|으로|에게|께|부터|까지|보다)$/u.test(text)) return false
  return /(?:고|서|며)[,.;:!?。！？]?$/u.test(text)
}

function looksLikeSpokenPredicateEnd(value: string) {
  return /(?:했어|됐어|있어|없어|이야|거야|한다|했다|된다|됐다|있다|없다|입니다|습니다|까요|일까|아닐까|거든|잖아|는데|지만|고자|하며|하면서)[,.;:!?。！？]?$/u.test(
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
    /[\d,.%](?:만|억|조|천|백)?$/u.test(cleanPhrase(left)) &&
    /^(?:원|명|개|건|번|배|조|억|만|천|백|년|월|일|시간|분|초|%)(?:씩|짜리|어치|은|는|이|가|을|를|도|만)?(?:\s|$)/u.test(
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

function spokenUnitCount(value: string) {
  return Math.max(1, cleanPhrase(value).split(/\s+/).filter(Boolean).length)
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
