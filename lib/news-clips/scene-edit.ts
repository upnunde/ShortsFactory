import type { NewsClipProductionMode, NewsReportScene } from "./types.ts"

/**
 * 음성·영상 시간축을 다시 만들어야 하는 장면 변경인지 판별한다.
 * crop의 확대·X·Y 변경은 화면 구성만 바꾸므로 타임라인 변경이 아니다.
 */
export function sceneTimingChanged(
  scene: NewsReportScene,
  patch: Partial<NewsReportScene>
) {
  return (
    (patch.sourceStart !== undefined &&
      patch.sourceStart !== scene.sourceStart) ||
    (patch.sourceEnd !== undefined && patch.sourceEnd !== scene.sourceEnd) ||
    (patch.sourceId !== undefined && patch.sourceId !== scene.sourceId) ||
    (patch.visual !== undefined && patch.visual !== scene.visual) ||
    (patch.narration !== undefined && patch.narration !== scene.narration)
  )
}

/**
 * 보도형은 TTS가 시간축이므로 자료영상의 소스·구간·크롭을 바꿔도 기존
 * 음성·자막 시간을 유지한다. 빌드업형은 원본 영상 구간이 곧 음성이다.
 */
export function sceneAudioTimingChanged(
  productionMode: NewsClipProductionMode,
  scene: NewsReportScene,
  patch: Partial<NewsReportScene>
) {
  if (
    (patch.narration !== undefined && patch.narration !== scene.narration) ||
    (patch.part !== undefined && patch.part !== scene.part) ||
    (patch.audioMode !== undefined && patch.audioMode !== scene.audioMode)
  ) {
    return true
  }
  return productionMode === "buildup2" && sceneTimingChanged(scene, patch)
}

/** 사용자가 고른 자료영상 구간을 원본 길이 안에서 그대로 보존한다. */
export function clampSceneSourceRange(
  scene: Pick<NewsReportScene, "sourceStart" | "sourceEnd">,
  sourceDuration: number
) {
  const safeDuration = Math.max(
    0.1,
    Number.isFinite(sourceDuration) ? sourceDuration : 0.1
  )
  const maximumStart = Math.max(0, safeDuration - 0.1)
  const start = Math.max(
    0,
    Math.min(
      maximumStart,
      Number.isFinite(scene.sourceStart) ? scene.sourceStart : 0
    )
  )
  const end = Math.max(
    start + 0.1,
    Math.min(
      safeDuration,
      Number.isFinite(scene.sourceEnd) ? scene.sourceEnd : start + 0.5
    )
  )
  return {
    start: Math.round(start * 1000) / 1000,
    end: Math.round(Math.min(safeDuration, end) * 1000) / 1000,
  }
}
