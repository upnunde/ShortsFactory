import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  isNewsHistoryId,
  newsHistoryActivityAt,
  resolveNewsHistoryCompletedAt,
  type NewsHistoryEntry,
  type NewsHistorySnapshot,
} from "@/lib/news-clips/history"
import { repairLegacyOverlappingTranscript } from "@/lib/news-clips/transcript"

const root = path.join(process.cwd(), "outputs", "news-clips", "history")
const indexPath = path.join(root, "index.json")
const publicOutputRoot = path.join(
  process.cwd(),
  "public",
  "news-clips",
  "output"
)

let chain: Promise<void> = Promise.resolve()

export async function listNewsHistory(profileId: string) {
  return enqueue(async () => {
    const index = await readIndex()
    const repaired = await backfillLegacyCompletionTimes(index)
    if (repaired.changed) await writeIndex(repaired.entries)
    return repaired.entries
      .filter((entry) => entry.profileId === profileId)
      .sort((a, b) =>
        newsHistoryActivityAt(b).localeCompare(newsHistoryActivityAt(a))
      )
  })
}

export async function saveNewsHistory(snapshot: NewsHistorySnapshot) {
  const id = snapshot.project.id
  if (!isNewsHistoryId(id)) return false
  return enqueue(async () => {
    const savedAt = new Date().toISOString()
    const index = await readIndex()
    const existing = index.find((item) => item.id === id)
    const legacyCompletedAt =
      existing?.finalized && !existing.completedAt
        ? await legacyCompletionTime(id, existing.updatedAt)
        : existing?.completedAt
    const finalRenderedAt = snapshot.finalized
      ? await finalRenderCompletionTime(id)
      : undefined
    const completedAt = resolveNewsHistoryCompletedAt({
      finalized: snapshot.finalized,
      requested: mostRecentDate(snapshot.completedAt, finalRenderedAt),
      existing: legacyCompletedAt,
      fallback: savedAt,
    })
    const stored: NewsHistorySnapshot = { ...snapshot, completedAt, savedAt }
    const entry: NewsHistoryEntry = {
      id,
      profileId: snapshot.project.profileId,
      title:
        snapshot.project.title.replace(/\s*\n\s*/g, " ").trim() ||
        snapshot.project.selectedIssue?.title ||
        snapshot.project.source?.title ||
        "제목 없음",
      issueTitle: snapshot.project.selectedIssue?.title ?? "",
      step: snapshot.step,
      updatedAt: savedAt,
      finalized: snapshot.finalized,
      completedAt,
      hasPreview: Boolean(snapshot.project.previewUrl),
      hasFinal: Boolean(snapshot.project.outputUrl),
      durationSeconds: snapshot.project.outputDurationSeconds,
    }
    const folder = path.join(root, id)
    await mkdir(folder, { recursive: true })
    await writeFile(
      path.join(folder, "project.json"),
      `${JSON.stringify(stored, null, 2)}\n`
    )
    await writeIndex([entry, ...index.filter((item) => item.id !== id)])
    return true
  })
}

export async function readNewsHistory(id: string, profileId: string) {
  if (!isNewsHistoryId(id)) return null
  return enqueue(async () => {
    try {
      const snapshot = JSON.parse(
        await readFile(path.join(root, id, "project.json"), "utf8")
      ) as NewsHistorySnapshot
      if (snapshot.project.profileId !== profileId) return null
      if (snapshot.finalized) {
        const entry = (await readIndex()).find((item) => item.id === id)
        snapshot.completedAt = resolveNewsHistoryCompletedAt({
          finalized: true,
          requested: mostRecentDate(
            snapshot.completedAt,
            entry?.completedAt,
            await finalRenderCompletionTime(id)
          ),
          fallback: await legacyCompletionTime(id, snapshot.savedAt),
        })
      }
      return repairLegacyHistoryTranscript(snapshot)
    } catch {
      return null
    }
  })
}

async function repairLegacyHistoryTranscript(snapshot: NewsHistorySnapshot) {
  const sourceId = snapshot.project.source?.id ?? ""
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(sourceId)) return snapshot

  const sourceFolder = path.join(
    process.cwd(),
    "outputs",
    "news-clips",
    sourceId
  )
  let timedText = ""
  for (const filename of ["source.ko.srt", "transcript.srt"]) {
    try {
      timedText = await readFile(path.join(sourceFolder, filename), "utf8")
      if (timedText.trim()) break
    } catch {
      // 다음 전사 파일을 확인한다.
    }
  }
  if (!timedText.trim()) return snapshot

  const transcript = repairLegacyOverlappingTranscript(
    snapshot.project.transcript,
    timedText
  )
  if (transcript === snapshot.project.transcript) return snapshot

  return {
    ...snapshot,
    project: {
      ...snapshot.project,
      transcript,
      subtitles: [],
      subtitleTimingsLocked: false,
      previewUrl: "",
      previewIntroUrl: "",
      previewLeadUrl: "",
      previewBodyUrl: "",
      previewOutroUrl: "",
      previewSignature: "",
      outputUrl: "",
      thumbnailUrl: "",
      renderSignature: "",
      youtubeVideoId: "",
      youtubeUploadUrl: "",
    },
  }
}

export async function deleteNewsHistory(id: string, profileId: string) {
  if (!isNewsHistoryId(id)) return false
  return enqueue(async () => {
    const index = await readIndex()
    if (
      !index.some((entry) => entry.id === id && entry.profileId === profileId)
    )
      return false
    await writeIndex(index.filter((entry) => entry.id !== id))
    await rm(path.join(root, id), { recursive: true, force: true })
    await rm(path.join(publicOutputRoot, id), { recursive: true, force: true })
    return true
  })
}

async function readIndex(): Promise<NewsHistoryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as unknown
    return Array.isArray(parsed)
      ? parsed.filter(validEntry).map((entry) => entry as NewsHistoryEntry)
      : []
  } catch {
    return []
  }
}

async function backfillLegacyCompletionTimes(entries: NewsHistoryEntry[]) {
  let changed = false
  const repaired = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.finalized) return entry
      const completedAt = resolveNewsHistoryCompletedAt({
        finalized: true,
        requested: await finalRenderCompletionTime(entry.id),
        existing: entry.completedAt,
        fallback: await legacyCompletionTime(entry.id, entry.updatedAt),
      })
      if (completedAt === entry.completedAt) return entry
      changed = true
      return {
        ...entry,
        completedAt,
      }
    })
  )
  return { entries: repaired, changed }
}

async function legacyCompletionTime(id: string, fallback: string) {
  try {
    const file = await stat(path.join(root, id, "project.json"))
    if (file.birthtimeMs > 0 && !Number.isNaN(file.birthtime.getTime())) {
      return file.birthtime.toISOString()
    }
  } catch {
    // 이전 저장 파일이 없으면 인덱스의 마지막 시각을 사용한다.
  }
  return fallback
}

async function finalRenderCompletionTime(id: string) {
  try {
    const file = await stat(path.join(publicOutputRoot, id, "final.mp4"))
    if (file.mtimeMs > 0 && !Number.isNaN(file.mtime.getTime())) {
      return file.mtime.toISOString()
    }
  } catch {
    // 최종 영상이 없는 진행 중 작업은 저장 시각을 사용한다.
  }
  return undefined
}

function mostRecentDate(...values: Array<string | undefined>) {
  return values
    .filter(
      (value): value is string =>
        typeof value === "string" && !Number.isNaN(new Date(value).getTime())
    )
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
}

function validEntry(value: unknown) {
  if (!value || typeof value !== "object") return false
  const entry = value as Partial<NewsHistoryEntry>
  return (
    typeof entry.id === "string" &&
    isNewsHistoryId(entry.id) &&
    typeof entry.profileId === "string" &&
    typeof entry.title === "string" &&
    typeof entry.updatedAt === "string"
  )
}

async function writeIndex(index: NewsHistoryEntry[]) {
  await mkdir(root, { recursive: true })
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
}

function enqueue<T>(job: () => Promise<T>) {
  const run = chain.then(job, job)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
