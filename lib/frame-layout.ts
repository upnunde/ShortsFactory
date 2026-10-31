export type FrameLayout = {
  titleHeight: number
  subtitleHeight: number
}

export const defaultFrameLayout: FrameLayout = {
  titleHeight: 22,
  subtitleHeight: 14,
}

const MIN_BAND = 10
const MAX_TITLE = 40
const MAX_SUBTITLE = 30
const MIN_VIDEO = 40

export function videoHeight(layout: FrameLayout) {
  return 100 - layout.titleHeight - layout.subtitleHeight
}

export function setFrameBand(layout: FrameLayout, band: "title" | "subtitle", value: number) {
  if (band === "title") {
    return {
      ...layout,
      titleHeight: clamp(value, MIN_BAND, Math.min(MAX_TITLE, 100 - MIN_VIDEO - layout.subtitleHeight)),
    }
  }
  return {
    ...layout,
    subtitleHeight: clamp(value, MIN_BAND, Math.min(MAX_SUBTITLE, 100 - MIN_VIDEO - layout.titleHeight)),
  }
}

export function normalizeFrameLayout(value: unknown): FrameLayout {
  const record = value && typeof value === "object" ? (value as Partial<FrameLayout>) : {}
  return setFrameBand(
    setFrameBand(defaultFrameLayout, "title", numberOf(record.titleHeight, defaultFrameLayout.titleHeight)),
    "subtitle",
    numberOf(record.subtitleHeight, defaultFrameLayout.subtitleHeight),
  )
}

function numberOf(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}
