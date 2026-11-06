import type { NewsTextLayout, SubtitleCue } from "./types.ts"

export function resolveTextBox(
  layout: NewsTextLayout,
  safeMarginPercent: number
) {
  const width = Math.max(120, Math.min(1080, layout.width))
  const safe = Math.round(
    (1080 * Math.max(0, Math.min(20, safeMarginPercent))) / 100
  )
  const x =
    layout.alignment === "left"
      ? Math.min(safe, 1080 - width)
      : layout.alignment === "right"
        ? Math.max(0, 1080 - safe - width)
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
  return Math.max(1, layout.width - 8)
}

const TEXT_GLYPH_WIDTH_RATIO = 0.9

export function normalizeSubtitleCues(
  cues: SubtitleCue[],
  layout: NewsTextLayout
): SubtitleCue[] {
  return mergeSubtitleSentenceCues(cues).flatMap((cue) => {
    const chunks = splitIntoSubtitleChunks(cue.text, layout)
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
        text: wrapSubtitleChunkToTwoLines(chunk, layout),
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
    cue.id === cueId ? { ...cue, text: formattedText } : cue
  )
}

export function formatEditedSubtitleText(text: string, layout: NewsTextLayout) {
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
    const preservesBoundary =
      cue.id.startsWith("report-phrase-") || cue.id.startsWith("end-cta")
    const previousPreservesBoundary =
      previous?.id.startsWith("report-phrase-") ||
      previous?.id.startsWith("end-cta")
    if (
      previous &&
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

export function splitIntoSubtitleChunks(text: string, layout: NewsTextLayout) {
  const normalized = normalizeText(text)
  if (!normalized) return []
  const chunkLimit = unitsPerLine(layout) * 2
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

function wrapSubtitleChunkToTwoLines(text: string, layout: NewsTextLayout) {
  const normalized = normalizeText(text)
  const lineLimit = unitsPerLine(layout)
  if (visualUnits(normalized) <= lineLimit) return normalized
  const words = normalized.split(" ").filter(Boolean)
  if (words.length < 2) return normalized

  let bestIndex = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ")
    const second = words.slice(index).join(" ")
    const firstUnits = visualUnits(first)
    const secondUnits = visualUnits(second)
    const overflow =
      Math.max(0, firstUnits - lineLimit) + Math.max(0, secondUnits - lineLimit)
    const score = overflow * lineLimit * 4 + Math.abs(firstUnits - secondUnits)
    if (score < bestScore) {
      bestIndex = index
      bestScore = score
    }
  }
  return `${words.slice(0, bestIndex).join(" ")}\n${words
    .slice(bestIndex)
    .join(" ")}`
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
      visualUnits(chunk) <= limit || !/\s/.test(chunk)
        ? [chunk]
        : splitLongToken(chunk, limit)
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
    layout.fontSize * 0.7,
    layout.fontSize * TEXT_GLYPH_WIDTH_RATIO + layout.letterSpacing
  )
  return Math.max(4, Math.floor(layout.width / advance))
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
