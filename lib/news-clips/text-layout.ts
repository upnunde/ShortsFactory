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
const AUTO_SUBTITLE_FILL_RATIO = 0.8

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
  layout: NewsTextLayout
): SubtitleCue[] {
  const lineLimit = automaticSubtitleLineLimit(layout)
  return cues.flatMap((cue) => {
    const raw = cue.text.replace(/\r\n/g, "\n").trim()
    if (!raw) return []

    const explicitLines = raw
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
      .filter(Boolean)
    if (
      explicitLines.length > 0 &&
      explicitLines.length <= 2 &&
      explicitLines.every((line) => visualUnits(line) <= lineLimit)
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
      lineLimit
    )
    if (!chunks.length) return []
    if (chunks.length === 1) {
      const text = wrapSubtitleChunkToTwoLines(chunks[0]!, layout, lineLimit)
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
      const start = cue.start + (duration * elapsedWeight) / totalWeight
      elapsedWeight += weights[index]!
      const end =
        index === chunks.length - 1
          ? cue.end
          : cue.start + (duration * elapsedWeight) / totalWeight
      const text = wrapSubtitleChunkToTwoLines(chunk, layout, lineLimit)
      return {
        ...cue,
        id: `${cue.id}-${index + 1}`,
        start: round(start),
        end: round(end),
        text,
        emphasis: cue.emphasis.filter((word) => text.includes(word)),
      }
    })
  })
}

function layoutSubtitleCues(cues: SubtitleCue[], layout: NewsTextLayout) {
  const lineLimit = automaticSubtitleLineLimit(layout)
  return cues.flatMap((cue) => {
    const chunks = splitIntoSubtitleChunks(cue.text, layout, lineLimit)
    if (chunks.length === 0) return []
    const weights = chunks.map((chunk) => Math.max(1, visualUnits(chunk)))
    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    const duration = Math.max(0, cue.end - cue.start)
    let elapsedWeight = 0

    return chunks.map((chunk, index) => {
      const start = cue.start + (duration * elapsedWeight) / totalWeight
      elapsedWeight += weights[index]
      const end =
        index === chunks.length - 1
          ? cue.end
          : cue.start + (duration * elapsedWeight) / totalWeight
      return {
        ...cue,
        id: chunks.length === 1 ? cue.id : `${cue.id}-${index + 1}`,
        start: round(start),
        end: round(end),
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
  // 사용자가 넣은 줄바꿈은 폭 안에 들어오면 유지하고, 넘치면 전체를 다시 감싼다.
  if (/\r?\n/.test(text)) {
    const lines = text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 2)
    if (lines.length && lines.every((line) => visualUnits(line) <= lineLimit)) {
      return lines.join("\n")
    }
    return wrapSubtitleChunkToTwoLines(lines.join(" "), layout)
  }
  const normalized = normalizeText(text)
  if (!normalized) return ""
  return wrapSubtitleChunkToTwoLines(normalized, layout)
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
      previous.emphasis = [...new Set([...previous.emphasis, ...cue.emphasis])]
      continue
    }
    merged.push({ ...cue, text, emphasis: [...cue.emphasis] })
  }
  return merged
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
  lineLimit = unitsPerLine(layout)
) {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const chunkLimit = lineLimit * 2
  const sentences = normalized
    .match(/[^.!?。！？]+[.!?。！？]?/g)
    ?.map((value) => value.trim()) ?? [normalized]
  const chunks = sentences.flatMap((sentence) => {
    if (!sentence) return []
    return visualUnits(sentence) <= chunkLimit
      ? [sentence]
      : splitLongSentence(sentence, chunkLimit)
  })
  return balanceChunkBoundaries(chunks, chunkLimit)
}

function wrapSubtitleChunkToTwoLines(
  text: string,
  layout: NewsTextLayout,
  lineLimit = unitsPerLine(layout)
) {
  const normalized = normalizeText(text)
  if (visualUnits(normalized) <= lineLimit) return normalized
  const words = normalized.split(" ").filter(Boolean)
  if (words.length < 2) {
    return wrapLongTokenToTwoLines(normalized, lineLimit)
  }

  let bestIndex = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ")
    const second = words.slice(index).join(" ")
    const firstUnits = visualUnits(first)
    const secondUnits = visualUnits(second)
    const overflow =
      Math.max(0, firstUnits - lineLimit) + Math.max(0, secondUnits - lineLimit)
    const score =
      overflow * lineLimit * 4 +
      Math.abs(firstUnits - secondUnits) +
      subtitleLineBreakPenalty(first, second, lineLimit)
    if (score < bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  const first = words.slice(0, bestIndex).join(" ")
  const second = words.slice(bestIndex).join(" ")
  // 글자를 버리지 않는다. 한 칸(최대 2줄)에 안 들어가면 호출 전에 청크를 나눈다.
  if (visualUnits(first) <= lineLimit && visualUnits(second) <= lineLimit) {
    return `${first}\n${second}`
  }
  return wrapLongTokenToTwoLines(normalized, lineLimit)
}

function subtitleLineBreakPenalty(
  first: string,
  second: string,
  lineLimit: number
) {
  const left = normalizeText(first)
  const right = normalizeText(second)
  let penalty = 0
  if (startsWithSubtitleParticle(right)) penalty += lineLimit * 12
  if (
    /[\d,.%]$/u.test(left) &&
    /^(?:원|명|개|건|번|배|조|억|만|천|백|년|월|일|시간|분|초|%)(?:\s|$)/u.test(
      right
    )
  ) {
    penalty += lineLimit * 12
  }
  if (/(?:의|에|에서|에게|께|로|으로|와|과|위한|대한|따른)$/u.test(left)) {
    penalty += lineLimit * 2.5
  }
  if (/[,;:，；：–—]$/u.test(left)) penalty -= lineLimit * 1.2
  else if (/[.!?。！？]$/u.test(left)) penalty -= lineLimit * 1.5
  if (
    /^(?:그런데|하지만|그러나|그래서|그리고|다만|반면|결국|따라서|한편|즉|또)\b/u.test(
      right
    )
  ) {
    penalty -= lineLimit * 0.8
  }
  return penalty
}

function startsWithSubtitleParticle(value: string) {
  return /^(?:은|는|이|가|을|를|의|에|에서|에게|께|로|으로|와|과|도|만|부터|까지|보다|처럼|마다|조차|마저|라도|이나|나)(?:\s|$|[,.;:!?])/u.test(
    normalizeText(value)
  )
}

/** 공백 없는 한글도 최대 2줄로 나눈다. 2줄을 넘치면 앞 두 줄만 두고, 나머지는 청크 분할 단계에서 처리한다. */
function wrapLongTokenToTwoLines(value: string, lineLimit: number) {
  const characters = [...value]
  if (!characters.length) return ""
  if (visualUnits(value) <= lineLimit) return value

  const pieces = splitLongToken(value, lineLimit)
  if (pieces.length <= 1) return pieces[0] ?? value
  if (pieces.length === 2) return `${pieces[0]}\n${pieces[1]}`
  // 호출 전 splitIntoSubtitleChunks가 2줄 분량으로 나눠야 한다. 방어적으로 앞 두 줄만 붙인다.
  return `${pieces[0]}\n${pieces[1]}`
}

function splitLongSentence(sentence: string, limit: number) {
  const clauses = naturalClauses(sentence)
  if (clauses.length >= 2) {
    const packed: string[] = []
    let current = ""
    for (const clause of clauses) {
      const candidate = current ? `${current} ${clause}` : clause
      if (!current || visualUnits(candidate) <= limit) {
        current = candidate
        continue
      }
      packed.push(current)
      current = clause
    }
    if (current) packed.push(current)
    return balanceChunkBoundaries(
      packed.flatMap((chunk) => splitByWords(chunk, limit)),
      limit
    )
  }
  return splitByWords(sentence, limit)
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
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

function splitByWords(sentence: string, limit: number) {
  const words = sentence.split(" ").filter(Boolean)
  const chunks: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (!current || visualUnits(candidate) <= limit) {
      current = candidate
      continue
    }
    chunks.push(current)
    current = word
  }
  if (current) chunks.push(current)
  return balanceChunkBoundaries(
    chunks.flatMap((chunk) =>
      visualUnits(chunk) <= limit ? [chunk] : splitLongToken(chunk, limit)
    ),
    limit
  )
}

function balanceChunkBoundaries(chunks: string[], limit: number) {
  const balanced = chunks.map(normalizeText).filter(Boolean)
  if (balanced.length < 2) return balanced

  let index = 0
  while (index < balanced.length) {
    if (!isOrphanChunk(balanced[index], limit)) {
      index += 1
      continue
    }

    const previous = balanced[index - 1]
    const next = balanced[index + 1]
    if (previous && visualUnits(`${previous} ${balanced[index]}`) <= limit) {
      balanced[index - 1] = `${previous} ${balanced[index]}`
      balanced.splice(index, 1)
      index = Math.max(0, index - 1)
      continue
    }
    if (next && visualUnits(`${balanced[index]} ${next}`) <= limit) {
      balanced[index] = `${balanced[index]} ${next}`
      balanced.splice(index + 1, 1)
      continue
    }
    if (previous) {
      const [left, right] = balanceChunkPair(previous, balanced[index], limit)
      balanced[index - 1] = left
      balanced[index] = right
    } else if (next) {
      const [left, right] = balanceChunkPair(balanced[index], next, limit)
      balanced[index] = left
      balanced[index + 1] = right
    }
    index += 1
  }
  return balanced
}

function isOrphanChunk(value: string, limit: number) {
  const units = visualUnits(value)
  const words = value.split(" ").filter(Boolean)
  return units < limit * 0.3 || (words.length === 1 && units < limit * 0.55)
}

function balanceChunkPair(left: string, right: string, limit: number) {
  const words = `${left} ${right}`.split(" ").filter(Boolean)
  if (words.length < 2) return [left, right]

  let best: [string, string] = [left, right]
  let bestScore = pairScore(left, right, limit)
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ")
    const second = words.slice(index).join(" ")
    if (visualUnits(first) > limit || visualUnits(second) > limit) continue
    const score = pairScore(first, second, limit)
    if (score < bestScore) {
      best = [first, second]
      bestScore = score
    }
  }
  return best
}

function pairScore(left: string, right: string, limit: number) {
  const leftUnits = visualUnits(left)
  const rightUnits = visualUnits(right)
  const shortPenalty =
    Math.min(leftUnits, rightUnits) < limit * 0.3 ? limit * 4 : 0
  const naturalBreakBonus = /[.!?。！？]$/.test(left)
    ? limit * 0.35
    : /[,;:，；：–—]$/.test(left)
      ? limit * 0.18
      : 0
  return Math.abs(leftUnits - rightUnits) + shortPenalty - naturalBreakBonus
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

function splitLongToken(value: string, limit: number) {
  const chunks: string[] = []
  let current = ""
  for (const character of [...value]) {
    if (current && visualUnits(current + character) > limit) {
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
  return Math.max(
    4,
    Math.floor(unitsPerLine(layout) * AUTO_SUBTITLE_FILL_RATIO)
  )
}

function visualUnits(value: string) {
  return [...value].reduce((sum, character) => {
    if (/\s/.test(character)) return sum + 0.35
    if (/[\u0000-\u024f]/.test(character)) return sum + 0.58
    return sum + 1
  }, 0)
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
