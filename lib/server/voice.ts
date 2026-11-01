import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { DEFAULT_VOICE_ID, voiceById } from "@/lib/voices"

const voicePath = path.join(process.cwd(), "config", "voice.json")

export async function readVoiceId() {
  try {
    const body = JSON.parse(await readFile(voicePath, "utf8")) as {
      id?: unknown
    }
    return voiceById(typeof body.id === "string" ? body.id : "").id
  } catch {
    return DEFAULT_VOICE_ID
  }
}

export async function saveVoiceId(id: string) {
  const voiceId = voiceById(id).id
  await mkdir(path.dirname(voicePath), { recursive: true })
  await writeFile(voicePath, `${JSON.stringify({ id: voiceId }, null, 2)}\n`)
  return voiceId
}
