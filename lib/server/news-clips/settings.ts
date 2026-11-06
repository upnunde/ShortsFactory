import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import { normalizeNewsClipSettings } from "@/lib/news-clips/settings"
import { defaultNewsClipSettings } from "@/lib/news-clips/types"
import { newsChannelId } from "@/lib/server/news-clips/channels"

export async function readNewsClipSettings(profileId: string) {
  const id = requiredNewsChannelId(profileId)
  const saved = await readSettingsFile(settingsPath(id))
  if (saved) return normalizeNewsClipSettings(saved, id)
  const backup = await readSettingsFile(settingsBackupPath(id))
  if (backup) return normalizeNewsClipSettings(backup, id)
  return normalizeNewsClipSettings(defaultNewsClipSettings, id)
}

export async function saveNewsClipSettings(value: unknown, profileId: string) {
  const id = requiredNewsChannelId(profileId)
  const current = await readNewsClipSettings(id)
  const next = normalizeNewsClipSettings(
    value && typeof value === "object" ? { ...current, ...value } : current,
    id
  )
  const target = settingsPath(id)
  await mkdir(path.dirname(target), { recursive: true })
  const saved = await readSettingsFile(target)
  if (saved) {
    await atomicWrite(
      settingsBackupPath(id),
      `${JSON.stringify(normalizeNewsClipSettings(saved, id), null, 2)}\n`
    )
  }
  await atomicWrite(target, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export async function saveNewsClipAsset(
  profileId: string,
  kind: "titleFrame" | "bodyFrame" | "bgm",
  file: File
) {
  const id = requiredNewsChannelId(profileId)
  const extension = safeExtension(file.name, kind)
  if (!extension || file.size === 0 || file.size > maxBytes(kind)) {
    throw new Error("unsupported")
  }
  const directory = path.join(process.cwd(), "public", "news-clips", id)
  await mkdir(directory, { recursive: true })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const fingerprint = createHash("sha256")
    .update(bytes)
    .digest("hex")
    .slice(0, 12)
  const filename = `${kind}-${fingerprint}${extension}`
  await writeFile(path.join(directory, filename), bytes)
  const publicPath = `/news-clips/${id}/${filename}`
  const current = await readNewsClipSettings(id)
  const patch =
    kind === "titleFrame"
      ? { titleFrameImage: publicPath }
      : kind === "bodyFrame"
        ? { bodyFrameImage: publicPath }
        : { bgmFile: publicPath }
  return saveNewsClipSettings({ ...current, ...patch }, id)
}

function settingsPath(profileId: string) {
  return path.join(
    process.cwd(),
    "config",
    "news-channels",
    profileId,
    "settings.json"
  )
}

function settingsBackupPath(profileId: string) {
  return path.join(
    process.cwd(),
    "config",
    "news-channels",
    profileId,
    "settings.backup.json"
  )
}

async function readSettingsFile(file: string) {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown
    return value && typeof value === "object" ? value : null
  } catch {
    return null
  }
}

async function atomicWrite(target: string, value: string) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, value)
  await rename(temporary, target)
}

function requiredNewsChannelId(value: string) {
  const id = newsChannelId(value)
  if (!id) throw new Error("invalid-news-channel")
  return id
}

function maxBytes(kind: string) {
  return kind === "bgm" ? 30 * 1024 * 1024 : 12 * 1024 * 1024
}

function safeExtension(filename: string, kind: string) {
  const extension = path.extname(filename).toLowerCase()
  const allowed =
    kind === "bgm"
      ? new Set([".mp3", ".wav", ".m4a", ".aac"])
      : new Set([".png", ".jpg", ".jpeg", ".webp"])
  return allowed.has(extension) ? extension : ""
}
