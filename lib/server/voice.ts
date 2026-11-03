import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { channelConfigPath } from "@/lib/server/channel-path"
import { DEFAULT_VOICE_ID, voiceById } from "@/lib/voices"

export async function readVoiceId(profileId = "default") {
  const voicePath = channelConfigPath(profileId, "voice.json", "voice.json")
  try {
    const body = JSON.parse(await readFile(voicePath, "utf8")) as {
      id?: unknown
    }
    return voiceById(typeof body.id === "string" ? body.id : "").id
  } catch {
    return DEFAULT_VOICE_ID
  }
}

export async function saveVoiceId(id: string, profileId = "default") {
  const voicePath = channelConfigPath(profileId, "voice.json", "voice.json")
  const voiceId = voiceById(id).id
  await mkdir(path.dirname(voicePath), { recursive: true })
  await writeFile(voicePath, `${JSON.stringify({ id: voiceId }, null, 2)}\n`)
  return voiceId
}
