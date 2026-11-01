import {
  captionUnits,
  fitCaption,
  fontAssName,
  TITLE_BAND,
  type FrameLayout,
} from "./frame-layout"

const WIDTH = 1080
const HEIGHT = 1920

export type RenderSubtitle = {
  subtitle: string
  duration: number
}

const SCALE = WIDTH / 900
const subtitlePadX = Math.round(20 * SCALE)
const subtitlePadY = Math.round(20 * SCALE)
const titleBottom = Math.round(342 * (HEIGHT / 1600))

export function frameVideoFilter(_layout: FrameLayout) {
  const titleBand = evenPixel(HEIGHT * TITLE_BAND)
  const video = HEIGHT - titleBand
  return [
    `scale=${WIDTH}:${video}:force_original_aspect_ratio=increase`,
    `crop=${WIDTH}:${video}`,
    `pad=${WIDTH}:${HEIGHT}:0:${titleBand}:0x111111`,
    "setsar=1",
  ].join(",")
}

export function buildLayoutAss(
  layout: FrameLayout,
  title: string,
  scenes: RenderSubtitle[]
) {
  const positions = textPositions(layout)
  const total = scenes.reduce(
    (sum, scene) => sum + Math.max(0, scene.duration),
    0
  )
  const events = [
    dialogue(
      0,
      Math.max(total, 0.1),
      "Title",
      positions.title,
      fitCaption(title, captionUnits(layout.titleSize)).join("\n"),
      2
    ),
  ]
  let cursor = 0
  for (const scene of scenes) {
    const duration = Math.max(0, scene.duration)
    const cues = cueSlices(scene.subtitle, duration)
    if (cues.length === 0) {
      cursor += duration
      continue
    }
    for (const cue of cues) {
      const caption = fitCaption(cue.text, captionUnits(layout.subtitleSize))
        .slice(0, 2)
        .join("\n")
      if (caption && cue.duration > 0) {
        events.push(
          dialogue(
            cursor,
            cursor + cue.duration,
            "Subtitle",
            positions.subtitle,
            caption,
            8
          )
        )
      }
      cursor += cue.duration
    }
  }
  return `${header(layout)}\n${events.join("\n")}\n`
}

export function buildTimedSrt(scenes: RenderSubtitle[]) {
  let cursor = 0
  const blocks: string[] = []
  for (const scene of scenes) {
    const duration = Math.max(0, scene.duration)
    const cues = cueSlices(scene.subtitle, duration)
    if (cues.length === 0) {
      cursor += duration
      continue
    }
    for (const cue of cues) {
      const start = cursor
      cursor += cue.duration
      if (cue.text.trim() && cue.duration > 0) {
        blocks.push(
          `${blocks.length + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${cue.text.trim()}`
        )
      }
    }
  }
  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : ""
}

export function cueSlices(subtitle: string, duration: number) {
  const lines = subtitle
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0 || duration <= 0) {
    return []
  }
  const weights = lines.map((line) =>
    Math.max(1, line.split(/\s+/).filter(Boolean).length)
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let used = 0
  return lines.map((text, index) => {
    const slice =
      index === lines.length - 1
        ? duration - used
        : (duration * weights[index]) / total
    used += slice
    return { text, duration: slice }
  })
}

function textPositions(layout: FrameLayout) {
  return {
    title: { x: WIDTH / 2, y: titleBottom },
    subtitle: {
      x: WIDTH / 2,
      y: (HEIGHT * layout.subtitleY) / 100 + subtitlePadY,
    },
  }
}

function dialogue(
  start: number,
  end: number,
  style: "Title" | "Subtitle",
  position: { x: number; y: number },
  text: string,
  align: 2 | 5 | 8
) {
  const x = Math.round(position.x)
  const y = Math.round(position.y)
  const box =
    style === "Subtitle" ? `\\xbord${subtitlePadX}\\ybord${subtitlePadY}` : ""
  return `Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,{\\an${align}\\pos(${x},${y})${box}}${escapeAss(text)}`
}

function header(layout: FrameLayout) {
  const titleFont = Math.round(layout.titleSize * SCALE)
  const subtitleFont = Math.round(layout.subtitleSize * SCALE)
  const font = fontAssName(layout.fontWeight)
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,${font},${titleFont},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1
Style: Subtitle,${font},${subtitleFont},&H00FFFFFF,&H00FFFFFF,&H80000000,&H00000000,0,0,0,0,100,100,0,0,3,0,0,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`
}

function assTime(seconds: number) {
  const centiseconds = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor((centiseconds % 360_000) / 6_000)
  const wholeSeconds = Math.floor((centiseconds % 6_000) / 100)
  const fraction = centiseconds % 100
  return `${hours}:${pad(minutes)}:${pad(wholeSeconds)}.${pad(fraction)}`
}

function srtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000)
  const fraction = milliseconds % 1000
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)},${String(fraction).padStart(3, "0")}`
}

function escapeAss(text: string) {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("\r\n", "\n")
    .replaceAll("\n", "\\N")
}

function evenPixel(value: number) {
  return Math.max(2, Math.round(value / 2) * 2)
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}
