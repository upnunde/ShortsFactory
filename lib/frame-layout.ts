export const FONT_WEIGHTS = [
  { weight: 400, label: "보통", assName: "Pretendard Regular" },
  { weight: 500, label: "중간", assName: "Pretendard Medium" },
  { weight: 600, label: "약간 굵게", assName: "Pretendard SemiBold" },
  { weight: 700, label: "굵게", assName: "Pretendard Bold" },
  { weight: 800, label: "더 굵게", assName: "Pretendard ExtraBold" },
  { weight: 900, label: "가장 굵게", assName: "Pretendard Black" },
] as const

export type FontWeight = (typeof FONT_WEIGHTS)[number]["weight"]

export type FrameLayout = {
  fontFamily: "pretendard"
  fontWeight: FontWeight
  titleSize: number
  subtitleSize: number
  subtitleY: number
}

export const defaultFrameLayout: FrameLayout = {
  fontFamily: "pretendard",
  fontWeight: 700,
  titleSize: 60,
  subtitleSize: 50,
  subtitleY: 75,
}

export const TITLE_BAND = 0.25

const TITLE_SIZE = { min: 36, max: 96 }
const SUBTITLE_SIZE = { min: 28, max: 80 }
const SUBTITLE_Y = { min: 28, max: 92 }

export function fontAssName(weight: number) {
  return (
    FONT_WEIGHTS.find((item) => item.weight === weight)?.assName ??
    "Pretendard Bold"
  )
}

export function fitCaption(text: string, maxUnits: number) {
  const explicit = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (
    explicit.length > 0 &&
    explicit.length <= 2 &&
    explicit.every((line) => textUnits(line) <= maxUnits)
  ) {
    return explicit
  }
  const line = explicit.join(" ")
  if (!line || textUnits(line) <= maxUnits) {
    return line ? [line] : []
  }
  const words = line.split(/\s+/).filter(Boolean)
  if (words.length < 2) {
    return [line]
  }
  let best = 1
  let bestGap = Number.POSITIVE_INFINITY
  for (let index = 1; index < words.length; index += 1) {
    const gap = Math.abs(
      textUnits(words.slice(0, index).join(" ")) -
        textUnits(words.slice(index).join(" "))
    )
    if (gap < bestGap) {
      best = index
      bestGap = gap
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")]
}

export function captionUnits(fontSize: number) {
  return Math.max(8, Math.round(820 / fontSize))
}

function textUnits(text: string) {
  let units = 0
  for (const char of text) {
    units += char.charCodeAt(0) > 127 ? 1 : 0.55
  }
  return units
}

export function setSubtitleY(layout: FrameLayout, y: number) {
  return {
    ...layout,
    subtitleY: clamp(y, SUBTITLE_Y.min, SUBTITLE_Y.max),
  }
}

export function setTitleSize(layout: FrameLayout, size: number) {
  return {
    ...layout,
    titleSize: clamp(size, TITLE_SIZE.min, TITLE_SIZE.max),
  }
}

export function setSubtitleSize(layout: FrameLayout, size: number) {
  return {
    ...layout,
    subtitleSize: clamp(size, SUBTITLE_SIZE.min, SUBTITLE_SIZE.max),
  }
}

export function setFontWeight(layout: FrameLayout, weight: number) {
  return { ...layout, fontWeight: weightOf(weight) }
}

export function normalizeFrameLayout(value: unknown): FrameLayout {
  const record =
    value && typeof value === "object"
      ? (value as Partial<FrameLayout>)
      : {}
  const legacy = typeof record.fontWeight !== "number"
  return {
    fontFamily: "pretendard",
    fontWeight: weightOf(record.fontWeight),
    titleSize: clamp(
      numberOf(record.titleSize, defaultFrameLayout.titleSize),
      TITLE_SIZE.min,
      TITLE_SIZE.max
    ),
    subtitleSize: clamp(
      numberOf(record.subtitleSize, defaultFrameLayout.subtitleSize),
      SUBTITLE_SIZE.min,
      SUBTITLE_SIZE.max
    ),
    subtitleY: legacy
      ? defaultFrameLayout.subtitleY
      : clamp(
          numberOf(record.subtitleY, defaultFrameLayout.subtitleY),
          SUBTITLE_Y.min,
          SUBTITLE_Y.max
        ),
  }
}

function weightOf(value: unknown): FontWeight {
  const weight = FONT_WEIGHTS.find((item) => item.weight === value)
  return weight ? weight.weight : defaultFrameLayout.fontWeight
}

function numberOf(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}
