import { mergeEditedSubtitleText } from "./report.ts"
import type { SubtitleCue } from "./types.ts"

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000
}

/**
 * 이전 합본 타임라인의 약 1초 오프셋이 잠긴 채 파트 자막에 남은 경우만
 * 실제 파트 길이에 맞춰 제거한다. 정상적인 선행 무음과 수동 시간은 유지한다.
 */
export function localizeLockedSubtitleCues(
  cues: SubtitleCue[],
  offsetSeconds: number,
  partDurationSeconds: number
) {
  if (!cues.length) return []
  const duration = Math.max(0.1, partDurationSeconds)
  const local = cues.map((cue) => ({
    ...cue,
    start: cue.start - offsetSeconds,
    end: cue.end - offsetSeconds,
  }))
  const earliestStart = Math.min(...local.map((cue) => cue.start))
  const latestEnd = Math.max(...local.map((cue) => cue.end))
  const overflow = latestEnd - duration
  const legacyOffset =
    overflow > 0.12 && earliestStart >= overflow - 0.2 ? overflow : 0

  return local.map((cue) => {
    const start = Math.max(
      0,
      Math.min(duration - 0.04, cue.start - legacyOffset)
    )
    const end = Math.max(
      start + 0.04,
      Math.min(duration, cue.end - legacyOffset)
    )
    return {
      ...cue,
      start: roundTime(start),
      end: roundTime(end),
    }
  })
}

/**
 * 4번의 수동 문구는 자막 시간이 다시 계산되더라도 편집본의 단일 진실이다.
 * 잠긴 경우에는 시간까지 그대로 쓰고, 잠금이 풀린 경우에는 서버가 계산한
 * 새 시간 위에 동일 ID의 수동 문구·강조만 다시 얹는다.
 */
export function preservePreviewSubtitleEdits(
  current: SubtitleCue[],
  rendered: SubtitleCue[] | undefined,
  timingsLocked: boolean,
  options: { acceptRenderedLockedTimings?: boolean } = {}
) {
  if (!rendered?.length) return current
  if (timingsLocked) {
    // 보도형은 렌더 서버가 기존 문구·줄바꿈을 보존한 채 실제 TTS 단어
    // 시각만 갱신한다. 이 경우 예전 잠긴 시간을 다시 덮어쓰지 않는다.
    if (options.acceptRenderedLockedTimings === true) return rendered
    // 빌드업형: 원본 음성(quote) 자동 칸은 잠긴 시간·문구를 유지하고,
    // TTS 서두·마무리(speech-caption)는 다시 만든 렌더 결과를 받는다.
    // 예전처럼 current를 ID로만 걸러 쓰면 서두를 다시 만들 때 새
    // speech-caption ID가 전부 버려져 자막 목록이 비게 된다.
    const renderedIds = new Set(rendered.map((cue) => cue.id))
    const lockedQuotes = new Map(
      current
        .filter(
          (cue) =>
            !cue.edited &&
            cue.id.startsWith("quote-caption") &&
            renderedIds.has(cue.id)
        )
        .map((cue) => [cue.id, cue] as const)
    )
    const withEdits = mergeEditedSubtitleText(rendered, current, {
      trustExactId: true,
      preserveTimes: true,
    })
    if (!lockedQuotes.size) return withEdits
    return withEdits.map((cue) => lockedQuotes.get(cue.id) ?? cue)
  }
  return mergeEditedSubtitleText(rendered, current, { trustExactId: true })
}
