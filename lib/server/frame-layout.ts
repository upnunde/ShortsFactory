import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { normalizeFrameLayout, type FrameLayout } from "@/lib/frame-layout"
import { channelConfigPath } from "@/lib/server/channel-path"

export async function readFrameLayout(profileId = "default") {
  const layoutPath = channelConfigPath(profileId, "layout.json", "layout.json")
  try {
    return normalizeFrameLayout(JSON.parse(await readFile(layoutPath, "utf8")))
  } catch {
    return normalizeFrameLayout(null)
  }
}

export async function saveFrameLayout(value: unknown, profileId = "default") {
  const layoutPath = channelConfigPath(profileId, "layout.json", "layout.json")
  const layout: FrameLayout = normalizeFrameLayout(value)
  await mkdir(path.dirname(layoutPath), { recursive: true })
  await writeFile(layoutPath, `${JSON.stringify(layout, null, 2)}\n`)
  return layout
}
