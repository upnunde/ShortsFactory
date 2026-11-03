import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  normalizeVideoSettings,
  type VideoSettings,
} from "@/lib/video-settings"
import { channelConfigPath } from "@/lib/server/channel-path"

export async function readVideoSettings(profileId = "default") {
  const settingsPath = channelConfigPath(profileId, "video.json", "video.json")
  try {
    return normalizeVideoSettings(
      JSON.parse(await readFile(settingsPath, "utf8"))
    )
  } catch {
    return normalizeVideoSettings(null)
  }
}

export async function saveVideoSettings(value: unknown, profileId = "default") {
  const settingsPath = channelConfigPath(profileId, "video.json", "video.json")
  const settings: VideoSettings = normalizeVideoSettings(value)
  await mkdir(path.dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  return settings
}
