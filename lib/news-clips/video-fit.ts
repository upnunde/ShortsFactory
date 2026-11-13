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
  positionX = 0.5,
  positionY = 0.5,
}: {
  targetWidth: number
  targetHeight: number
  zoom: number
  cropX: string
  cropY: string
  /** 영상은 cover, 이미지로 저장된 화면만 contain을 명시한다. */
  fit?: "cover" | "contain"
  padColor?: string
  positionX?: number
  positionY?: number
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
  const zoomedWidth = Math.round(targetWidth * safeZoom)
  const zoomedHeight = Math.round(targetHeight * safeZoom)
  const x = Math.max(0, Math.min(1, positionX)).toFixed(4)
  const y = Math.max(0, Math.min(1, positionY)).toFixed(4)
  // contain 이미지는 확대 후에도 한 축은 캔버스보다 작을 수 있다. 예를 들어
  // 가로 이미지를 120%로 키우면 가로는 잘라야 하지만 세로는 여전히 여백에
  // 배치해야 한다. 확대 캔버스 중앙에 먼저 pad하면 이 세로 위치가 사라지므로,
  // 각 축을 실제 미디어 크기와 최종 캔버스 크기 중 큰 쪽에 먼저 배치한 뒤
  // 넘치는 축만 같은 위치 비율로 crop한다. 브라우저 미리보기의
  // `(frame - media) * position` 배치와 동일하다.
  return `scale=${zoomedWidth}:${zoomedHeight}:force_original_aspect_ratio=decrease,pad=w='max(iw,${targetWidth})':h='max(ih,${targetHeight})':x='max(0,(ow-iw)*${x})':y='max(0,(oh-ih)*${y})':color=${padColor},crop=${targetWidth}:${targetHeight}:x='max(0,(iw-ow)*${x})':y='max(0,(ih-oh)*${y})',setsar=1`
}
