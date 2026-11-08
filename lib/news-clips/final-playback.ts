import type { SubtitleCue } from "./types.ts"

export const FINAL_PLAYBACK_RATES = [1.1, 1.2, 1.3, 1.4, 1.5] as const
export type FinalPlaybackRate = (typeof FINAL_PLAYBACK_RATES)[number]

export function normalizeFinalPlaybackRate(value: unknown): FinalPlaybackRate {
  return FINAL_PLAYBACK_RATES.find(
    (rate) => Math.abs(rate - Number(value)) < 0.001
  ) ?? 1.1
}

export function finalPlaybackDuration(seconds: number, rate: number) {
  return round(Math.max(0, seconds) / normalizeFinalPlaybackRate(rate))
}

export function retimeSubtitlesForFinalPlayback(
  cues: SubtitleCue[],
  rate: number
) {
  const safeRate = normalizeFinalPlaybackRate(rate)
  return cues.map((cue) => ({
    ...cue,
    start: round(cue.start / safeRate),
    end: round(cue.end / safeRate),
  }))
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
