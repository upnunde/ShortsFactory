export type NewsClipOutputMetadata = {
  width: number
  height: number
  fps: number
  audioRate: number
  stereo: boolean
  duration: number
}

export function parseNewsClipMetadata(
  stderr: string
): NewsClipOutputMetadata | null {
  const durationMatch = stderr.match(
    /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/
  )
  const videoLine = stderr
    .split("\n")
    .find((line) => /Stream .*Video:/.test(line))
  const audioLine = stderr
    .split("\n")
    .find((line) => /Stream .*Audio:/.test(line))
  const sizeMatch = videoLine?.match(/(?:^|\s)(\d{2,5})x(\d{2,5})(?:[\s,]|$)/)
  const fpsMatch = videoLine?.match(/([\d.]+)\s+fps\b/)
  const audioRateMatch = audioLine?.match(/(\d+)\s+Hz\b/)
  if (
    !durationMatch ||
    !sizeMatch ||
    !fpsMatch ||
    !audioRateMatch ||
    !audioLine
  ) {
    return null
  }
  const duration =
    Number(durationMatch[1]) * 3600 +
    Number(durationMatch[2]) * 60 +
    Number(durationMatch[3])
  const metadata = {
    width: Number(sizeMatch[1]),
    height: Number(sizeMatch[2]),
    fps: Number(fpsMatch[1]),
    audioRate: Number(audioRateMatch[1]),
    stereo: /\bstereo\b/.test(audioLine),
    duration,
  }
  return Object.values(metadata).every((value) =>
    typeof value === "boolean" ? true : Number.isFinite(value)
  )
    ? metadata
    : null
}
