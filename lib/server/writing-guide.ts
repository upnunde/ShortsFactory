import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { normalizeWritingGuide, type WritingGuide } from "@/lib/writing-guide"
import { channelConfigPath } from "@/lib/server/channel-path"

export async function readWritingGuide(profileId = "default") {
  const guidePath = channelConfigPath(profileId, "writing.json", "writing.json")
  try {
    return normalizeWritingGuide(JSON.parse(await readFile(guidePath, "utf8")))
  } catch {
    return normalizeWritingGuide(null)
  }
}

export async function saveWritingGuide(value: unknown, profileId = "default") {
  const guidePath = channelConfigPath(profileId, "writing.json", "writing.json")
  const guide: WritingGuide = normalizeWritingGuide(value)
  await mkdir(path.dirname(guidePath), { recursive: true })
  await writeFile(guidePath, `${JSON.stringify(guide, null, 2)}\n`)
  return guide
}
