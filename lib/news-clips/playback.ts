/** 원본 영상(자료·직접 발언) 재생 배속. 1 = 원배속(배속 없음). */
export const NEWS_SOURCE_PLAYBACK_RATE = 1

export function sourceVideoSetpts(rate = NEWS_SOURCE_PLAYBACK_RATE) {
  const safe = clampPlaybackRate(rate)
  if (Math.abs(safe - 1) < 0.001) return "setpts=PTS-STARTPTS"
  return `setpts=PTS/${safe}`
}

export function sourceAudioTempo(rate = NEWS_SOURCE_PLAYBACK_RATE) {
  return clampPlaybackRate(rate)
}

export function sourceFootageSecondsForOutput(
  outputSeconds: number,
  rate = NEWS_SOURCE_PLAYBACK_RATE
) {
  return Math.max(0.1, outputSeconds * clampPlaybackRate(rate))
}

/** 원본 구간이 출력에서 차지하는 초. */
export function quoteOutputDurationSeconds(
  sourceStart: number,
  sourceEnd: number,
  rate = NEWS_SOURCE_PLAYBACK_RATE
) {
  const raw = Math.max(0.1, sourceEnd - sourceStart)
  return Math.max(0.5, raw / clampPlaybackRate(rate))
}

/** 원본 타임코드(구간 상대)를 출력 타임라인으로 변환한다. */
export function scaleQuoteTimelineSeconds(
  seconds: number,
  rate = NEWS_SOURCE_PLAYBACK_RATE
) {
  return Math.max(0, seconds / clampPlaybackRate(rate))
}

/** 출력 타임라인 초를 원본 구간의 상대 초로 되돌린다. */
export function unscaleQuoteTimelineSeconds(
  seconds: number,
  rate = NEWS_SOURCE_PLAYBACK_RATE
) {
  return Math.max(0, seconds * clampPlaybackRate(rate))
}

function clampPlaybackRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) return NEWS_SOURCE_PLAYBACK_RATE
  // ffmpeg atempo 허용 범위
  return Math.min(2, Math.max(0.5, rate))
}
