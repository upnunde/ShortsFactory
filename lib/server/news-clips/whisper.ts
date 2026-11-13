import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { access, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { paddedWhisperRange } from "@/lib/news-clips/whisper-range"
import { ffmpegBin } from "@/lib/server/ffmpeg-bin"

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
  projectId: string,
  initialPrompt = ""
) {
  const bin = await whisperBin()
  const mlx = path.basename(bin) === "mlx_whisper"
  const model =
    process.env.WHISPER_MODEL?.trim() ||
    (mlx ? "mlx-community/whisper-large-v3-turbo" : "small")
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
    const cached = parseWhisperJson(await readFile(outputFile, "utf8"))
    if (cached.segments?.length) return timestampJson(cached)
  } catch {
    // 첫 분석이거나 불완전한 캐시는 아래에서 다시 전사한다.
  }
  const promptArgs = initialPrompt.trim()
    ? mlx
      ? ["--initial-prompt", initialPrompt.trim()]
      : ["--initial_prompt", initialPrompt.trim()]
    : []
  await run(
    bin,
    mlx
      ? [
          sourceFile,
          "--model",
          model,
          "--language",
          "ko",
          "--task",
          "transcribe",
          "--word-timestamps",
          "True",
          "--output-format",
          "json",
          "--output-dir",
          outputDir,
          "--verbose",
          "False",
          ...promptArgs,
        ]
      : [
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
          ...promptArgs,
        ]
  )
  const parsed = parseWhisperJson(await readFile(outputFile, "utf8"))
  return timestampJson(parsed)
}

/** 선택한 실제 사용 구간만 원본 음성에서 다시 전사한다. */
export async function transcribeRangeWithLocalWhisper(
  sourceFile: string,
  projectId: string,
  range: { start: number; end: number },
  initialPrompt = "",
  options: { paddingSeconds?: number } = {}
) {
  const { start, end } = paddedWhisperRange(
    range,
    options.paddingSeconds ?? 1.5
  )
  const key = createHash("sha256")
    .update(JSON.stringify({ sourceFile, start, end, initialPrompt }))
    .digest("hex")
    .slice(0, 16)
  const folder = path.join(
    process.cwd(),
    "outputs",
    "news-clips",
    projectId,
    "whisper-ranges"
  )
  const clip = path.join(folder, `range-${key}.wav`)
  await mkdir(folder, { recursive: true })
  try {
    await access(clip)
  } catch {
    await run(ffmpegBin(), [
      "-y",
      "-ss",
      String(start),
      "-i",
      sourceFile,
      "-t",
      String(end - start),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      clip,
    ])
  }
  const relative = JSON.parse(
    await transcribeWithLocalWhisper(clip, projectId, initialPrompt)
  ) as WhisperJson
  const segments = (relative.segments ?? []).map((segment) => ({
    ...segment,
    start: number(segment.start) + start,
    end: number(segment.end) + start,
    words: (segment.words ?? []).map((word) => ({
      ...word,
      start: number(word.start) + start,
      end: number(word.end) + start,
    })),
  }))
  return timestampJson({ segments })
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

function parseWhisperJson(value: string): WhisperJson {
  // mlx-whisper가 극히 낮은 확률 구간에 JSON 표준이 아닌 NaN을 기록할 수 있다.
  // 해당 메타값은 타임스탬프에 쓰지 않으므로 null로 바꿔 캐시를 재사용한다.
  return JSON.parse(
    value.replace(/\b(?:NaN|Infinity|-Infinity)\b/g, "null")
  ) as WhisperJson
}

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: "ignore",
      env: {
        ...process.env,
        PATH: [
          path.join(process.cwd(), "node_modules", "ffmpeg-static"),
          process.env.PATH ?? "",
        ]
          .filter(Boolean)
          .join(path.delimiter),
        HF_HOME:
          process.env.HF_HOME?.trim() ||
          path.join(process.cwd(), ".tools", "huggingface"),
      },
    })
    child.on("error", () => reject(new Error("whisper-unavailable")))
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("whisper-failed"))
    )
  })
}

async function whisperBin() {
  const configured = process.env.WHISPER_BIN?.trim()
  if (configured) return configured
  const mlx = path.join(
    process.cwd(),
    ".tools",
    "whisper-venv",
    "bin",
    "mlx_whisper"
  )
  try {
    await access(mlx)
    return mlx
  } catch {
    return "whisper"
  }
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
