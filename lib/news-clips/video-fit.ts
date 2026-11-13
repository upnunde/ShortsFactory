import type { NewsMediaMotion } from "./types.ts"

export const NEWS_MEDIA_MOTION_OPTIONS: Array<{
  value: NewsMediaMotion
  label: string
}> = [
  { value: "none", label: "움직임 없음" },
  { value: "zoom-in", label: "조금씩 확대" },
  { value: "zoom-out", label: "조금씩 축소" },
  { value: "pan-left", label: "조금씩 좌로 이동" },
  { value: "pan-right", label: "조금씩 우로 이동" },
]

export function normalizeNewsMediaMotion(
  value: unknown,
  fallback: NewsMediaMotion = "none"
): NewsMediaMotion {
  return NEWS_MEDIA_MOTION_OPTIONS.some((option) => option.value === value)
    ? (value as NewsMediaMotion)
    : fallback
}

/** 장면 길이에 맞춘 미세 모션량. 초당 약 1%, 전체 6~28% 범위로 제한한다. */
export function newsMediaMotionAmount(durationSeconds: number) {
  const safeDuration = Number.isFinite(durationSeconds)
    ? Math.max(0.1, durationSeconds)
    : 3
  return Math.min(0.28, Math.max(0.06, safeDuration * 0.01))
}

/** 정적 구도 필터 뒤에 붙이는 길이 연동 선형 모션. 음성·자막 시간은 바꾸지 않는다. */
export function buildMediaMotionFilter({
  motion,
  targetWidth,
  targetHeight,
  durationSeconds,
  fps = 30,
  inputIsStill = false,
}: {
  motion: NewsMediaMotion | undefined
  targetWidth: number
  targetHeight: number
  durationSeconds: number
  fps?: number
  inputIsStill?: boolean
}) {
  const normalized = normalizeNewsMediaMotion(motion)
  if (normalized === "none") return ""
  const frames = Math.max(2, Math.round(Math.max(0.1, durationSeconds) * fps))
  const amount = newsMediaMotionAmount(durationSeconds).toFixed(6)
  const progress = `min(1,on/${frames - 1})`
  const reverseProgress = `(1-${progress})`
  const zoomProgress =
    normalized === "zoom-out" ? reverseProgress : progress
  const centeredX0 = `-W*${amount}*${zoomProgress}/2`
  const centeredX1 = `W+W*${amount}*${zoomProgress}/2`
  const centeredY0 = `-H*${amount}*${zoomProgress}/2`
  const centeredY1 = `H+H*${amount}*${zoomProgress}/2`
  const x0 =
    normalized === "pan-left"
      ? `-W*${amount}*${progress}`
      : normalized === "pan-right"
        ? `-W*${amount}*${reverseProgress}`
        : centeredX0
  const x1 =
    normalized === "pan-left"
      ? `W+W*${amount}*${reverseProgress}`
      : normalized === "pan-right"
        ? `W+W*${amount}*${progress}`
        : centeredX1
  const y0 =
    normalized === "pan-left" || normalized === "pan-right"
      ? `-H*${amount}/2`
      : centeredY0
  const y1 =
    normalized === "pan-left" || normalized === "pan-right"
      ? `H+H*${amount}/2`
      : centeredY1
  const stillFrames = inputIsStill
    ? `tpad=stop_mode=clone:stop_duration=${Math.max(0.1, durationSeconds)},fps=${fps},`
    : ""
  return `${stillFrames}perspective=x0='${x0}':y0='${y0}':x1='${x1}':y1='${y0}':x2='${x0}':y2='${y1}':x3='${x1}':y3='${y1}':interpolation=cubic:sense=destination:eval=frame,scale=${targetWidth}:${targetHeight}:flags=lanczos,setsar=1`
}

export function buildScaleCropFilter({
  targetWidth,
  targetHeight,
  zoom,
  cropX,
  cropY,
  fit = "cover",
  padColor = "#101114",
}: {
  targetWidth: number
  targetHeight: number
  zoom: number
  cropX: string
  cropY: string
  /** 영상은 cover, 이미지로 저장된 화면만 contain을 명시한다. */
  fit?: "cover" | "contain"
  padColor?: string
}) {
  const useContain = fit === "contain"
  const safeZoom = useContain
    ? Math.max(1 / 3, Math.min(3, zoom))
    : Math.max(1, Math.min(3, zoom))
  if (!useContain) {
    const sceneWidth = Math.round(targetWidth * safeZoom)
    const sceneHeight = Math.round(targetHeight * safeZoom)
    return `scale=${sceneWidth}:${sceneHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}:x='${cropX}':y='${cropY}',setsar=1`
  }
  if (safeZoom <= 1.0001) {
    return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=${padColor},setsar=1`
  }
  const zoomedWidth = Math.round(targetWidth * safeZoom)
  const zoomedHeight = Math.round(targetHeight * safeZoom)
  return `scale=${zoomedWidth}:${zoomedHeight}:force_original_aspect_ratio=decrease,pad=${zoomedWidth}:${zoomedHeight}:(ow-iw)/2:(oh-ih)/2:color=${padColor},crop=${targetWidth}:${targetHeight}:x='${cropX}':y='${cropY}',setsar=1`
}
