import { spawn } from "node:child_process"
import { access, mkdir, rename, unlink } from "node:fs/promises"
import path from "node:path"

import {
  NEWS_SOURCE_PLAYBACK_RATE,
  sourceAudioTempo,
  sourceVideoSetpts,
} from "@/lib/news-clips/playback"
import { ffmpegBin } from "@/lib/server/ffmpeg-bin"

export type QuoteTightenResult = {
  videoPath: string
  audioPath: string
  duration: number
  method: "passthrough"
}

/**
 * 직접 발언 구간을 잘라 재생 배속만 적용한다.
 * 무음 점프컷은 자막 타임코드와 비선형으로 어긋나서 쓰지 않는다.
 */
export async function tightenQuoteSegment(input: {
  source: string
  start: number
  end: number
  folder: string
  key: string
  marginSeconds?: number
}): Promise<QuoteTightenResult> {
  const start = Math.max(0, input.start)
  const duration = Math.max(0.1, input.end - start)
  await mkdir(input.folder, { recursive: true })
  const rawPath = path.join(input.folder, `quote-raw-${input.key}.mp4`)
  const videoPath = path.join(input.folder, `quote-av-${input.key}.mp4`)
  const audioPath = path.join(input.folder, `quote-${input.key}.m4a`)
  const spedPath = path.join(input.folder, `quote-sped-${input.key}.mp4`)

  if (await exists(videoPath) && (await exists(audioPath))) {
    return {
      videoPath,
      audioPath,
      duration: await probeDuration(videoPath),
      method: "passthrough",
    }
  }

  await extractSegment(input.source, start, duration, rawPath)
  await applySourcePlaybackRate(rawPath, spedPath)
  await extractAudio(spedPath, audioPath)
  await safeUnlink(rawPath)
  await safeUnlink(videoPath)
  await renameOver(spedPath, videoPath)
  return {
    videoPath,
    audioPath,
    duration: await probeDuration(videoPath),
    method: "passthrough",
  }
}

async function extractSegment(
  source: string,
  start: number,
  duration: number,
  output: string
) {
  await run(ffmpegBin(), [
    "-y",
    "-ss",
    String(start),
    "-i",
    source,
    "-t",
    String(duration),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    output,
  ])
}

async function extractAudio(video: string, output: string) {
  await run(ffmpegBin(), [
    "-y",
    "-i",
    video,
    "-vn",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    output,
  ])
}

async function applySourcePlaybackRate(input: string, output: string) {
  const rate = sourceAudioTempo(NEWS_SOURCE_PLAYBACK_RATE)
  if (Math.abs(rate - 1) < 0.001) {
    await run(ffmpegBin(), ["-y", "-i", input, "-c", "copy", output])
    return
  }
  await run(ffmpegBin(), [
    "-y",
    "-i",
    input,
    "-filter_complex",
    `[0:v]${sourceVideoSetpts(rate)},fps=30,format=yuv420p[v];[0:a]atempo=${rate}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    output,
  ])
}

async function renameOver(from: string, to: string) {
  await rename(from, to)
}

function probeDuration(file: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      ffmpegBin(),
      ["-hide_banner", "-i", file, "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] }
    )
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("exit", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (!match) {
        reject(new Error("duration-probe-failed"))
        return
      }
      resolve(
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      )
    })
  })
}

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (error) => reject(error))
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`quote-tighten-failed:${code}:${stderr.slice(-300)}`)
          )
    )
  })
}

async function exists(value: string) {
  try {
    await access(value)
    return true
  } catch {
    return false
  }
}

async function safeUnlink(value: string) {
  try {
    await unlink(value)
  } catch {
    // ignore
  }
}
