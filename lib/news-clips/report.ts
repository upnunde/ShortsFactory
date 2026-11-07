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
  const tail = splitReportSentences(script).slice(-2).join(" ")
  return /댓글/.test(tail) && /(남겨|달아|적어|알려|써|의견)/.test(tail)
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
  const sentences = splitReportSentences(normalized)
  if (!sentences.length) return { body: normalized, cta: "" }

  let take = 1
  if (sentences.length >= 2) {
    const lastTwo = sentences.slice(-2).join(" ")
    if (/어떻게 생각/.test(lastTwo) && /댓글/.test(lastTwo)) take = 2
    else if (/댓글/.test(sentences.at(-1) ?? "")) take = 1
  }
  const ctaSentences = sentences.slice(-take)
  const bodySentences = sentences.slice(0, -take)
  return {
    body: bodySentences.join(" ").trim(),
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
  if (!text) return scenes
  const bodyScenes = scenes.filter((scene) => !isEndCtaScene(scene))
  if (!bodyScenes.length) return scenes
  const anchor =
    [...bodyScenes].reverse().find((scene) => scene.visual === "source") ??
    bodyScenes.at(-1)!
  const start = Math.max(0, anchor.sourceEnd - 2.5)
  const end = Math.max(start + 0.8, anchor.sourceEnd)
  return [
    ...bodyScenes,
    {
      id: "end-cta",
      narration: text,
      visual: "source",
      sourceId: anchor.sourceId || primarySourceId || undefined,
      sourceStart: round(start),
      sourceEnd: round(end),
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
          ? Math.max(0.5, scene.sourceEnd - scene.sourceStart)
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
  const words = transcript
    .flatMap((segment) => segment.words)
    .filter(
      (word) =>
        word.text.trim() &&
        word.end > scene.sourceStart &&
        word.start < scene.sourceEnd
    )
    .map((word) => ({
      text: word.text,
      start: round(Math.max(0, word.start - scene.sourceStart)),
      end: round(
        Math.max(0, Math.min(scene.sourceEnd, word.end) - scene.sourceStart)
      ),
    }))
  if (words.length) return words

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
  return (contained.length ? contained : overlapping).map((segment) => ({
    text: segment.text,
    start: round(Math.max(0, segment.start - scene.sourceStart)),
    end: round(
      Math.max(0, Math.min(scene.sourceEnd, segment.end) - scene.sourceStart)
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
  captionPhrases?: string[]
) {
  const sceneWeights = scenes.map((scene, index) =>
    Math.max(
      0.5,
      durations?.[index] ??
        (scene.visual === "quote"
          ? Math.max(0.5, scene.sourceEnd - scene.sourceStart)
          : estimateReportDuration(scene.narration))
    )
  )
  const phrases = captionPhrases?.map(cleanPhrase).filter(Boolean) ?? []
  const phraseGroups = assignCaptionPhrasesToScenes(scenes, phrases)
  let cursor = 0
  let phraseIndex = 0
  return scenes.flatMap((scene, sceneIndex) => {
    const texts = phraseGroups[sceneIndex] ?? []
    const duration = sceneWeights[sceneIndex]
    const weights = texts.map((text) =>
      Math.max(0.5, estimateReportDuration(text))
    )
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let elapsedWeight = 0
    const sceneStart = cursor
    cursor += duration
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

export function retimeSubtitleCuesToScenes(
  cues: SubtitleCue[],
  plannedScenes: NewsReportScene[],
  timedScenes: Array<
    NewsReportScene & {
      start: number
      end: number
      alignment?: Array<{ text: string; start: number; end: number }>
    }
  >
) {
  if (!timedScenes.length) return []
  // 레거시 end-cta 오버레이(장면 없음)만 제외. 장면 기반 end-cta 자막은 유지.
  const usableCues = cues.filter(
    (cue) => cue.sceneId || !cue.id.startsWith("end-cta")
  )
  const grouped = groupCuesByScene(usableCues, plannedScenes)

  return timedScenes.flatMap((scene, sceneIndex) => {
    if (scene.visual === "quote") {
      const quoteCues = subtitleCuesFromQuoteAlignment(scene)
      if (quoteCues.length) return quoteCues
    }
    const sceneCues =
      grouped[sceneIndex]?.length
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
    const aligned = retimeSceneCuesFromAlignment(sceneCues, scene)
    if (aligned) return aligned
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

function subtitleCuesFromQuoteAlignment(
  scene: NewsReportScene & {
    start: number
    end: number
    alignment?: Array<{ text: string; start: number; end: number }>
  }
) {
  const segments = (scene.alignment ?? [])
    .filter(
      (segment) =>
        segment.text.trim() &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end >= segment.start
    )
    .sort((left, right) => left.start - right.start)
  if (!segments.length) return [] as SubtitleCue[]

  const chunks: Array<{ text: string; start: number; end: number }> = []
  let currentText = ""
  let currentStart = segments[0].start
  let currentEnd = segments[0].end
  for (const segment of segments) {
    const token = segment.text.trim()
    const next = currentText ? `${currentText} ${token}` : token
    if (currentText && comparableLength(next) > 24) {
      chunks.push({
        text: cleanPhrase(currentText),
        start: currentStart,
        end: currentEnd,
      })
      currentText = token
      currentStart = segment.start
      currentEnd = segment.end
    } else {
      currentText = next
      currentEnd = segment.end
    }
  }
  if (currentText.trim()) {
    chunks.push({
      text: cleanPhrase(currentText),
      start: currentStart,
      end: currentEnd,
    })
  }

  return chunks.map((chunk, index) => ({
    id: `quote-caption-${scene.id}-${index + 1}`,
    sceneId: scene.id,
    start: round(scene.start + Math.max(0, chunk.start)),
    end: round(
      Math.max(
        scene.start + chunk.start + 0.2,
        scene.start + Math.min(scene.end - scene.start, chunk.end)
      )
    ),
    text: chunk.text,
    emphasis: [...new Set(chunk.text.match(EMPHASIS) ?? [])],
    emphasisColor: "yellow" as const,
  })) satisfies SubtitleCue[]
}

function retimeSceneCuesFromAlignment(
  cues: SubtitleCue[],
  scene: NewsReportScene & {
    start: number
    end: number
    alignment?: Array<{ text: string; start: number; end: number }>
  }
) {
  const duration = Math.max(0.1, scene.end - scene.start)
  const segments = (scene.alignment ?? [])
    .filter(
      (segment) =>
        segment.text.trim() &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.start >= 0 &&
        segment.end >= segment.start
    )
    .sort((left, right) => left.start - right.start)
  if (!segments.length || segments.length < cues.length) return null
  if (cues.length === 1) {
    return [
      { ...cues[0], sceneId: scene.id, start: scene.start, end: scene.end },
    ]
  }

  const cueWeights = cues.map((cue) => Math.max(1, comparableLength(cue.text)))
  const cueTotal = cueWeights.reduce((sum, weight) => sum + weight, 0)
  const segmentWeights = segments.map((segment) =>
    Math.max(1, comparableLength(segment.text))
  )
  const segmentTotal = segmentWeights.reduce((sum, weight) => sum + weight, 0)
  const boundaries = [0]
  let cueElapsed = 0
  let segmentElapsed = 0
  let segmentIndex = 0

  for (let cueIndex = 0; cueIndex < cues.length - 1; cueIndex += 1) {
    cueElapsed += cueWeights[cueIndex]
    const target = (segmentTotal * cueElapsed) / cueTotal
    const remainingCues = cues.length - cueIndex - 1
    const maximumBoundary = segments.length - remainingCues
    while (
      segmentIndex < maximumBoundary &&
      segmentElapsed + segmentWeights[segmentIndex] < target
    ) {
      segmentElapsed += segmentWeights[segmentIndex]
      segmentIndex += 1
    }
    const boundary = Math.max(
      boundaries.at(-1)! + 1,
      Math.min(maximumBoundary, segmentIndex + 1)
    )
    while (segmentIndex < boundary) {
      segmentElapsed += segmentWeights[segmentIndex]
      segmentIndex += 1
    }
    boundaries.push(boundary)
  }
  boundaries.push(segments.length)

  return cues.map((cue, index) => {
    const nextBoundary = boundaries[index + 1]
    const relativeStart =
      index === 0 ? 0 : Math.max(0, segments[boundaries[index]].start)
    const relativeEnd =
      index === cues.length - 1
        ? duration
        : Math.max(relativeStart + 0.05, segments[nextBoundary].start)
    return {
      ...cue,
      sceneId: scene.id,
      start: round(scene.start + Math.min(duration, relativeStart)),
      end: round(scene.start + Math.min(duration, relativeEnd)),
    }
  })
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
