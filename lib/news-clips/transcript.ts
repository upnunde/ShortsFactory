import type { TranscriptSegment, TranscriptWord } from "./types"

export function updateTranscriptSegmentText(
  segment: TranscriptSegment,
  value: string
): TranscriptSegment {
  const text = value.replace(/\s+/g, " ").trim()
  if (!text || text === segment.text) return segment

  const parts = text.split(/\s+/).filter(Boolean)
  const originalWords = cloneWords(segment.originalWords ?? segment.words)
  const alignmentWords = cloneWords(segment.words)
  const words = alignEditedTokensToWords(
    parts,
    alignmentWords,
    segment.start,
    segment.end,
    segment.speaker
  )

  return {
    ...segment,
    text,
    words,
    originalText: segment.originalText ?? segment.text,
    originalWords,
  }
}

/**
 * 잠시 배포됐던 버전이 모든 Whisper segment를 사용자 확정 경계처럼 저장했다.
 * 출처가 없는 그 경계만 제거하고, 실제 저장·합치기·나누기 경계는 유지한다.
 */
export function clearLegacyAutomaticCaptionBoundaries(
  segments: TranscriptSegment[],
  range: { start: number; end: number }
) {
  let changed = false
  const next = segments.map((segment) => {
    const speech = transcriptSegmentSpeechBounds(segment)
    const belongsToRange =
      speech.end > range.start + 0.01 && speech.start < range.end - 0.01
    if (
      !belongsToRange ||
      segment.captionBoundaryAfter !== true ||
      segment.captionBoundarySource !== undefined
    ) {
      return segment
    }
    changed = true
    return {
      ...segment,
      captionBoundaryAfter: undefined,
      captionBoundarySource: undefined,
    }
  })
  return changed ? next : segments
}

/** 검수 화면에서 자동 생성하거나 사용자가 확정한 구간은 다시 전사하지 않는다. */
export function transcriptRangeIsReviewed(
  segments: TranscriptSegment[],
  range: { start: number; end: number }
) {
  const reviewed = segments.filter((segment) => {
    const speech = transcriptSegmentSpeechBounds(segment)
    return speech.end > range.start && speech.start < range.end
  })
  return (
    reviewed.length > 0 &&
    reviewed.every((segment) => segment.captionBoundarySource !== undefined)
  )
}

/** 표시를 연장한 segment end가 아닌 실제 단어 발화 범위를 반환한다. */
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

/**
 * 인접한 두 원문 구간을 하나로 합친다. 두 번째 구간의 끝 시간까지 유지하고,
 * 경계에 같은 문구가 겹치면 실제 발화에 가까운 오른쪽 단어 시간을 사용한다.
 */
export function mergeTranscriptSegmentWithNext(
  segments: TranscriptSegment[],
  segmentId: string,
  nextSegmentId?: string
): TranscriptSegment[] {
  const index = segments.findIndex((segment) => segment.id === segmentId)
  if (index < 0 || index >= segments.length - 1) return segments

  const left = segments[index]!
  const right = segments[index + 1]!
  if (nextSegmentId && right.id !== nextSegmentId) return segments

  const words = mergeAdjacentWordsPreferRight(left.words, right.words)
  const originalWords = mergeAdjacentWordsPreferRight(
    left.originalWords ?? left.words,
    right.originalWords ?? right.words
  )
  const merged: TranscriptSegment = {
    ...left,
    text: mergeAdjacentText(left.text, right.text),
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
    words,
    originalText: mergeAdjacentText(
      left.originalText ?? left.text,
      right.originalText ?? right.text
    ),
    originalWords,
    // 두 구간 사이 경계만 제거하고, 오른쪽 구간 뒤 경계는 그대로 남긴다.
    captionBoundaryAfter: true,
    captionBoundarySource: "manual",
  }

  return [...segments.slice(0, index), merged, ...segments.slice(index + 2)]
}

/**
 * 한 원문 구간을 단어 경계에서 둘로 나눈다. 표시 문구만 자르는 것이 아니라
 * 각 단어의 실제 시간을 기준으로 두 구간의 시작·종료 시간도 함께 분리한다.
 */
export function splitTranscriptSegmentAtWord(
  segments: TranscriptSegment[],
  segmentId: string,
  wordIndex: number
): TranscriptSegment[] {
  const index = segments.findIndex((segment) => segment.id === segmentId)
  if (index < 0) return segments

  const segment = segments[index]!
  const tokens = segment.text.split(/\s+/).filter(Boolean)
  const splitIndex = Math.trunc(wordIndex)
  if (
    splitIndex <= 0 ||
    splitIndex >= tokens.length ||
    splitIndex >= segment.words.length
  ) {
    return segments
  }

  const leftWords = cloneWords(segment.words.slice(0, splitIndex))
  const rightWords = cloneWords(segment.words.slice(splitIndex))
  const leftLast = leftWords.at(-1)
  const rightFirst = rightWords[0]
  if (!leftLast || !rightFirst) return segments

  const boundary = Math.max(
    segment.start + 0.04,
    Math.min(
      segment.end - 0.04,
      (Math.min(leftLast.end, rightFirst.start) + rightFirst.start) / 2
    )
  )
  const hasOriginal = Boolean(segment.originalText || segment.originalWords)
  const originalWords = cloneWords(segment.originalWords ?? segment.words)
  const originalBoundaryIndex = originalWords.findIndex(
    (word) => word.start >= rightFirst.start - 0.001
  )
  const safeOriginalIndex =
    originalBoundaryIndex > 0
      ? originalBoundaryIndex
      : Math.min(splitIndex, originalWords.length - 1)
  const leftOriginalWords = originalWords.slice(0, safeOriginalIndex)
  const rightOriginalWords = originalWords.slice(safeOriginalIndex)
  const left: TranscriptSegment = {
    ...segment,
    text: tokens.slice(0, splitIndex).join(" "),
    end: boundary,
    words: leftWords,
    captionBoundaryAfter: true,
    captionBoundarySource: "manual",
    ...(hasOriginal
      ? {
          originalText: leftOriginalWords.map((word) => word.text).join(" "),
          originalWords: leftOriginalWords,
        }
      : {}),
  }
  const right: TranscriptSegment = {
    ...segment,
    id: uniqueSplitSegmentId(segments, segment.id, rightFirst.start),
    text: tokens.slice(splitIndex).join(" "),
    start: boundary,
    words: rightWords,
    captionBoundaryAfter: segment.captionBoundaryAfter ?? true,
    captionBoundarySource: "manual",
    ...(hasOriginal
      ? {
          originalText: rightOriginalWords.map((word) => word.text).join(" "),
          originalWords: rightOriginalWords,
        }
      : {}),
  }

  return [
    ...segments.slice(0, index),
    left,
    right,
    ...segments.slice(index + 1),
  ]
}

export function serializeTranscript(segments: TranscriptSegment[]) {
  return JSON.stringify({
    format: "shortsfactory-word-timestamps-v1",
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      ...(segment.originalText ? { original_text: segment.originalText } : {}),
      ...(segment.captionBoundaryAfter ? { caption_boundary_after: true } : {}),
      ...(segment.captionBoundarySource
        ? { caption_boundary_source: segment.captionBoundarySource }
        : {}),
      words: segment.words.map((word) => ({
        word: word.text,
        start: word.start,
        end: word.end,
        ...(word.confidence === undefined
          ? {}
          : { probability: word.confidence }),
      })),
      ...(segment.originalWords
        ? {
            original_words: segment.originalWords.map((word) => ({
              word: word.text,
              start: word.start,
              end: word.end,
              ...(word.confidence === undefined
                ? {}
                : { probability: word.confidence }),
            })),
          }
        : {}),
    })),
  })
}

export function parseTranscript(input: string): TranscriptSegment[] {
  const text = input.replace(/^\uFEFF/, "").trim()
  if (!text) return []
  const json = parseTimestampJson(text)
  if (json.length) return normalizeTranscriptCalendarDates(json)
  const blocks = text.split(/\r?\n\s*\r?\n/)
  const timed = stabilizeTimedSegments(
    blocks.flatMap((block, index) => parseTimedBlock(block, index))
  )
  if (timed.length > 0) return normalizeTranscriptCalendarDates(timed)
  return normalizeTranscriptCalendarDates(plainSegments(text))
}

/**
 * 전체 전사에서 실제로 사용할 구간만 로컬 음성 재전사 결과로 교체한다.
 * 구간 밖의 원문은 유지하고, 경계 안에는 재전사의 단어 타임스탬프만 남긴다.
 */
export function replaceTranscriptRange(
  transcript: TranscriptSegment[],
  replacement: TranscriptSegment[],
  range: { start: number; end: number }
) {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  const inside = replacement
    .filter((segment) => segment.end > start && segment.start < end)
    .map((segment) => {
      const words = segment.words.filter(
        (word) => word.end > start && word.start < end
      )
      return {
        ...segment,
        text:
          words.length === segment.words.length
            ? segment.text
            : words.map((word) => word.text).join(" "),
        start: Math.max(start, segment.start),
        end: Math.min(end, segment.end),
        words,
      }
    })
    .filter(
      (segment) => segment.end > segment.start && segment.words.length > 0
    )
  if (!inside.length) return transcript

  return [
    ...transcript.filter((segment) => segment.end <= start),
    ...inside,
    ...transcript.filter((segment) => segment.start >= end),
  ].sort((left, right) => left.start - right.start || left.end - right.end)
}

/**
 * Whisper가 한두 표현을 실제 음성과 무관하게 길게 반복한 결과를 찾는다.
 * 단순히 같은 단어가 몇 번 나오는 연설은 허용하고, 어휘가 거의 없으면서
 * 같은 2어절 조합이 전체 구간의 큰 비중을 차지할 때만 환각으로 판단한다.
 */
export function transcriptRangeLooksHallucinated(
  transcript: TranscriptSegment[],
  range: { start: number; end: number }
) {
  const tokens = transcript
    .filter((segment) => segment.end > range.start && segment.start < range.end)
    .flatMap((segment) => segment.words)
    .filter((word) => word.end > range.start && word.start < range.end)
    .map((word) =>
      word.text
        .normalize("NFKC")
        .replace(/[\s\p{P}\p{S}]+/gu, "")
        .toLowerCase()
    )
    .filter(Boolean)
  if (tokens.length < 16) return false

  const uniqueRatio = new Set(tokens).size / tokens.length
  const pairs = new Map<string, number>()
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = `${tokens[index]}\u0000${tokens[index + 1]}`
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
  }
  const mostRepeatedPair = Math.max(0, ...pairs.values())
  const repeatedPairCoverage = (mostRepeatedPair * 2) / tokens.length
  return uniqueRatio < 0.35 && repeatedPairCoverage >= 0.28
}

/** 음성인식에서 반복되는 소수의 한국어 법률용어 오인식만 보수적으로 교정한다. */
export function normalizeKoreanRecognitionText(value: string) {
  return value
    .replace(
      /(?:동서\s*취소|공소\s*치소|공소취소)\s*(?:특검법|특권법)/gu,
      "공소 취소 특권법"
    )
    .replace(/타록시키기|타옥시키기/gu, "탈옥시키기")
    .replace(/타록법|타옥법/gu, "탈옥법")
}

/**
 * 예전 YouTube SRT를 저장한 프로젝트는 롤링 자막 구간이 서로 겹쳐 있다.
 * 사용자가 직접 교정한 원문은 건드리지 않고, 미편집 레거시 전사만 현재
 * 파서로 다시 읽어 순차 단어 타임라인으로 복구한다.
 */
export function repairLegacyOverlappingTranscript(
  current: TranscriptSegment[],
  timedText: string
) {
  const manuallyEdited = current.some(
    (segment) => segment.originalText || segment.originalWords?.length
  )
  const overlaps = current.some(
    (segment, index) =>
      index > 0 && segment.start < current[index - 1]!.end - 0.04
  )
  if (manuallyEdited || !overlaps) return current
  const repaired = parseTranscript(timedText)
  return repaired.length ? repaired : current
}

/**
 * Whisper가 `2026년`을 `26년`으로 축약 전사하는 경우를 복원한다.
 * 바로 뒤에 월·일이 모두 이어지는 명확한 달력 날짜만 대상으로 하므로
 * `26년 동안` 같은 기간 표현은 바꾸지 않는다. 단어 시간은 그대로 보존한다.
 */
export function normalizeTranscriptCalendarDates(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  const normalized = segments.map((segment) => ({
    ...segment,
    words: cloneWords(segment.words),
  }))
  const words = normalized.flatMap((segment, segmentIndex) =>
    segment.words.map((word) => ({ segmentIndex, word }))
  )

  for (let index = 0; index < words.length - 2; index += 1) {
    const year = words[index]!
    const month = words[index + 1]!
    const day = words[index + 2]!
    const match = comparableCalendarToken(year.word.text).match(/^(\d{2})년$/u)
    if (
      !match ||
      !/^\d{1,2}월$/u.test(comparableCalendarToken(month.word.text)) ||
      !/^\d{1,2}일$/u.test(comparableCalendarToken(day.word.text))
    ) {
      continue
    }

    const expanded = `20${match[1]}년`
    year.word.text = replaceCalendarToken(year.word.text, expanded)
    const segment = normalized[year.segmentIndex]!
    segment.text = replaceFirstCalendarToken(segment.text, expanded)
  }
  return normalized
}

function comparableCalendarToken(value: string) {
  return value.normalize("NFKC").replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/gu, "")
}

function replaceCalendarToken(value: string, replacement: string) {
  return value.replace(/\d{2}년/u, replacement)
}

function replaceFirstCalendarToken(value: string, replacement: string) {
  return value.replace(/(?:^|\s)\d{2}년(?=\s|$|[,.;:!?])/u, (match) =>
    match.replace(/\d{2}년/u, replacement)
  )
}

function parseTimestampJson(input: string): TranscriptSegment[] {
  if (!input.startsWith("{") && !input.startsWith("[")) return []
  try {
    const parsed = JSON.parse(input) as {
      segments?: Array<{
        start?: unknown
        end?: unknown
        text?: unknown
        original_text?: unknown
        caption_boundary_after?: unknown
        caption_boundary_source?: unknown
        words?: Array<{
          word?: unknown
          text?: unknown
          start?: unknown
          end?: unknown
          probability?: unknown
          confidence?: unknown
        }>
        original_words?: Array<{
          word?: unknown
          text?: unknown
          start?: unknown
          end?: unknown
          probability?: unknown
          confidence?: unknown
        }>
      }>
    }
    if (!Array.isArray(parsed.segments)) return []
    return parsed.segments.flatMap((segment, index) => {
      const start = finite(segment.start)
      const end = finite(segment.end)
      const text = typeof segment.text === "string" ? segment.text.trim() : ""
      if (!text || end <= start) return []
      const words = parseJsonWords(segment.words)
      const originalWords = parseJsonWords(segment.original_words)
      const originalText =
        typeof segment.original_text === "string"
          ? segment.original_text.trim()
          : ""
      return [
        {
          id: "segment-" + (index + 1),
          text,
          start,
          end,
          speaker: "speaker-1",
          words: words.length
            ? words
            : segmentOf(text, start, end, index).words,
          ...(originalText ? { originalText } : {}),
          ...(originalWords.length ? { originalWords } : {}),
          ...(segment.caption_boundary_after === true
            ? { captionBoundaryAfter: true }
            : {}),
          ...(segment.caption_boundary_source === "manual" ||
          segment.caption_boundary_source === "automatic"
            ? { captionBoundarySource: segment.caption_boundary_source }
            : {}),
        },
      ]
    })
  } catch {
    return []
  }
}

function parseJsonWords(
  value:
    | Array<{
        word?: unknown
        text?: unknown
        start?: unknown
        end?: unknown
        probability?: unknown
        confidence?: unknown
      }>
    | undefined
) {
  if (!Array.isArray(value)) return []
  return value.flatMap((word) => {
    const wordStart = finite(word.start)
    const wordEnd = finite(word.end)
    const wordText =
      typeof word.word === "string"
        ? word.word.trim()
        : typeof word.text === "string"
          ? word.text.trim()
          : ""
    if (!wordText || wordEnd <= wordStart) return []
    const confidence = finite(word.probability ?? word.confidence, Number.NaN)
    return [
      {
        text: wordText,
        start: wordStart,
        end: wordEnd,
        speaker: "speaker-1",
        ...(Number.isFinite(confidence) ? { confidence } : {}),
      } satisfies TranscriptWord,
    ]
  })
}

/**
 * 수정 문구를 원본 단어 ID에 맞춘다. 일치하는 앞뒤 단어는 시간을 그대로 쓰고,
 * `이제 명 → 이재명`처럼 개수가 달라진 부분만 그 원본 단어 범위에 배치한다.
 */
function alignEditedTokensToWords(
  tokens: string[],
  original: TranscriptWord[],
  segmentStart: number,
  segmentEnd: number,
  speaker: string
) {
  if (!tokens.length) return []
  if (!original.length) {
    return distributeTokens(tokens, segmentStart, segmentEnd, speaker)
  }
  if (tokens.length === original.length) {
    return tokens.map((text, index) => ({
      ...original[index]!,
      text,
      speaker: original[index]!.speaker ?? speaker,
    }))
  }

  const anchors = longestCommonWordAnchors(original, tokens)
  const result: TranscriptWord[] = []
  let originalCursor = 0
  let tokenCursor = 0
  for (const anchor of [
    ...anchors,
    { original: original.length, edited: tokens.length },
  ]) {
    const sourceSlice = original.slice(originalCursor, anchor.original)
    const editedSlice = tokens.slice(tokenCursor, anchor.edited)
    if (editedSlice.length) {
      const rangeStart =
        sourceSlice[0]?.start ??
        original[originalCursor - 1]?.end ??
        original[anchor.original]?.start ??
        segmentStart
      const rangeEnd =
        sourceSlice.at(-1)?.end ??
        original[anchor.original]?.start ??
        original[originalCursor - 1]?.end ??
        segmentEnd
      result.push(
        ...distributeTokens(
          editedSlice,
          rangeStart,
          Math.max(rangeStart + 0.04, rangeEnd),
          speaker
        )
      )
    }
    if (anchor.original < original.length && anchor.edited < tokens.length) {
      const source = original[anchor.original]!
      result.push({
        ...source,
        text: tokens[anchor.edited]!,
        speaker: source.speaker ?? speaker,
      })
    }
    originalCursor = anchor.original + 1
    tokenCursor = anchor.edited + 1
  }
  return result
}

function longestCommonWordAnchors(
  original: TranscriptWord[],
  edited: string[]
) {
  const left = original.map((word) => comparableWord(word.text))
  const right = edited.map(comparableWord)
  const table = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  )
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        left[i] && left[i] === right[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const anchors: Array<{ original: number; edited: number }> = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] && left[i] === right[j]) {
      anchors.push({ original: i, edited: j })
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i += 1
    } else {
      j += 1
    }
  }
  return anchors
}

function distributeTokens(
  tokens: string[],
  start: number,
  end: number,
  speaker: string
) {
  const duration = Math.max(0.04, end - start)
  const weights = tokens.map((token) => Math.max(1, [...token].length))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let elapsed = 0
  return tokens.map((text, index) => {
    const wordStart = start + (duration * elapsed) / total
    elapsed += weights[index]!
    const wordEnd = start + (duration * elapsed) / total
    return {
      text,
      start: wordStart,
      end: wordEnd,
      speaker,
    } satisfies TranscriptWord
  })
}

function comparableWord(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase()
}

function mergeAdjacentText(left: string, right: string) {
  const leftTokens = left.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  const rightTokens = right
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
  const overlap = overlappingTokenCount(leftTokens, rightTokens)
  return [
    ...leftTokens.slice(0, leftTokens.length - overlap),
    ...rightTokens,
  ].join(" ")
}

function mergeAdjacentWordsPreferRight(
  left: TranscriptWord[],
  right: TranscriptWord[]
) {
  const overlap = overlappingTokenCount(
    left.map((word) => word.text),
    right.map((word) => word.text)
  )
  return [
    ...cloneWords(left.slice(0, left.length - overlap)),
    ...cloneWords(right),
  ].sort(
    (first, second) => first.start - second.start || first.end - second.end
  )
}

function overlappingTokenCount(left: string[], right: string[]) {
  const maximum = Math.min(left.length, right.length)
  for (let size = maximum; size > 0; size -= 1) {
    const matches = left
      .slice(left.length - size)
      .every(
        (token, index) =>
          comparableWord(token) === comparableWord(right[index] ?? "")
      )
    if (matches) return size
  }
  return 0
}

function uniqueSplitSegmentId(
  segments: TranscriptSegment[],
  segmentId: string,
  splitStart: number
) {
  const base = `${segmentId}-split-${Math.round(splitStart * 1000)}`
  const ids = new Set(segments.map((segment) => segment.id))
  if (!ids.has(base)) return base
  let suffix = 2
  while (ids.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function cloneWords(words: TranscriptWord[]) {
  return words.map((word) => ({ ...word }))
}

function stabilizeTimedSegments(segments: TranscriptSegment[]) {
  const sorted = [...segments].sort(
    (left, right) => left.start - right.start || left.end - right.end
  )
  return sorted.map((segment, index) => {
    const next = sorted[index + 1]
    if (!next || segment.end <= next.start) return segment
    const end = Math.max(segment.start + 0.08, next.start)
    return segmentOf(segment.text, segment.start, end, index)
  })
}

function parseTimedBlock(block: string, index: number): TranscriptSegment[] {
  const lines = block.split(/\r?\n/).map((line) => line.trim())
  const timingIndex = lines.findIndex((line) => line.includes("-->"))
  if (timingIndex < 0) return []
  const [startText, endText] = lines[timingIndex].split("-->")
  const start = parseTime(startText)
  const end = parseTime(endText?.trim().split(/\s+/)[0] ?? "")
  const content = lines
    .slice(timingIndex + 1)
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .trim()
  if (!content || end <= start) return []
  return [segmentOf(content, start, end, index)]
}

function plainSegments(text: string) {
  const sentences = text
    .replace(/\r?\n+/g, " ")
    .split(/(?<=[.!?다요죠])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
  let cursor = 0
  return sentences.map((sentence, index) => {
    const duration = Math.max(1.2, sentence.length / 6.2)
    const segment = segmentOf(sentence, cursor, cursor + duration, index)
    cursor += duration + 0.18
    return segment
  })
}

function segmentOf(
  text: string,
  start: number,
  end: number,
  index: number
): TranscriptSegment {
  const parts = text.split(/\s+/).filter(Boolean)
  const duration = end - start
  const words: TranscriptWord[] = parts.map((word, wordIndex) => ({
    text: word,
    start: start + (duration * wordIndex) / parts.length,
    end: start + (duration * (wordIndex + 1)) / parts.length,
    speaker: "speaker-1",
  }))
  return {
    id: `segment-${index + 1}`,
    text,
    start,
    end,
    speaker: "speaker-1",
    words,
  }
}

function parseTime(value: string) {
  const match = value.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/)
  if (!match) return 0
  const [, hours = "0", minutes, seconds, millis] = match
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millis.padEnd(3, "0")) / 1000
  )
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}
