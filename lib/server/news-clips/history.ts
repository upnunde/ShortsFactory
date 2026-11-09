import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  isNewsHistoryId,
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
  const index = await readIndex()
  return index
    .filter((entry) => entry.profileId === profileId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function saveNewsHistory(snapshot: NewsHistorySnapshot) {
  const id = snapshot.project.id
  if (!isNewsHistoryId(id)) return false
  return enqueue(async () => {
    const savedAt = new Date().toISOString()
    const stored: NewsHistorySnapshot = { ...snapshot, savedAt }
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
    const index = await readIndex()
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
