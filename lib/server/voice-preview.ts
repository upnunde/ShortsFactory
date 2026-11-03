import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import { generateNarration } from "@/lib/server/tts"
import { readVoiceId } from "@/lib/server/voice"
import { wordTimings, type WordTiming } from "@/lib/voice-timing"

const previewDir = path.join(process.cwd(), "outputs", "voice-preview")

export type PreviewClip = {
  id: string
  file: string
  duration: number
  text: string
  words: WordTiming[]
}

export type PreviewResult = {
  key: string
  clips: PreviewClip[]
  total: number
}

const jobs = new Map<string, Promise<PreviewResult>>()
let chain: Promise<void> = Promise.resolve()

export async function previewNarration(
  scenes: { id: string; text: string }[],
  profileId = "default"
) {
  const voiceId = await readVoiceId(profileId)
  const key = createHash("sha256")
    .update(
      `${voiceId}\n${scenes.map((scene) => `${scene.id}|${scene.text}`).join("\n")}`
    )
    .digest("hex")
    .slice(0, 16)
  const saved = await readManifest(key)
  if (saved) {
    return saved
  }
  const running = jobs.get(key)
  if (running) {
    return running
  }
  const job = enqueue(() => buildPreview(scenes, voiceId, key))
  jobs.set(key, job)
  void job
    .finally(() => {
      jobs.delete(key)
    })
    .catch(() => undefined)
  return job
}

export async function readPreviewAudio(key: string, clip: string) {
  if (!/^[a-f0-9]{16}$/.test(key)) {
    return null
  }
  const manifest = await readManifest(key)
  if (!manifest) {
    return null
  }
  const fileName =
    clip === "all"
      ? "all.wav"
      : manifest.clips.find((item) => item.id === clip)?.file
  if (!fileName || !/^(?:voice-\d{2}|all)\.wav$/.test(fileName)) {
    return null
  }
  const directory = path.resolve(previewDir, key)
  const filePath = path.resolve(directory, fileName)
  if (!filePath.startsWith(`${directory}${path.sep}`)) {
    return null
  }
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

async function buildPreview(
  scenes: { id: string; text: string }[],
  voiceId: string,
  key: string
) {
  const saved = await readManifest(key)
  if (saved) {
    return saved
  }
  const dir = path.join(previewDir, key)
  const clips = await generateNarration(scenes, voiceId, dir)
  const listPath = path.join(dir, "concat.txt")
  await writeFile(
    listPath,
    clips
      .map((clip) => `file '${clip.filePath.replaceAll("'", "'\\''")}'`)
      .join("\n")
  )
  await runBin(ffmpegBin(), [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    path.join(dir, "all.wav"),
  ])
  const result: PreviewResult = {
    key,
    clips: clips.map((clip, index) => ({
      id: scenes[index]?.id ?? clip.id,
      file: `voice-${String(index + 1).padStart(2, "0")}.wav`,
      duration: clip.duration,
      text: scenes[index]?.text ?? "",
      words: clip.words,
    })),
    total: clips.reduce((sum, clip) => sum + clip.duration, 0),
  }
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(result)}\n`
  )
  return result
}

async function readManifest(key: string) {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(previewDir, key, "manifest.json"), "utf8")
    ) as PreviewResult
    return {
      ...parsed,
      clips: parsed.clips.map((clip) => ({
        ...clip,
        words: Array.isArray(clip.words)
          ? clip.words
          : wordTimings(clip.text, clip.duration),
      })),
    }
  } catch {
    return null
  }
}

function enqueue<T>(task: () => Promise<T>) {
  const run = chain.then(task, task)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function runBin(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error("ffmpeg"))
      }
    })
  })
}
