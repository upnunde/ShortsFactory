import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { isHistoryId, type HistoryEntry } from "@/lib/history"
import { filmSignature } from "@/lib/scene-status"
import { STEPS, type StepId, type StudioState } from "@/lib/types"

const historyDir = path.join(process.cwd(), "outputs", "history")
const indexPath = path.join(historyDir, "index.json")

type HistoryIndex = HistoryEntry[]

let chain: Promise<void> = Promise.resolve()

export async function listHistory() {
  const index = await readIndex()
  return [...index].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function readHistory(id: string) {
  if (!isHistoryId(id)) {
    return null
  }
  return enqueue(async () => {
    const index = await readIndex()
    const entry = index.find((item) => item.id === id) ?? null
    try {
      const studio = JSON.parse(
        await readFile(projectPath(id), "utf8")
      ) as StudioState
      return { studio, entry }
    } catch {
      return null
    }
  })
}

export function historyVideoPath(id: string) {
  if (!isHistoryId(id)) {
    return null
  }
  return path.join(historyDir, id, "final.mp4")
}

export function historyCaptionPath(id: string) {
  if (!isHistoryId(id)) {
    return null
  }
  return path.join(historyDir, id, "captions.srt")
}

export async function saveHistory(studio: StudioState) {
  const id = studio.project.historyId
  if (!isHistoryId(id)) {
    return { ok: false as const, frozen: false }
  }
  return enqueue(async () => {
    const index = await readIndex()
    const existing = index.find((item) => item.id === id)
    const signature = filmSignature(studio.project)
    if (
      existing?.hasVideo &&
      existing.signature &&
      existing.signature !== signature
    ) {
      return { ok: true as const, frozen: true }
    }
    await mkdir(path.join(historyDir, id), { recursive: true })
    await writeFile(projectPath(id), JSON.stringify(studio))
    const next: HistoryEntry = {
      id,
      topic: studio.project.topic.trim() || "제목 없음",
      step: studio.step,
      updatedAt: new Date().toISOString(),
      hasVideo: existing?.hasVideo ?? false,
      signature: existing?.hasVideo ? existing.signature : "",
    }
    await writeIndex(upsert(index, next))
    return { ok: true as const, frozen: false }
  })
}

export async function attachHistoryVideo(
  id: string,
  sourcePath: string,
  signature: string,
  captionsPath?: string
) {
  if (!isHistoryId(id)) {
    return
  }
  await enqueue(async () => {
    const folder = path.join(historyDir, id)
    await mkdir(folder, { recursive: true })
    await copyFile(sourcePath, path.join(folder, "final.mp4"))
    if (captionsPath) {
      await copyFile(captionsPath, path.join(folder, "captions.srt"))
    }
    const index = await readIndex()
    const existing = index.find((item) => item.id === id)
    const next: HistoryEntry = {
      id,
      topic: existing?.topic || "제목 없음",
      step: existing?.step || "film",
      updatedAt: new Date().toISOString(),
      hasVideo: true,
      signature,
    }
    await writeIndex(upsert(index, next))
  })
}

function projectPath(id: string) {
  return path.join(historyDir, id, "project.json")
}

function upsert(index: HistoryIndex, entry: HistoryEntry) {
  const rest = index.filter((item) => item.id !== entry.id)
  return [entry, ...rest]
}

async function readIndex(): Promise<HistoryIndex> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap(entryOf)
  } catch {
    return []
  }
}

async function writeIndex(index: HistoryIndex) {
  await mkdir(historyDir, { recursive: true })
  await writeFile(indexPath, JSON.stringify(index))
}

function entryOf(value: unknown): HistoryEntry[] {
  if (!value || typeof value !== "object") {
    return []
  }
  const entry = value as Partial<HistoryEntry>
  if (typeof entry.id !== "string" || !isHistoryId(entry.id)) {
    return []
  }
  const step = STEPS.some((item) => item.id === entry.step)
    ? (entry.step as StepId)
    : "script"
  return [
    {
      id: entry.id,
      topic:
        typeof entry.topic === "string" && entry.topic.trim()
          ? entry.topic
          : "제목 없음",
      step,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      hasVideo: entry.hasVideo === true,
      signature: typeof entry.signature === "string" ? entry.signature : "",
    },
  ]
}

function enqueue<T>(job: () => Promise<T>) {
  const run = chain.then(job, job)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
