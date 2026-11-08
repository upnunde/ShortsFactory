import { spawn } from "node:child_process"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import { NEWS_RENDER_FPS } from "@/lib/news-clips/frame-snap"
import { parseNewsClipMetadata } from "@/lib/news-clips/output-validation"
import type { NewsRenderDimensions } from "@/lib/server/news-clips/render-codec"
import { NEWS_RENDER_AUDIO_RATE } from "@/lib/server/news-clips/render-codec"

export async function validateNewsClipOutput(
  file: string,
  dimensions: NewsRenderDimensions,
  expectedDuration: number
) {
  const inspection = await inspect(file)
  const metadata = parseNewsClipMetadata(inspection)
  if (!metadata) throw new Error("output-validation-metadata")
  if (
    metadata.width !== dimensions.width ||
    metadata.height !== dimensions.height
  ) {
    throw new Error("output-validation-dimensions")
  }
  if (Math.abs(metadata.fps - NEWS_RENDER_FPS) > 0.05) {
    throw new Error("output-validation-fps")
  }
  if (
    metadata.audioRate !== NEWS_RENDER_AUDIO_RATE ||
    metadata.stereo !== true
  ) {
    throw new Error("output-validation-audio")
  }
  if (Math.abs(metadata.duration - expectedDuration) > 0.5) {
    throw new Error("output-validation-duration")
  }
  await decode(file)
  return metadata
}

function inspect(file: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpegBin(), ["-hide_banner", "-i", file], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("error", () => reject(new Error("output-validation-inspect")))
    child.on("exit", () => resolve(stderr))
  })
}

function decode(file: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegBin(),
      [
        "-v",
        "error",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    )
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000)
    })
    child.on("error", () => reject(new Error("output-validation-decode")))
    child.on("exit", (code) => {
      if (code === 0 && !stderr.trim()) {
        resolve()
        return
      }
      reject(new Error("output-validation-decode"))
    })
  })
}
