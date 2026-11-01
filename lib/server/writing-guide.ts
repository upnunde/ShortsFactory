import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { normalizeWritingGuide, type WritingGuide } from "@/lib/writing-guide"

const guidePath = path.join(process.cwd(), "config", "writing.json")

export async function readWritingGuide() {
  try {
    return normalizeWritingGuide(JSON.parse(await readFile(guidePath, "utf8")))
  } catch {
    return normalizeWritingGuide(null)
  }
}

export async function saveWritingGuide(value: unknown) {
  const guide: WritingGuide = normalizeWritingGuide(value)
  await mkdir(path.dirname(guidePath), { recursive: true })
  await writeFile(guidePath, `${JSON.stringify(guide, null, 2)}\n`)
  return guide
}
