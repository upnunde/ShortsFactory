import { randomUUID } from "node:crypto"
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

import defaultProfile from "@/config/profiles/default.json"
import { readFrameLayout, saveFrameLayout } from "@/lib/server/frame-layout"
import {
  readVideoSettings,
  saveVideoSettings,
} from "@/lib/server/video-settings"
import { readVoiceId, saveVoiceId } from "@/lib/server/voice"
import { readWritingGuide, saveWritingGuide } from "@/lib/server/writing-guide"
import type { ChannelProfile } from "@/lib/types"

const profilesDir = path.join(process.cwd(), "config", "profiles")

export async function listProfiles() {
  let files: string[] = []
  try {
    files = await readdir(profilesDir)
  } catch {
    files = []
  }
  const loaded = await Promise.all(
    files
      .filter((file) => /^[a-z0-9-]+\.json$/.test(file))
      .map(async (file) => {
        try {
          return profileOf(
            JSON.parse(await readFile(path.join(profilesDir, file), "utf8"))
          )
        } catch {
          return null
        }
      })
  )
  const profiles = loaded.filter(
    (profile): profile is ChannelProfile => profile !== null
  )
  return profiles.length > 0 ? profiles : [profileOf(defaultProfile)]
}

export async function readProfile(profileId: string) {
  const profiles = await listProfiles()
  return (
    profiles.find((profile) => profile.id === safeId(profileId)) ?? profiles[0]
  )
}

export async function createProfile(name: string) {
  const source = await readProfile("default")
  const id = `channel-${randomUUID().slice(0, 8)}`
  const profile = profileOf({
    ...source,
    id,
    name: name.trim() || "새 채널",
    youtube_channel_credentials: `config/credentials/${id}.json`,
    instagram_credentials: `config/credentials/${id}-instagram.json`,
    tiktok_credentials: `config/credentials/${id}-tiktok.json`,
  })
  await writeProfile(profile)
  const [frame, video, voiceId, writing] = await Promise.all([
    readFrameLayout(source.id),
    readVideoSettings(source.id),
    readVoiceId(source.id),
    readWritingGuide(source.id),
  ])
  await Promise.all([
    saveFrameLayout(frame, id),
    saveVideoSettings(video, id),
    saveVoiceId(voiceId, id),
    saveWritingGuide(writing, id),
    cloneCharacterAssets(source.id, id),
  ])
  return profile
}

async function cloneCharacterAssets(sourceId: string, targetId: string) {
  const root = path.join(process.cwd(), "assets", "characters")
  try {
    await cp(path.join(root, sourceId), path.join(root, targetId), {
      recursive: true,
      errorOnExist: false,
    })
  } catch {
    await mkdir(path.join(root, targetId), { recursive: true })
  }
}

export async function updateProfile(
  profileId: string,
  patch: Partial<
    Pick<
      ChannelProfile,
      | "name"
      | "system_prompt"
      | "image_style_anchor"
      | "youtube_bgm_volume"
      | "default_bgm_id"
    >
  >
) {
  const current = await readProfile(profileId)
  if (current.id !== safeId(profileId)) {
    return current
  }
  const profile = profileOf({
    ...current,
    name: typeof patch.name === "string" ? patch.name : current.name,
    system_prompt:
      typeof patch.system_prompt === "string"
        ? patch.system_prompt
        : current.system_prompt,
    image_style_anchor:
      typeof patch.image_style_anchor === "string"
        ? patch.image_style_anchor
        : current.image_style_anchor,
    default_bgm_id:
      typeof patch.default_bgm_id === "string"
        ? patch.default_bgm_id
        : current.default_bgm_id,
    youtube_bgm_volume:
      typeof patch.youtube_bgm_volume === "number"
        ? patch.youtube_bgm_volume
        : current.youtube_bgm_volume,
  })
  await writeProfile(profile)
  return profile
}

async function writeProfile(profile: ChannelProfile) {
  await mkdir(profilesDir, { recursive: true })
  await writeFile(
    path.join(profilesDir, `${profile.id}.json`),
    `${JSON.stringify(profile, null, 2)}\n`
  )
}

function profileOf(value: unknown): ChannelProfile {
  const fallback = defaultProfile as ChannelProfile
  const record = value && typeof value === "object" ? value : {}
  const raw = record as Partial<ChannelProfile>
  const id = safeId(raw.id) || fallback.id
  return {
    id,
    name: textOf(raw.name, fallback.name),
    language: textOf(raw.language, fallback.language),
    system_prompt: textOf(raw.system_prompt, fallback.system_prompt),
    image_style_anchor: textOf(
      raw.image_style_anchor,
      fallback.image_style_anchor
    ),
    lora_model: textOf(raw.lora_model, fallback.lora_model),
    tts_voice_id: textOf(raw.tts_voice_id, fallback.tts_voice_id),
    bgm_folder_path: textOf(raw.bgm_folder_path, fallback.bgm_folder_path),
    default_bgm_id: textOf(
      raw.default_bgm_id,
      fallback.default_bgm_id || "stella-waltz"
    ),
    youtube_bgm_track: textOf(
      raw.youtube_bgm_track,
      fallback.youtube_bgm_track
    ),
    youtube_bgm_artist: textOf(
      raw.youtube_bgm_artist,
      fallback.youtube_bgm_artist
    ),
    youtube_bgm_volume: numberOf(
      raw.youtube_bgm_volume,
      fallback.youtube_bgm_volume
    ),
    youtube_channel_credentials: textOf(
      raw.youtube_channel_credentials,
      fallback.youtube_channel_credentials
    ),
    instagram_credentials: textOf(
      raw.instagram_credentials,
      fallback.instagram_credentials
    ),
    tiktok_credentials: textOf(
      raw.tiktok_credentials,
      fallback.tiktok_credentials
    ),
  }
}

function safeId(value: unknown) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value)
    ? value
    : ""
}

function textOf(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function numberOf(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}
