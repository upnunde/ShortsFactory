/** 자막 시간을 비디오 프레임 경계에 맞춰 반올림 오차 누적을 줄인다. */
export const NEWS_RENDER_FPS = 30

export function snapSecondsToFrame(
  seconds: number,
  fps = NEWS_RENDER_FPS
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  const safeFps = Math.max(1, fps)
  return Math.round(seconds * safeFps) / safeFps
}

export function snapSubtitleCueTimes<
  T extends { start: number; end: number },
>(cues: T[], fps = NEWS_RENDER_FPS): T[] {
  return cues.map((cue) => {
    const start = snapSecondsToFrame(cue.start, fps)
    const end = Math.max(
      start + 1 / Math.max(1, fps),
      snapSecondsToFrame(cue.end, fps)
    )
    return { ...cue, start, end }
  })
}
