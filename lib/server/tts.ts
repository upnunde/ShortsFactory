import { mkdir } from "node:fs/promises"
import path from "node:path"

import { KokoroTTS } from "kokoro-js"

import { wordTimings, type WordTiming } from "@/lib/voice-timing"

const modelId = "onnx-community/Kokoro-82M-v1.0-ONNX"

let modelPromise: ReturnType<typeof KokoroTTS.from_pretrained> | null = null

export type NarrationClip = {
  id: string
  filePath: string
  duration: number
  words: WordTiming[]
}

export async function generateNarration(
  scenes: { id: string; text: string }[],
  voice: string,
  outputDir: string,
  speed = 1
) {
  await mkdir(outputDir, { recursive: true })
  const model = await loadModel()
  const clips: NarrationClip[] = []
  for (const [index, scene] of scenes.entries()) {
    let audio
    try {
      audio = await model.generate(scene.text, {
        voice: voice as Parameters<typeof model.generate>[1] extends {
          voice?: infer V
        }
          ? V
          : never,
        speed,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.error(`TTS_CAUSE ${detail}`)
      throw new Error("voice-failed")
    }
    const filePath = path.join(
      outputDir,
      `voice-${String(index + 1).padStart(2, "0")}.wav`
    )
    await audio.save(filePath)
    const duration = audio.audio.length / audio.sampling_rate
    clips.push({
      id: scene.id,
      filePath,
      duration,
      words: wordTimings(scene.text, duration),
    })
  }
  return clips
}

function loadModel() {
  modelPromise ??= KokoroTTS.from_pretrained(modelId, {
    dtype: "q8",
    device: "cpu",
  })
  return modelPromise
}
