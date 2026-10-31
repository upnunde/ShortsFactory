import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { normalizeFrameLayout, type FrameLayout } from "@/lib/frame-layout"

const layoutPath = path.join(process.cwd(), "config", "layout.json")

export async function readFrameLayout() {
  try {
    return normalizeFrameLayout(JSON.parse(await readFile(layoutPath, "utf8")))
  } catch {
    return normalizeFrameLayout(null)
  }
}

export async function saveFrameLayout(value: unknown) {
  const layout: FrameLayout = normalizeFrameLayout(value)
  await mkdir(path.dirname(layoutPath), { recursive: true })
  await writeFile(layoutPath, `${JSON.stringify(layout, null, 2)}\n`)
  return layout
}
