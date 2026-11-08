import { spawn } from "node:child_process"
import { mkdir, readFile } from "node:fs/promises"
import path from "node:path"

type WhisperJson = {
  segments?: {
    start?: number
    end?: number
    text?: string
    words?: {
      word?: string
      start?: number
      end?: number
      probability?: number
    }[]
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
  const filename = `${path.basename(sourceFile, path.extname(sourceFile))}.json`
  const outputFile = path.join(outputDir, filename)
  try {
    const cached = JSON.parse(await readFile(outputFile, "utf8")) as WhisperJson
    if (cached.segments?.length) return timestampJson(cached)
  } catch {
    // 첫 분석이거나 불완전한 캐시는 아래에서 다시 전사한다.
  }
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
  const parsed = JSON.parse(
    await readFile(outputFile, "utf8")
  ) as WhisperJson
  return timestampJson(parsed)
}

function timestampJson(parsed: WhisperJson) {
  const segments = (parsed.segments ?? []).flatMap((segment) => {
    const start = number(segment.start)
    const end = number(segment.end)
    const text = segment.text?.trim() ?? ""
    if (!text || end <= start) return []
    const words = (segment.words ?? []).flatMap((word) => {
      const wordStart = number(word.start)
      const wordEnd = number(word.end)
      const value = word.word?.trim() ?? ""
      if (!value || wordEnd <= wordStart) return []
      return [
        {
          word: value,
          start: wordStart,
          end: wordEnd,
          probability: number(word.probability),
        },
      ]
    })
    return [{ start, end, text, words }]
  })
  if (!segments.length) throw new Error("whisper-empty")
  return JSON.stringify({
    format: "shortsfactory-word-timestamps-v1",
    segments,
  })
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
