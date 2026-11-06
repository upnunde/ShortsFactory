import { spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import path from "node:path"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import { readSource } from "@/lib/server/news-clips/source-store"

export const runtime = "nodejs"
export const maxDuration = 60

const FRAME_COUNT = 8
const FRAME_WIDTH = 120
const FRAME_HEIGHT = 68
const pending = new Map<string, Promise<void>>()

export async function GET(request: Request) {
  const sourceId = new URL(request.url).searchParams.get("sourceId") ?? ""
  const source = await readSource(sourceId)
  const root = path.resolve(process.cwd(), "outputs", "news-clips")
  const localFile = source?.localFile ? path.resolve(source.localFile) : ""
  if (
    !source?.approved ||
    !localFile ||
    !localFile.startsWith(`${root}${path.sep}`)
  ) {
    return new Response("Not found", { status: 404 })
  }

  const output = path.join(path.dirname(localFile), "timeline-strip-v3.jpg")
  try {
    await access(output)
  } catch {
    let task = pending.get(output)
    if (!task) {
      task = createTimelineStrip(
        localFile,
        output,
        source.durationSeconds
      ).finally(() => pending.delete(output))
      pending.set(output, task)
    }
    try {
      await task
    } catch {
      return new Response("Timeline unavailable", { status: 500 })
    }
  }

  return new Response(new Uint8Array(await readFile(output)), {
    headers: {
      "Cache-Control": "private, max-age=86400",
      "Content-Type": "image/jpeg",
    },
  })
}

async function createTimelineStrip(
  input: string,
  output: string,
  savedDuration: number
) {
  const duration =
    savedDuration > 0 ? savedDuration : await videoDuration(input)
  const timestamps = Array.from(
    { length: FRAME_COUNT },
    (_, index) => (duration * (index + 0.5)) / FRAME_COUNT
  )
  const frameFilters = timestamps.map(
    (_, index) =>
      `[${index}:v]scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:force_original_aspect_ratio=increase,crop=${FRAME_WIDTH}:${FRAME_HEIGHT},setsar=1[frame${index}]`
  )
  const frameInputs = timestamps.map((_, index) => `[frame${index}]`).join("")
  await run([
    "-y",
    ...timestamps.flatMap((timestamp) => [
      "-ss",
      timestamp.toFixed(3),
      "-i",
      input,
    ]),
    "-filter_complex",
    `${frameFilters.join(";")};${frameInputs}hstack=inputs=${FRAME_COUNT}[strip]`,
    "-map",
    "[strip]",
    "-frames:v",
    "1",
    "-q:v",
    "4",
    output,
  ])
}

function videoDuration(input: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      ffmpegBin(),
      ["-hide_banner", "-i", input, "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] }
    )
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("error", () => reject(new Error("ffmpeg-failed")))
    child.on("exit", () => {
      const match = stderr.match(
        /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/
      )
      if (!match) {
        reject(new Error("ffmpeg-failed"))
        return
      }
      const duration =
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      if (Number.isFinite(duration) && duration > 0) {
        resolve(duration)
        return
      }
      reject(new Error("ffmpeg-failed"))
    })
  })
}

function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, {
      stdio: ["ignore", "ignore", "pipe"],
    })
    child.on("error", () => reject(new Error("ffmpeg-failed")))
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("ffmpeg-failed"))
    )
  })
}
