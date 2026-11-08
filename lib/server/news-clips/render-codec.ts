import { NEWS_RENDER_FPS } from "@/lib/news-clips/frame-snap"

/** intro/body/outro·concat이 공유하는 인코딩 규격. 모드별로만 해상도/preset이 다르다. */
export type NewsRenderDimensions = {
  width: number
  height: number
  scale: number
  preset: string
}

export const NEWS_RENDER_AUDIO_RATE = 48_000
export const NEWS_RENDER_PIXEL_FORMAT = "yuv420p"
export const NEWS_RENDER_VIDEO_CODEC = "libx264"
export const NEWS_RENDER_AUDIO_CODEC = "aac"

export function newsRenderDimensions(
  mode: "preview" | "final"
): NewsRenderDimensions {
  return mode === "preview"
    ? { width: 360, height: 640, scale: 360 / 1080, preset: "ultrafast" }
    : { width: 720, height: 1280, scale: 720 / 1080, preset: "medium" }
}

export function newsVideoEncodeArgs(dimensions: NewsRenderDimensions) {
  return [
    "-r",
    String(NEWS_RENDER_FPS),
    "-c:v",
    NEWS_RENDER_VIDEO_CODEC,
    "-preset",
    dimensions.preset,
    "-pix_fmt",
    NEWS_RENDER_PIXEL_FORMAT,
  ] as string[]
}

export function newsAudioEncodeArgs() {
  return [
    "-c:a",
    NEWS_RENDER_AUDIO_CODEC,
    "-ar",
    String(NEWS_RENDER_AUDIO_RATE),
    "-ac",
    "2",
  ] as string[]
}

/** 파트 개별 라우드니스. concat 단계에는 절대 쓰지 않는다. */
export const NEWS_PART_LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"
