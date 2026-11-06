import { spawn } from "node:child_process"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"

type WhisperJson = {
  segments?: {
    start?: number
    end?: number
    text?: string
  }[]
}

export async function transcribeWithLocalWhisper(
  sourceFile: string,
  projectId: string
) {
  const bin = process.env.WHISPER_BIN?.trim() || "whisper"
  const model = process.env.WHISPER_MODEL?.trim() || "small"
  const outputDir = path.join(
    process.cwd(),
    "outputs",
    "news-clips",
    projectId,
    "whisper"
  )
  await mkdir(outputDir, { recursive: true })
  await run(bin, [
    sourceFile,
    "--model",
    model,
    "--language",
    "ko",
    "--task",
    "transcribe",
    "--word_timestamps",
    "True",
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
  ])
  const filename = `${path.basename(sourceFile, path.extname(sourceFile))}.json`
  const parsed = JSON.parse(
    await readFile(path.join(outputDir, filename), "utf8")
  ) as WhisperJson
  const segments = parsed.segments ?? []
  if (segments.length === 0) throw new Error("whisper-empty")
  return segments
    .flatMap((segment, index) => {
      const start = number(segment.start)
      const end = number(segment.end)
      const text = segment.text?.trim() ?? ""
      if (!text || end <= start) return []
      return [`${index + 1}\n${srt(start)} --> ${srt(end)}\n${text}\n`]
    })
    .join("\n")
}

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" })
    child.on("error", () => reject(new Error("whisper-unavailable")))
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("whisper-failed"))
    )
  })
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function srt(value: number) {
  const millis = Math.round(Math.max(0, value) * 1000)
  const hours = Math.floor(millis / 3_600_000)
  const minutes = Math.floor((millis % 3_600_000) / 60_000)
  const seconds = Math.floor((millis % 60_000) / 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(
    millis % 1000
  ).padStart(3, "0")}`
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}
