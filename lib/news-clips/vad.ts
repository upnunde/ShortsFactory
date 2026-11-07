import type { RemovedRange } from "./types.ts"

/** 뉴스 현장음(앰비언스)에서도 호흡·공백을 잡도록 -38dB보다 느슨하게. */
export const NEWS_SILENCE_NOISE_DB = -28
export const NEWS_SILENCE_MIN_DURATION_SECONDS = 0.12
export const NEWS_SILENCE_PAD_SECONDS = 0.04
export const NEWS_SILENCE_CUT_MIN_SECONDS = 0.15

export function silenceDetectFilter(
  noiseDb = NEWS_SILENCE_NOISE_DB,
  minDurationSeconds = NEWS_SILENCE_MIN_DURATION_SECONDS
) {
  return `silencedetect=n=${noiseDb}dB:d=${minDurationSeconds}`
}

export function autoEditorSilenceEdit(noiseDb = NEWS_SILENCE_NOISE_DB) {
  return `audio:${noiseDb}dB`
}

export function parseSilenceOutput(output: string): RemovedRange[] {
  const starts = [...output.matchAll(/silence_start:\s*([\d.]+)/g)].map(
    (match) => Number(match[1])
  )
  const ends = [...output.matchAll(/silence_end:\s*([\d.]+)/g)].map((match) =>
    Number(match[1])
  )
  const ranges: RemovedRange[] = []
  for (
    let index = 0;
    index < Math.min(starts.length, ends.length);
    index += 1
  ) {
    const start = starts[index] + NEWS_SILENCE_PAD_SECONDS
    const end = ends[index] - NEWS_SILENCE_PAD_SECONDS
    if (end - start < NEWS_SILENCE_CUT_MIN_SECONDS) continue
    ranges.push({
      id: `vad-${ranges.length + 1}`,
      start: round(start),
      end: round(end),
      reason: "silence",
      restored: false,
    })
  }
  return ranges
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
