import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import type { NewsChannelProfile } from "@/lib/news-clips/types"
import { readChannelAccountStatus } from "../accounts.ts"

const root = path.join(process.cwd(), "config", "news-channels")
const archiveRoot = path.join(process.cwd(), "config", "news-channels-archive")

export async function listNewsChannels() {
  let directories: string[] = []
  try {
    directories = await readdir(root)
  } catch {
    return []
  }
  const loaded = await Promise.all(
    directories
      .filter((id) => /^news-channel-[a-z0-9-]+$/.test(id))
      .map(async (id) => {
        try {
          return normalizeNewsChannelProfile(
            JSON.parse(
              await readFile(path.join(root, id, "profile.json"), "utf8")
            )
          )
        } catch {
          return null
        }
      })
  )
  const profiles = loaded.filter(
    (item): item is NewsChannelProfile => item !== null
  )
  const connectedProfiles = await Promise.all(
    profiles.map(async (profile) => {
      const youtube = (await readChannelAccountStatus(profile.id)).youtube
      return youtube.connected && youtube.avatarUrl
        ? { ...profile, avatarUrl: youtube.avatarUrl }
        : profile
    })
  )
  return connectedProfiles.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )
}

export async function readNewsChannel(id: string) {
  const safe = newsChannelId(id)
  if (!safe) return null
  try {
    return normalizeNewsChannelProfile(
      JSON.parse(await readFile(path.join(root, safe, "profile.json"), "utf8"))
    )
  } catch {
    return null
  }
}

export async function createNewsChannel(name: string) {
  const id = `news-channel-${randomUUID().slice(0, 8)}`
  const profile: NewsChannelProfile = {
    id,
    name: name.trim() || "새 뉴스 채널",
    language: "ko",
    avatarUrl: "",
    youtubeChannelId: "",
    youtubeChannelCredentials: `config/credentials/${id}.json`,
    createdAt: new Date().toISOString(),
  }
  await writeNewsChannel(profile)
  return profile
}

export async function updateNewsChannel(id: string, name: string) {
  const safe = newsChannelId(id)
  if (!safe) return null
  const channels = await listNewsChannels()
  const current = channels.find((item) => item.id === safe)
  if (!current) return null
  const next = { ...current, name: name.trim() || current.name }
  await writeNewsChannel(next)
  return next
}

export async function archiveNewsChannel(id: string) {
  const safe = newsChannelId(id)
  if (!safe) return false
  const channels = await listNewsChannels()
  if (!channels.some((item) => item.id === safe)) return false
  await mkdir(archiveRoot, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  await rename(
    path.join(root, safe),
    path.join(archiveRoot, `${safe}-${timestamp}`)
  )
  return true
}

export function normalizeNewsChannelProfile(
  value: unknown
): NewsChannelProfile | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<NewsChannelProfile>
  const id = newsChannelId(raw.id)
  if (!id) return null
  return {
    id,
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : "뉴스 채널",
    language:
      typeof raw.language === "string" && raw.language.trim()
        ? raw.language.trim()
        : "ko",
    avatarUrl:
      typeof raw.avatarUrl === "string" && raw.avatarUrl.trim()
        ? raw.avatarUrl.trim()
        : "",
    youtubeChannelId:
      typeof raw.youtubeChannelId === "string" &&
      /^UC[a-zA-Z0-9_-]{20,30}$/.test(raw.youtubeChannelId.trim())
        ? raw.youtubeChannelId.trim()
        : "",
    youtubeChannelCredentials:
      typeof raw.youtubeChannelCredentials === "string" &&
      raw.youtubeChannelCredentials.trim()
        ? raw.youtubeChannelCredentials.trim()
        : `config/credentials/${id}.json`,
    createdAt:
      typeof raw.createdAt === "string" && raw.createdAt
        ? raw.createdAt
        : new Date(0).toISOString(),
  }
}

export function newsChannelId(value: unknown) {
  return typeof value === "string" &&
    /^news-channel-[a-z0-9-]{1,48}$/.test(value)
    ? value
    : ""
}

async function writeNewsChannel(profile: NewsChannelProfile) {
  const directory = path.join(root, profile.id)
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, "profile.json"),
    `${JSON.stringify(profile, null, 2)}\n`
  )
}
