import {
  quoteOutputDurationSeconds,
  scaleQuoteTimelineSeconds,
} from "./playback.ts"
import { snapSourceRangeToSpeech } from "./speech-bounds.ts"
import type {
  NewsReportScene,
  SubtitleCue,
  TranscriptSegment,
} from "./types.ts"

const EMPHASIS =
  /(?:\d[\d,.]*\s*(?:%|원|명|건|배|조|억|만)?|정부|국회|대통령|피해|세금|일자리|안보|외교|사법)/g

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
        // 문장 미완 겹침은 텍스트만 이어 붙이고, 단어 섞임을 막기 위해 words를 비운다.
        previous.text = `${previous.text} ${text}`.replace(/\s+/g, " ").trim()
        previous.end = Math.max(previous.end, end)
        previous.words = []
        continue
      }
      const clampedStart = previous.end
      if (end - clampedStart < 0.12) {
        previous.text = `${previous.text} ${text}`.replace(/\s+/g, " ").trim()
        previous.end = Math.max(previous.end, end)
        previous.words = []
        continue
      }
      keptSegments.push({ ...segment, start: clampedStart, end, text })
      continue
    }
    keptSegments.push({ ...segment, start, end, text })
  }

  // 2) 고른 문장 안에서만 단어 타임스탬프를 펼친다(문장 간 단어 섞임 방지).
  const resolved: Array<{ text: string; start: number; end: number }> = []
  for (const segment of keptSegments) {
    const words = (segment.words ?? [])
      .filter(
        (word) =>
          word.text.trim() &&
          Number.isFinite(word.start) &&
          Number.isFinite(word.end) &&
          word.end >= word.start &&
          word.end > segment.start - 0.05 &&
          word.start < segment.end + 0.05
      )
      .sort((left, right) => left.start - right.start)
    if (words.length) {
      for (const word of words) {
        const text = word.text.replace(/\s+/g, " ").trim()
        if (!text) continue
        const start = Math.max(segment.start, word.start)
        const end = Math.max(start + 0.06, Math.min(segment.end, word.end))
        const previous = resolved.at(-1)
        if (previous && start < previous.end - 0.02) {
          previous.end = Math.max(previous.end, end)
          if (!previous.text.includes(text)) {
            previous.text = `${previous.text} ${text}`
              .replace(/\s+/g, " ")
              .trim()
          }
          continue
        }
        resolved.push({ text, start, end })
      }
      continue
    }
    resolved.push({
      text: segment.text,
      start: segment.start,
      end: segment.end,
    })
  }

  return resolved.map((segment) => ({
    text: segment.text,
    start: round(Math.max(0, segment.start - scene.sourceStart)),
    end: round(
      Math.max(
        segment.start - scene.sourceStart + 0.12,
        segment.end - scene.sourceStart
      )
    ),
  }))
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
  transcript: TranscriptSegment[] = []
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
      const quoteCues = subtitleCuesFromSpeechAlignment({
        ...scene,
        start: sceneStart,
        end: sceneStart + duration,
        alignment,
      })
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
    options.transcript ?? []
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
    alignment?: Array<{ text: string; start: number; end: number }>
  },
  options: { maxCharacters?: number } = {}
) {
  const segments = timedSubtitleTokens(scene.alignment ?? [])
    .filter(
      (segment) =>
        segment.text.trim() &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end >= segment.start
    )
    .sort((left, right) => left.start - right.start)
  if (!segments.length) return [] as SubtitleCue[]

  const sceneDuration = Math.max(0.2, scene.end - scene.start)
  const maxChars = Math.max(10, Math.floor(options.maxCharacters ?? 30))
  const groups: Array<{ text: string; start: number; end: number }> = []
  let cursor = 0
  while (cursor < segments.length) {
    let text = ""
    let bestEnd = cursor
    let bestText = cleanPhrase(segments[cursor]!.text)
    let bestScore = Number.NEGATIVE_INFINITY

    for (let index = cursor; index < segments.length; index += 1) {
      const segmentText = cleanPhrase(segments[index]!.text)
      const joined = joinSpokenTokens(text, segmentText)
      const length = comparableLength(joined)
      if (index > cursor && length > maxChars) break

      text = joined
      const next = segments[index + 1]
      const score = spokenCaptionBoundaryScore({
        text,
        nextText: next?.text ?? "",
        gap: next ? next.start - segments[index]!.end : 0,
        duration: segments[index]!.end - segments[cursor]!.start,
        length,
        maxChars,
        isLast: index === segments.length - 1,
      })
      if (score > bestScore) {
        bestScore = score
        bestEnd = index
        bestText = text
      }
      if (/[.!?。！？]["'”’)]*$/.test(text)) break
      const gapAfter = next ? next.start - segments[index]!.end : 0
      const strongPhraseBoundary =
        comparableLength(text) >= maxChars * 0.32 &&
        (/[,;:，；：–—]$/.test(text) ||
          gapAfter >= 0.38 ||
          startsWithClauseConnector(next?.text ?? ""))
      if (strongPhraseBoundary) {
        bestEnd = index
        bestText = text
        break
      }
    }

    const first = segments[cursor]!
    const last = segments[bestEnd]!
    groups.push({
      text: bestText,
      start: Math.max(0, first.start),
      end: Math.max(
        Math.max(0, first.start) + 0.12,
        Math.min(sceneDuration, last.end)
      ),
    })
    cursor = bestEnd + 1
  }

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

function timedSubtitleTokens(
  segments: Array<{ text: string; start: number; end: number }>
) {
  return segments.flatMap((segment) => {
    const text = cleanPhrase(segment.text)
    if (!text) return []
    const tokens = text.split(/\s+/).filter(Boolean)
    if (tokens.length <= 1) return [{ ...segment, text }]
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
      return { text: token, start, end }
    })
  })
}

function spokenCaptionBoundaryScore(input: {
  text: string
  nextText: string
  gap: number
  duration: number
  length: number
  maxChars: number
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
  if (looksLikeSpokenPredicateEnd(input.text)) score += 14
  if (/(?:은|는|이|가|을|를)[,.;:!?。！？]?$/u.test(input.text)) score += 12
  if (
    /(?:하는|되는|있는|없는|했던|라는|주는|받는|가는|오는|된|한)[,.;:!?。！？]?$/u.test(
      input.text
    )
  ) {
    score += 10
  }
  if (input.duration >= 3.8) score += 8
  if (startsWithBoundParticle(input.nextText)) score -= 120
  if (endsWithDanglingModifier(input.text)) score -= 45
  if (splitsNumberAndUnit(input.text, input.nextText)) score -= 140
  return score
}

function joinSpokenTokens(left: string, right: string) {
  if (!left) return right
  if (!right) return left
  return startsWithBoundParticle(right) || /^[,.;:!?%…)}\]”’]/.test(right)
    ? `${left}${right}`
    : `${left} ${right}`
}

function startsWithBoundParticle(value: string) {
  return /^(?:은|는|이|가|을|를|의|에|에서|에게|께|로|으로|와|과|도|만|부터|까지|보다|처럼|마다|조차|마저|라도|이나|나)(?:\s|$|[,.;:!?])/u.test(
    cleanPhrase(value)
  )
}

function startsWithClauseConnector(value: string) {
  return /^(?:그런데|하지만|그러나|그래서|그리고|다만|반면|결국|따라서|한편|즉|또)\b/u.test(
    cleanPhrase(value)
  )
}

function looksLikeSpokenPredicateEnd(value: string) {
  return /(?:했어|됐어|있어|없어|이야|거야|한다|했다|된다|됐다|있다|없다|입니다|습니다|까요|일까|아닐까|거든|잖아|는데|지만)[,.;:!?。！？]?$/u.test(
    cleanPhrase(value)
  )
}

function endsWithDanglingModifier(value: string) {
  return /(?:의|에|에서|에게|께|로|으로|와|과|위한|대한|따른)$/u.test(
    cleanPhrase(value)
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
