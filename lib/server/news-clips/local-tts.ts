import "server-only"

import { spawn } from "node:child_process"
import { mkdir, stat, unlink } from "node:fs/promises"
import path from "node:path"

import { pipeline, RawAudio } from "@huggingface/transformers"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import { koreanTtsInput } from "@/lib/news-clips/korean-speech"
import { newsTtsVoiceById } from "@/lib/news-clips/voices"

const MMS_KOREAN_MODEL = "Xenova/mms-tts-kor"

let mmsPipelinePromise: ReturnType<typeof createMmsPipeline> | null = null

export async function synthesizeLocalKoreanSpeech(
  text: string,
  voiceId: string,
  ratePercent: number,
  output: string
) {
  const spokenText = text.replace(/\s*\n\s*/g, " ").trim()
  if (!spokenText) throw new Error("local-tts-failed")
  await mkdir(path.dirname(output), { recursive: true })
  const voice = newsTtsVoiceById(voiceId)
  if (voice.id === "mms-kor") {
    await synthesizeMmsKoreanSpeech(spokenText, ratePercent, output)
    return
  }
  const wordsPerMinute = Math.round(
    185 * (1 + Math.max(-15, Math.min(8, ratePercent)) / 100)
  )
  await runSay([
    "-v",
    "Yuna",
    "-r",
    String(wordsPerMinute),
    "-o",
    output,
    "--data-format=LEI16@24000",
    spokenText,
  ])
  const file = await stat(output).catch(() => null)
  if (!file || file.size <= 4_096) {
    await unlink(output).catch(() => undefined)
    throw new Error("local-tts-failed")
  }
}

async function synthesizeMmsKoreanSpeech(
  text: string,
  ratePercent: number,
  output: string
) {
  const source = `${output}.source.wav`
  try {
    const synthesizer = await loadMmsPipeline()
    const generated = await synthesizer(koreanTtsInput(text), {})
    const audio = new RawAudio(generated.audio, generated.sampling_rate)
    await audio.save(source)
    const speed = Math.max(0.85, Math.min(1.08, 1 + ratePercent / 100))
    await runProcess(ffmpegBin(), [
      "-y",
      "-i",
      source,
      "-af",
      `atempo=${speed.toFixed(3)}`,
      "-ar",
      "24000",
      output,
    ])
    const file = await stat(output).catch(() => null)
    if (!file || file.size <= 4_096) throw new Error("local-tts-failed")
  } catch (error) {
    console.error("Korean MMS TTS failed", error)
    throw new Error("local-tts-failed")
  } finally {
    await unlink(source).catch(() => undefined)
  }
}

function createMmsPipeline() {
  return pipeline("text-to-speech", MMS_KOREAN_MODEL, { dtype: "q8" })
}

function loadMmsPipeline() {
  mmsPipelinePromise ??= createMmsPipeline()
  return mmsPipelinePromise
}

function runSay(args: string[]) {
  return runProcess("/usr/bin/say", args, "local-tts-unavailable")
}

function runProcess(
  command: string,
  args: string[],
  missingCode = "local-tts-failed"
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000)
    })
    child.on("error", () => reject(new Error(missingCode)))
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      console.error("Local Korean TTS failed", stderr)
      reject(new Error("local-tts-failed"))
    })
  })
}
