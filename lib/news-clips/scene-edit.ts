import type { NewsReportScene } from "./types.ts"

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
