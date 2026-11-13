import type { NewsTextLayout, SubtitleCue } from "./types.ts"

export function resolveTextBox(
  layout: NewsTextLayout,
  safeMarginPercent: number
) {
  const safe = Math.round(
    (1080 * Math.max(0, Math.min(20, safeMarginPercent))) / 100
  )
  // 텍스트 폭은 설정값을 따르고, 화면(1080)만 넘지 않게 한다.
  const width = Math.max(120, Math.min(layout.width, 1080))
  const x =
    layout.alignment === "left"
      ? Math.max(0, Math.min(safe, 1080 - width))
      : layout.alignment === "right"
        ? Math.max(0, 1080 - Math.min(safe, Math.max(0, 1080 - width)) - width)
        : Math.round((1080 - width) / 2)
  return {
    x,
    width,
    leftPercent: percent((x / 1080) * 100),
    rightPercent: percent(((1080 - x - width) / 1080) * 100),
    widthPercent: percent((width / 1080) * 100),
  }
}

export function fitTitleToTwoLines(title: string, layout: NewsTextLayout) {
  const lineLimit = unitsPerLine(layout)
  return splitIntroTitleLines(title, layout)
    .map((line) => fitSingleLine(line, lineLimit))
    .filter(Boolean)
    .join("\n")
}

export function fitTitleToLineLayouts(
  title: string,
  firstLayout: NewsTextLayout,
  secondLayout: NewsTextLayout
) {
  const [firstLine, secondLine] = splitIntroTitleLines(title, firstLayout)
  return [
    fitSingleLine(firstLine, unitsPerLine(firstLayout)),
    fitSingleLineFromEnd(secondLine, unitsPerLine(secondLayout)),
  ]
    .filter(Boolean)
    .join("\n")
}

export function splitIntroTitleLines(
  title: string,
  layout: NewsTextLayout
): [string, string] {
  const lineLimit = unitsPerLine(layout)
  const explicit = title
    .split(/\r?\n+/)
    .map(normalizeText)
    .filter(Boolean)
  if (explicit.length >= 2) {
    return [explicit[0], explicit.slice(1).join(" ")]
  }

  const normalized = normalizeText(title)
  if (!normalized) return ["", ""]
  const sentences =
    normalized.match(/[^.!?。！？]+[.!?。！？]?/g)?.map(normalizeText) ?? []
  if (sentences.length >= 2) {
    return [sentences[0], sentences.slice(1).join(" ")]
  }

  const clauses = normalized
    .split(
      /\s*(?:[,;:，；：–—]|\.{3}|…+)\s*|\s+(?=(?:하지만|그러나|그리고|반면|결국)\s)/
    )
    .map(normalizeText)
    .filter(Boolean)
  if (clauses.length >= 2) {
    return [clauses[0], clauses.slice(1).join(" ")]
  }

  const lines = splitLongSentence(normalized, lineLimit)
  if (lines.length >= 2) {
    return [lines[0], lines.slice(1).join(" ")]
  }
  const words = normalized.split(" ").filter(Boolean)
  if (words.length >= 2) {
    const middle = Math.ceil(words.length / 2)
    return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")]
  }
  return [normalized, ""]
}

export function titleTextScale(title: string, layout: NewsTextLayout) {
  const scales = splitIntroTitleLines(title, layout)
    .filter(Boolean)
    .map((line) => titleLineTextScale(line, layout))
  return scales.length > 0 ? Math.min(...scales) : 1
}

export function titleLineTextScale(
  line: string,
  layout: NewsTextLayout,
  minimum = 0.65
) {
  const metrics = titleLineRenderMetrics(line, layout, minimum)
  return (metrics.fontSize / layout.fontSize) * metrics.scaleX
}

export function titleLineFontSize(
  line: string,
  layout: NewsTextLayout,
  minimum = 0.35
) {
  return titleLineRenderMetrics(line, layout, minimum).fontSize
}

export function titleLineRenderMetrics(
  line: string,
  layout: NewsTextLayout,
  minimumFontScale = 0.35
) {
  void line
  void minimumFontScale
  // 글자 크기는 설정값 유지. 폭 초과는 UI 검증(titleLineFits)으로 막는다.
  const configuredFontSize = Math.max(1, Math.round(layout.fontSize))
  return { fontSize: configuredFontSize, scaleX: 1 }
}

export function titleLineCharacterLimit(layout: NewsTextLayout) {
  const availableWidth = titleAvailableWidth(layout)
  const advance = Math.max(
    1,
    layout.fontSize * TEXT_GLYPH_WIDTH_RATIO + layout.letterSpacing
  )
  return Math.max(
    4,
    Math.floor((availableWidth + layout.letterSpacing) / advance)
  )
}

export function titleLineFits(line: string, layout: NewsTextLayout) {
  if (!line.trim()) return false
  const characterCount = [...line].length
  const measuredWidth =
    visualUnits(line) * layout.fontSize * TEXT_GLYPH_WIDTH_RATIO +
    Math.max(0, characterCount - 1) * layout.letterSpacing
  return measuredWidth <= titleAvailableWidth(layout)
}

function titleAvailableWidth(layout: NewsTextLayout) {
  const boxed = resolveTextBox(layout, 0)
  return Math.max(1, boxed.width - 8)
}

// Pretendard 한글 실제 폭 ≈ 1em. 0.9면 줄에 글자를 너무 많이 넣어 ASS에서 화면을 넘는다.
const TEXT_GLYPH_WIDTH_RATIO = 1.05

export function normalizeSubtitleCues(
  cues: SubtitleCue[],
  layout: NewsTextLayout
): SubtitleCue[] {
  return layoutSubtitleCues(mergeSubtitleSentenceCues(cues), layout)
}

/**
 * 음성 실측 구간의 전체 start~end는 지키되, 화면에 안 들어가면
 * 글자를 버리지 않고 여러 칸으로 나눠 시간을 비율 배분한다.
 */
export function layoutTimedSubtitleCues(
  cues: SubtitleCue[],
  layout: NewsTextLayout,
  options: { maxLines?: 1 | 2 } = {}
): SubtitleCue[] {
  const lineLimit = unitsPerLine(layout)
  const maxLines = options.maxLines === 1 ? 1 : 2
  const formatChunk = (value: string) =>
    maxLines === 1
      ? normalizeText(value)
      : wrapSubtitleChunkToTwoLines(value, layout, lineLimit)
  return cues.flatMap((cue) => {
    const raw = cue.text.replace(/\r\n/g, "\n").trim()
    if (!raw) return []

    const explicitLines = raw
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
      .filter(Boolean)
    if (
      explicitLines.length > 0 &&
      explicitLines.length <= maxLines &&
      explicitLines.every((line) => subtitleUnits(line) <= lineLimit)
    ) {
      const text = explicitLines.join("\n")
      return [
        {
          ...cue,
          text,
          emphasis: cue.emphasis.filter((word) => text.includes(word)),
        },
      ]
    }

    const chunks = splitIntoSubtitleChunks(
      raw.replace(/\n+/g, " "),
      layout,
      lineLimit,
      maxLines
    )
    if (!chunks.length) return []
    if (chunks.length === 1) {
      const text = formatChunk(chunks[0]!)
      return [
        {
          ...cue,
          text,
          emphasis: cue.emphasis.filter((word) => text.includes(word)),
        },
      ]
    }

    const weights = chunks.map((chunk) => Math.max(1, visualUnits(chunk)))
    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    const duration = Math.max(0, cue.end - cue.start)
    let elapsedWeight = 0
    return chunks.map((chunk, index) => {
      const sourceWeightStart = elapsedWeight
      const start = cue.start + (duration * elapsedWeight) / totalWeight
      elapsedWeight += weights[index]!
      const end =
        index === chunks.length - 1
          ? cue.end
          : cue.start + (duration * elapsedWeight) / totalWeight
      const text = formatChunk(chunk)
      return {
        ...subtitleCueWithoutSourceRange(cue),
        id: `${cue.id}-${index + 1}`,
        start: round(start),
        end: round(end),
        ...splitSubtitleCueSourceRange(
          cue,
          sourceWeightStart,
          elapsedWeight,
          totalWeight
        ),
        text,
        emphasis: cue.emphasis.filter((word) => text.includes(word)),
      }
    })
  })
}

function layoutSubtitleCues(cues: SubtitleCue[], layout: NewsTextLayout) {
  const lineLimit = unitsPerLine(layout)
  return cues.flatMap((cue) => {
    const chunks = splitIntoSubtitleChunks(cue.text, layout, lineLimit)
    if (chunks.length === 0) return []
    const weights = chunks.map((chunk) => Math.max(1, visualUnits(chunk)))
    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    const duration = Math.max(0, cue.end - cue.start)
    let elapsedWeight = 0

    return chunks.map((chunk, index) => {
      const sourceWeightStart = elapsedWeight
      const start = cue.start + (duration * elapsedWeight) / totalWeight
      elapsedWeight += weights[index]
      const end =
        index === chunks.length - 1
          ? cue.end
          : cue.start + (duration * elapsedWeight) / totalWeight
      return {
        ...(chunks.length === 1 ? cue : subtitleCueWithoutSourceRange(cue)),
        id: chunks.length === 1 ? cue.id : `${cue.id}-${index + 1}`,
        start: round(start),
        end: round(end),
        ...(chunks.length === 1
          ? {}
          : splitSubtitleCueSourceRange(
              cue,
              sourceWeightStart,
              elapsedWeight,
              totalWeight
            )),
        text: wrapSubtitleChunkToTwoLines(chunk, layout, lineLimit),
        emphasis: cue.emphasis.filter((word) => chunk.includes(word)),
      }
    })
  })
}

export function updateEditedSubtitleCue(
  cues: SubtitleCue[],
  cueId: string,
  text: string,
  layout: NewsTextLayout
) {
  const formattedText = formatEditedSubtitleText(text, layout)
  return cues.map((cue) =>
    cue.id === cueId
      ? formattedText
        ? {
            ...cue,
            originalText: cue.originalText ?? cue.text,
            originalEmphasis: cue.originalEmphasis ?? [...cue.emphasis],
            text: formattedText,
            edited: true,
          }
        : resetEditedSubtitleCueValue(cue)
      : cue
  )
}

export function resetEditedSubtitleCue(cues: SubtitleCue[], cueId: string) {
  return cues.map((cue) =>
    cue.id === cueId ? resetEditedSubtitleCueValue(cue) : cue
  )
}

export function canMergeSubtitleCueWithNext(
  cues: SubtitleCue[],
  cueId: string
) {
  const index = cues.findIndex((cue) => cue.id === cueId)
  const current = cues[index]
  const next = cues[index + 1]
  return Boolean(
    current?.sceneId && next?.sceneId && current.sceneId === next.sceneId
  )
}

export function canUndoSubtitleCueMerge(cue: SubtitleCue) {
  return Array.isArray(cue.mergedFrom) && cue.mergedFrom.length === 2
}

/** 합치기 직전의 두 자막과 각각의 원래 시간을 그대로 복원한다. */
export function undoSubtitleCueMerge(cues: SubtitleCue[], cueId: string) {
  const index = cues.findIndex((cue) => cue.id === cueId)
  const current = cues[index]
  if (!current || !canUndoSubtitleCueMerge(current)) return cues
  return [
    ...cues.slice(0, index),
    ...current.mergedFrom!.map(cloneSubtitleCue),
    ...cues.slice(index + 1),
  ]
}

/** 인접한 같은 장면 자막을 시간 범위와 사용자 문구를 보존한 채 합친다. */
export function mergeSubtitleCueWithNext(
  cues: SubtitleCue[],
  cueId: string,
  layout: NewsTextLayout
) {
  const index = cues.findIndex((cue) => cue.id === cueId)
  const current = cues[index]
  const next = cues[index + 1]
  if (!current?.sceneId || !next?.sceneId || current.sceneId !== next.sceneId) {
    return cues
  }

  const currentText = normalizeText(current.text)
  const nextText = normalizeText(next.text)
  const joinedText = normalizeJoinedCalendarDate(
    joinSubtitleText(currentText, nextText)
  )
  const text = reflowSubtitleTextPreservingContent(joinedText, layout)
  const originalText = normalizeJoinedCalendarDate(
    joinSubtitleText(
      normalizeText(current.originalText ?? current.text),
      normalizeText(next.originalText ?? next.text)
    )
  )
  const merged: SubtitleCue = {
    ...subtitleCueWithoutSourceRange(current),
    start: Math.min(current.start, next.start),
    end: Math.max(current.end, next.end),
    ...mergeSubtitleCueSourceRanges(current, next),
    text,
    emphasis: [...new Set([...current.emphasis, ...next.emphasis])].filter(
      (word) => text.includes(word)
    ),
    originalText,
    originalEmphasis: [
      ...new Set([
        ...(current.originalEmphasis ?? current.emphasis),
        ...(next.originalEmphasis ?? next.emphasis),
      ]),
    ],
    mergedFrom: [cloneSubtitleCue(current), cloneSubtitleCue(next)],
    edited: true,
  }
  return [...cues.slice(0, index), merged, ...cues.slice(index + 2)]
}

function cloneSubtitleCue(cue: SubtitleCue): SubtitleCue {
  return {
    ...cue,
    emphasis: [...cue.emphasis],
    ...(cue.originalEmphasis
      ? { originalEmphasis: [...cue.originalEmphasis] }
      : {}),
    ...(cue.mergedFrom
      ? { mergedFrom: cue.mergedFrom.map(cloneSubtitleCue) }
      : {}),
  }
}

function normalizeJoinedCalendarDate(value: string) {
  return value.replace(
    /(^|\s)(\d{2})년\s+(\d{1,2})월\s+(\d{1,2})일(?=\s|$|[,.;:!?])/gu,
    (_, prefix: string, year: string, month: string, day: string) =>
      `${prefix}20${year}년 ${month}월 ${day}일`
  )
}

function resetEditedSubtitleCueValue(cue: SubtitleCue): SubtitleCue {
  const { originalText, originalEmphasis, ...rest } = cue
  return {
    ...rest,
    text: originalText ?? cue.text,
    emphasis: originalEmphasis ? [...originalEmphasis] : [...cue.emphasis],
    edited: false,
  }
}

export function formatEditedSubtitleText(text: string, layout: NewsTextLayout) {
  const lineLimit = unitsPerLine(layout)
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
  // 검수 UI의 n/13과 같은 기준을 사용한다. 띄어쓰기는 글자 수에서 제외한다.
  if (
    lines.length &&
    lines.every((line) => subtitleCharacterCount(line) <= lineLimit)
  ) {
    return lines.join("\n")
  }
  const normalized = normalizeText(lines.join(" ") || text)
  if (!normalized) return ""
  return wrapSubtitleChunkToTwoLines(normalized, layout)
}

export function subtitleCharacterCount(value: string) {
  return [...value.replace(/\s/gu, "")].length
}

/**
 * 사용자가 확정한 문구는 하나도 버리지 않고, 현재 FFmpeg 폰트·폭에
 * 맞는 줄바꿈만 다시 계산한다. 2줄에 담을 수 없는 매우 긴 문구는
 * 자동 잘림보다 원문 보존을 우선한다.
 */
export function reflowSubtitleTextPreservingContent(
  text: string,
  layout: NewsTextLayout
) {
  const normalized = normalizeText(text)
  if (!normalized) return ""
  const formatted = wrapSubtitleChunkToTwoLines(
    normalized,
    layout,
    automaticSubtitleLineLimit(layout)
  )
  const comparable = (value: string) => value.replace(/\s+/g, "")
  return comparable(formatted) === comparable(normalized)
    ? formatted
    : text.trim()
}

function mergeSubtitleSentenceCues(cues: SubtitleCue[]) {
  const merged: SubtitleCue[] = []
  for (const cue of cues) {
    const text = normalizeText(cue.text)
    if (!text) continue
    const previous = merged.at(-1)
    // 원본 음성 자막·문구 경계는 타임코드를 유지한다. 문장부호 없으면 합치면 싱크가 깨진다.
    const preservesBoundary = cuePreservesTimingBoundary(cue)
    const previousPreservesBoundary = previous
      ? cuePreservesTimingBoundary(previous)
      : false
    const sameScene = (previous?.sceneId || "") === (cue.sceneId || "")
    if (
      previous &&
      sameScene &&
      !preservesBoundary &&
      !previousPreservesBoundary &&
      !/[.!?。！？]$/.test(previous.text)
    ) {
      previous.text = joinSubtitleText(previous.text, text)
      previous.end = Math.max(previous.end, cue.end)
      const sourceRange = mergeSubtitleCueSourceRanges(previous, cue)
      delete previous.sourceStart
      delete previous.sourceEnd
      Object.assign(previous, sourceRange)
      previous.emphasis = [...new Set([...previous.emphasis, ...cue.emphasis])]
      continue
    }
    merged.push({ ...cue, text, emphasis: [...cue.emphasis] })
  }
  return merged
}

type SubtitleSourceRange = Required<
  Pick<SubtitleCue, "sourceStart" | "sourceEnd">
>

function subtitleCueSourceRange(cue: SubtitleCue): SubtitleSourceRange | null {
  const sourceStart = cue.sourceStart
  const sourceEnd = cue.sourceEnd
  return typeof sourceStart === "number" &&
    Number.isFinite(sourceStart) &&
    typeof sourceEnd === "number" &&
    Number.isFinite(sourceEnd) &&
    sourceEnd >= sourceStart
    ? { sourceStart, sourceEnd }
    : null
}

function subtitleCueWithoutSourceRange(cue: SubtitleCue): SubtitleCue {
  const next = { ...cue }
  delete next.sourceStart
  delete next.sourceEnd
  return next
}

function splitSubtitleCueSourceRange(
  cue: SubtitleCue,
  startWeight: number,
  endWeight: number,
  totalWeight: number
): SubtitleSourceRange | Record<string, never> {
  const range = subtitleCueSourceRange(cue)
  if (!range || totalWeight <= 0) return {}
  const duration = range.sourceEnd - range.sourceStart
  return {
    sourceStart: round(
      range.sourceStart + (duration * startWeight) / totalWeight
    ),
    sourceEnd:
      endWeight >= totalWeight
        ? range.sourceEnd
        : round(range.sourceStart + (duration * endWeight) / totalWeight),
  }
}

function mergeSubtitleCueSourceRanges(
  left: SubtitleCue,
  right: SubtitleCue
): SubtitleSourceRange | Record<string, never> {
  const leftRange = subtitleCueSourceRange(left)
  const rightRange = subtitleCueSourceRange(right)
  if (!leftRange || !rightRange) return {}
  return {
    sourceStart: Math.min(leftRange.sourceStart, rightRange.sourceStart),
    sourceEnd: Math.max(leftRange.sourceEnd, rightRange.sourceEnd),
  }
}

function cuePreservesTimingBoundary(cue: SubtitleCue) {
  return (
    Boolean(cue.sceneId) ||
    cue.id.startsWith("report-phrase-") ||
    cue.id.startsWith("end-cta") ||
    cue.id.startsWith("quote-caption-") ||
    cue.id.startsWith("report-caption-")
  )
}

function joinSubtitleText(left: string, right: string) {
  const particle =
    /^(?:은|는|이|가|을|를|의|에|에서|에게|께|로|으로|와|과|도|만|부터|까지|보다|처럼|마다|조차|마저|라도|이나|나)(?:\s|$)/
  return particle.test(right) ? `${left}${right}` : `${left} ${right}`
}

export function retimeSubtitleCues(cues: SubtitleCue[], duration: number) {
  if (cues.length === 0) return []
  const targetDuration = Math.max(0, duration)
  const weights = cues.map((cue) => Math.max(0.1, cue.end - cue.start))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let elapsedWeight = 0

  return cues.map((cue, index) => {
    const start = (targetDuration * elapsedWeight) / totalWeight
    elapsedWeight += weights[index]
    const end =
      index === cues.length - 1
        ? targetDuration
        : (targetDuration * elapsedWeight) / totalWeight
    return { ...cue, start: round(start), end: round(end) }
  })
}

export function splitIntoSubtitleChunks(
  text: string,
  layout: NewsTextLayout,
  lineLimit = unitsPerLine(layout),
  maxLines: 1 | 2 = 2
) {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const chunkLimit = lineLimit * maxLines
  const sentences = normalized
    .match(/[^.!?。！？]+[.!?。！？]?/g)
    ?.map((value) => value.trim()) ?? [normalized]
  const chunks = sentences.flatMap((sentence) => {
    if (!sentence) return []
    return subtitleUnits(sentence) <= chunkLimit
      ? [sentence]
      : splitLongSentence(sentence, chunkLimit, subtitleUnits)
  })
  return balanceChunkBoundaries(chunks, chunkLimit, subtitleUnits)
}

function wrapSubtitleChunkToTwoLines(
  text: string,
  layout: NewsTextLayout,
  lineLimit = unitsPerLine(layout)
) {
  const normalized = normalizeText(text)
  if (subtitleUnits(normalized) <= lineLimit) return normalized
  const words = normalized.split(" ").filter(Boolean)
  if (words.length < 2) {
    return wrapLongTokenToTwoLines(normalized, lineLimit, subtitleUnits)
  }

  let bestIndex = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ")
    const second = words.slice(index).join(" ")
    const firstUnits = subtitleUnits(first)
    const secondUnits = subtitleUnits(second)
    const overflow =
      Math.max(0, firstUnits - lineLimit) + Math.max(0, secondUnits - lineLimit)
    const score =
      // 문법 덩어리 보호 점수가 높아도 실제 한 줄 상한을 넘는 후보를
      // 선택하면 안 된다. 폭 안에 드는 어절 경계를 항상 먼저 고른다.
      overflow * lineLimit * 20 +
      Math.abs(firstUnits - secondUnits) * 0.3 +
      subtitleLineBreakPenalty(first, second, lineLimit)
    if (score < bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  const first = words.slice(0, bestIndex).join(" ")
  const second = words.slice(bestIndex).join(" ")
  // 글자를 버리지 않는다. 한 칸(최대 2줄)에 안 들어가면 호출 전에 청크를 나눈다.
  if (subtitleUnits(first) <= lineLimit && subtitleUnits(second) <= lineLimit) {
    return `${first}\n${second}`
  }
  // 호출자가 보수적인 폭을 전달했더라도 실제 화면에 들어가면
  // `체포되\n셔서`처럼 어절을 자르지 않고 자연스러운 경계를 우선한다.
  const physicalLimit = unitsPerLine(layout)
  if (physicalLimit > lineLimit) {
    let physicalIndex = 0
    let physicalScore = Number.POSITIVE_INFINITY
    for (let index = 1; index < words.length; index += 1) {
      const physicalFirst = words.slice(0, index).join(" ")
      const physicalSecond = words.slice(index).join(" ")
      const firstUnits = subtitleUnits(physicalFirst)
      const secondUnits = subtitleUnits(physicalSecond)
      if (firstUnits > physicalLimit || secondUnits > physicalLimit) continue
      const score =
        Math.abs(firstUnits - secondUnits) * 0.3 +
        subtitleLineBreakPenalty(physicalFirst, physicalSecond, physicalLimit)
      if (score < physicalScore) {
        physicalIndex = index
        physicalScore = score
      }
    }
    if (physicalIndex > 0) {
      return `${words.slice(0, physicalIndex).join(" ")}\n${words
        .slice(physicalIndex)
        .join(" ")}`
    }
  }
  return wrapLongTokenToTwoLines(normalized, lineLimit, subtitleUnits)
}

function subtitleLineBreakPenalty(
  first: string,
  second: string,
  lineLimit: number
) {
  const left = normalizeText(first)
  const right = normalizeText(second)
  let penalty = 0
  if (
    isShortSubtitleOrphan(left, lineLimit) &&
    !continuesPurposeModifierOnNextLine(left, right)
  ) {
    penalty += lineLimit * 8
  }
  if (isShortSubtitleOrphan(right, lineLimit)) penalty += lineLimit * 8
  if (startsWithSubtitleParticle(right)) penalty += lineLimit * 12
  if (
    /[\d,.%]$/u.test(left) &&
    /^(?:원|명|개|건|번|배|조|억|만|천|백|년|월|일|시간|분|초|%)(?:\s|$)/u.test(
      right
    )
  ) {
    penalty += lineLimit * 12
  }
  if (
    /^(?:맞서서?|향해|통해|대해|관해|위한|대한|따른|하면서|아니라)(?:\s|$)/u.test(
      right
    ) &&
    !continuesPurposeModifierOnNextLine(left, right)
  ) {
    penalty += lineLimit * 14
  }
  if (
    /(?:은|는|이|가|을|를)$/u.test(left) &&
    /^(?:맞서서?|향해|통해|대해|관해|하면서|[가-힣]+기)(?:\s|$)/u.test(right) &&
    !/^[가-힣]+기\s+(?:위해|위해서|위하여)(?:\s|$)/u.test(right)
  ) {
    penalty += lineLimit * 14
  }
  if (
    /(?:기|함)$/u.test(left) &&
    /^(?:위한|위해|위해서|위하여)(?:\s|$)/u.test(right) &&
    !continuesPurposeModifierOnNextLine(left, right)
  ) {
    penalty += lineLimit * 14
  }
  if (
    /(?:게|케|히)$/u.test(left.split(" ").at(-1) ?? "") &&
    /^(?:한|할|하는|했던|해|해서|하지)(?:\s|$)/u.test(right)
  ) {
    penalty += lineLimit * 14
  }
  if (splitsSubtitleNominalCompound(left, right)) {
    penalty += lineLimit * 12
  }
  if (/(?:의|에|에서|에게|께|로|으로|와|과|위한|대한|따른)$/u.test(left)) {
    penalty += lineLimit * 2.5
  }
  if (/[,;:，；：–—]$/u.test(left)) penalty -= lineLimit * 4
  else if (/[.!?。！？]$/u.test(left)) penalty -= lineLimit * 5
  if (endsWithSubtitleClauseBreak(left)) penalty -= lineLimit * 5
  if (
    /^(?:그런데|하지만|그러나|그래서|그리고|다만|반면|결국|따라서|한편|즉|또)\b/u.test(
      right
    )
  ) {
    penalty -= lineLimit * 3
  }
  return penalty
}

function isShortSubtitleOrphan(value: string, lineLimit: number) {
  return (
    normalizeText(value).split(" ").length === 1 &&
    subtitleUnits(value) < lineLimit * 0.45
  )
}

function continuesPurposeModifierOnNextLine(left: string, right: string) {
  return (
    /(?:기|함)$/u.test(normalizeText(left)) &&
    /^(?:위한|대한|따른)\s+\S+/u.test(normalizeText(right))
  )
}

function splitsSubtitleNominalCompound(left: string, right: string) {
  const current = normalizeText(left).split(" ").at(-1) ?? ""
  const next = normalizeText(right).split(" ")[0] ?? ""
  // `사고 원인`, `보고서 내용`의 명사 끝을 연결어미 -고/-서로
  // 오인해 줄을 가르지 않는다.
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
    /^(?:한|할|하는|했던)$/u.test(current) &&
    /^것(?:은|는|이|가|을|를)$/u.test(next)
  ) {
    return false
  }
  if (
    endsWithSubtitleClauseBreak(current) ||
    /(?:했어|됐어|있어|없어|이야|거야|한다|했다|된다|됐다|있다|없다|입니다|습니다)$/u.test(
      current
    )
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

function endsWithSubtitleClauseBreak(value: string) {
  const text = normalizeText(value)
  if (
    /(?:고자|면서|면서도|니까|는데|지만|라고|하며|하고|해서|하여|돼서|되어|되고|으며|거나)$/u.test(
      text
    )
  ) {
    return true
  }
  if (/(?:에서|으로|에게|께|부터|까지|보다)$/u.test(text)) return false
  return /(?:고|서|며)$/u.test(text)
}

function startsWithSubtitleParticle(value: string) {
  return /^(?:은|는|이|가|을|를|의|에|에서|에게|께|로|으로|와|과|도|만|부터|까지|보다|처럼|마다|조차|마저|라도|이나|나)(?:\s|$|[,.;:!?])/u.test(
    normalizeText(value)
  )
}

/** 공백 없는 한글도 최대 2줄로 나눈다. 2줄을 넘치면 앞 두 줄만 두고, 나머지는 청크 분할 단계에서 처리한다. */
function wrapLongTokenToTwoLines(
  value: string,
  lineLimit: number,
  measure: (value: string) => number = visualUnits
) {
  const characters = [...value]
  if (!characters.length) return ""
  if (measure(value) <= lineLimit) return value

  const pieces = splitLongToken(value, lineLimit, measure)
  if (pieces.length <= 1) return pieces[0] ?? value
  if (pieces.length === 2) return `${pieces[0]}\n${pieces[1]}`
  // 호출 전 splitIntoSubtitleChunks가 2줄 분량으로 나눠야 한다. 방어적으로 앞 두 줄만 붙인다.
  return `${pieces[0]}\n${pieces[1]}`
}

function splitLongSentence(
  sentence: string,
  limit: number,
  measure: (value: string) => number = visualUnits
) {
  const clauses = naturalClauses(sentence)
  if (clauses.length >= 2) {
    const packed: string[] = []
    let current = ""
    for (const clause of clauses) {
      const candidate = current ? `${current} ${clause}` : clause
      if (!current || measure(candidate) <= limit) {
        current = candidate
        continue
      }
      packed.push(current)
      current = clause
    }
    if (current) packed.push(current)
    return balanceChunkBoundaries(
      packed.flatMap((chunk) => splitByWords(chunk, limit, measure)),
      limit,
      measure
    )
  }
  return splitByWords(sentence, limit, measure)
}

function naturalClauses(sentence: string) {
  return (
    sentence.match(/[^,;:，；：–—]+(?:[,;:，；：–—]+|$)/g) ?? [sentence]
  ).flatMap((clause) =>
    clause
      .trim()
      .split(
        /\s+(?=(?:하지만|그러나|반면(?:에)?|또한|다만|결국|따라서|그러므로|한편|이에 따라)(?:\s|$))/
      )
      .flatMap((part) =>
        part
          .split(
            /(?<=(?:고자|면서|면서도|니까|는데|지만|라고|하며|하고|해서|하여|돼서|되어|되고|으며|거나|(?<![에으위])[고서며]))\s+/u
          )
          .map((value) => value.trim())
          .filter(Boolean)
      )
  )
}

function splitByWords(
  sentence: string,
  limit: number,
  measure: (value: string) => number = visualUnits
) {
  const words = sentence.split(" ").filter(Boolean)
  const chunks: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (!current || measure(candidate) <= limit) {
      current = candidate
      continue
    }
    chunks.push(current)
    current = word
  }
  if (current) chunks.push(current)
  return balanceChunkBoundaries(
    chunks.flatMap((chunk) =>
      measure(chunk) <= limit ? [chunk] : splitLongToken(chunk, limit, measure)
    ),
    limit,
    measure
  )
}

function balanceChunkBoundaries(
  chunks: string[],
  limit: number,
  measure: (value: string) => number = visualUnits
) {
  const balanced = chunks.map(normalizeText).filter(Boolean)
  if (balanced.length < 2) return balanced

  let index = 0
  while (index < balanced.length) {
    if (!isOrphanChunk(balanced[index], limit, measure)) {
      index += 1
      continue
    }

    const previous = balanced[index - 1]
    const next = balanced[index + 1]
    if (previous && measure(`${previous} ${balanced[index]}`) <= limit) {
      balanced[index - 1] = `${previous} ${balanced[index]}`
      balanced.splice(index, 1)
      index = Math.max(0, index - 1)
      continue
    }
    if (next && measure(`${balanced[index]} ${next}`) <= limit) {
      balanced[index] = `${balanced[index]} ${next}`
      balanced.splice(index + 1, 1)
      continue
    }
    if (previous) {
      const [left, right] = balanceChunkPair(
        previous,
        balanced[index],
        limit,
        measure
      )
      balanced[index - 1] = left
      balanced[index] = right
    } else if (next) {
      const [left, right] = balanceChunkPair(
        balanced[index],
        next,
        limit,
        measure
      )
      balanced[index] = left
      balanced[index + 1] = right
    }
    index += 1
  }
  // 두 칸 모두 길이가 충분해도 `정권의 / 수준`, `나가기 / 위해`처럼
  // 문법 덩어리를 가르는 경계라면 인접 어절을 다시 배분한다.
  for (let pairIndex = 0; pairIndex < balanced.length - 1; pairIndex += 1) {
    const [left, right] = balanceChunkPair(
      balanced[pairIndex]!,
      balanced[pairIndex + 1]!,
      limit,
      measure
    )
    balanced[pairIndex] = left
    balanced[pairIndex + 1] = right
  }
  return balanced
}

function isOrphanChunk(
  value: string,
  limit: number,
  measure: (value: string) => number
) {
  const units = measure(value)
  const words = value.split(" ").filter(Boolean)
  return units < limit * 0.3 || (words.length === 1 && units < limit * 0.55)
}

function balanceChunkPair(
  left: string,
  right: string,
  limit: number,
  measure: (value: string) => number
) {
  const words = `${left} ${right}`.split(" ").filter(Boolean)
  if (words.length < 2) return [left, right]

  let best: [string, string] = [left, right]
  let bestScore = pairScore(left, right, limit, measure)
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ")
    const second = words.slice(index).join(" ")
    if (measure(first) > limit || measure(second) > limit) continue
    const score = pairScore(first, second, limit, measure)
    if (score < bestScore) {
      best = [first, second]
      bestScore = score
    }
  }
  return best
}

function pairScore(
  left: string,
  right: string,
  limit: number,
  measure: (value: string) => number
) {
  const leftUnits = measure(left)
  const rightUnits = measure(right)
  const shortPenalty =
    Math.min(leftUnits, rightUnits) < limit * 0.3 ? limit * 4 : 0
  const naturalBreakBonus = /[.!?。！？]$/.test(left)
    ? limit * 0.35
    : /[,;:，；：–—]$/.test(left)
      ? limit * 0.18
      : 0
  return (
    Math.abs(leftUnits - rightUnits) +
    shortPenalty -
    naturalBreakBonus +
    subtitleLineBreakPenalty(left, right, limit)
  )
}

function fitSingleLine(value: string, limit: number) {
  const normalized = normalizeText(value)
  if (visualUnits(normalized) <= limit) return normalized
  const words = normalized.split(" ").filter(Boolean)
  let fitted = ""
  for (const word of words) {
    const candidate = fitted ? `${fitted} ${word}` : word
    if (visualUnits(candidate) > limit) break
    fitted = candidate
  }
  if (fitted) return fitted
  return splitLongToken(normalized, limit)[0] ?? normalized
}

function fitSingleLineFromEnd(value: string, limit: number) {
  const normalized = normalizeText(value)
  if (visualUnits(normalized) <= limit) return normalized
  const words = normalized.split(" ").filter(Boolean)
  let fitted = ""
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const candidate = fitted ? `${words[index]} ${fitted}` : words[index]
    if (visualUnits(candidate) > limit) break
    fitted = candidate
  }
  if (fitted) return fitted
  const characters = [...normalized]
  return (
    splitLongToken(characters.reverse().join(""), limit)[0]
      ?.split("")
      .reverse()
      .join("") ?? normalized
  )
}

function splitLongToken(
  value: string,
  limit: number,
  measure: (value: string) => number = visualUnits
) {
  const chunks: string[] = []
  let current = ""
  for (const character of [...value]) {
    if (current && measure(current + character) > limit) {
      chunks.push(current)
      current = ""
    }
    current += character
  }
  if (current) chunks.push(current)
  return chunks
}

function unitsPerLine(layout: NewsTextLayout) {
  const advance = Math.max(
    1,
    layout.fontSize * TEXT_GLYPH_WIDTH_RATIO + layout.letterSpacing
  )
  // ASS \pos는 Margin을 무시하므로, 설정 폭보다 살짝 보수적으로 잡는다.
  const available = Math.max(1, layout.width - 16)
  return Math.max(4, Math.floor(available / advance))
}

function automaticSubtitleLineLimit(layout: NewsTextLayout) {
  return unitsPerLine(layout)
}

/** 자동·수동 자막이 공통으로 사용하는 FFmpeg 실제 한 줄 글자 단위. */
export function automaticSubtitleLineCharacterLimit(layout: NewsTextLayout) {
  return automaticSubtitleLineLimit(layout)
}

/** 문장 연결을 지킬 때만 사용할 수 있는 실제 두 줄 전체 글자 단위. */
export function automaticSubtitleCueCharacterLimit(layout: NewsTextLayout) {
  return subtitleLineCharacterLimit(layout) * 2
}

/** 검수 화면에서 수동 편집할 때 사용할 수 있는 FFmpeg 실제 한 줄 폭. */
export function subtitleLineCharacterLimit(layout: NewsTextLayout) {
  return unitsPerLine(layout)
}

function visualUnits(value: string) {
  return [...value].reduce((sum, character) => {
    if (/\s/.test(character)) return sum + 0.35
    if (/[\u0000-\u024f]/.test(character)) return sum + 0.58
    return sum + 1
  }, 0)
}

function subtitleUnits(value: string) {
  return Math.max(visualUnits(value), [...value].length)
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}

function percent(value: number) {
  return Math.round(value * 10) / 10
}
