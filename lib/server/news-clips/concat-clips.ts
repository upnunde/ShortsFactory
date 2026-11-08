import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import {
  NEWS_RENDER_AUDIO_CODEC,
  NEWS_RENDER_AUDIO_RATE,
  NEWS_RENDER_PIXEL_FORMAT,
  NEWS_RENDER_VIDEO_CODEC,
} from "@/lib/server/news-clips/render-codec"

/** 각 파트의 PTS·오디오 샘플레이트를 0초 기준으로 정규화한 뒤 한 타임라인으로 합친다. */
export async function concatNewsClips(
  parts: string[],
  output: string,
  _listPath: string,
  run: (bin: string, args: string[]) => Promise<void>
) {
  if (parts.length === 0) {
    throw new Error("concat-clips-empty")
  }
  const inputs = parts.flatMap((part) => ["-i", part])
  const normalized = parts.flatMap((_, index) => [
    `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=30,format=${NEWS_RENDER_PIXEL_FORMAT}[v${index}]`,
    `[${index}:a]aresample=${NEWS_RENDER_AUDIO_RATE}:async=1:first_pts=0,asetpts=PTS-STARTPTS[a${index}]`,
  ])
  const streams = parts
    .map((_, index) => `[v${index}][a${index}]`)
    .join("")
  await run(ffmpegBin(), [
    "-y",
    ...inputs,
    "-filter_complex",
    `${normalized.join(";")};${streams}concat=n=${parts.length}:v=1:a=1[v][a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-r",
    "30",
    "-c:v",
    NEWS_RENDER_VIDEO_CODEC,
    "-pix_fmt",
    NEWS_RENDER_PIXEL_FORMAT,
    "-c:a",
    NEWS_RENDER_AUDIO_CODEC,
    "-ar",
    String(NEWS_RENDER_AUDIO_RATE),
    "-ac",
    "2",
    output,
  ])
}
