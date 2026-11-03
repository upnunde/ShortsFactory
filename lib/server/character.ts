import { randomUUID } from "node:crypto"
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  CHARACTER_ANGLES,
  type CharacterAngleKey,
} from "@/lib/character-angles"
import { readHiggsfield } from "@/lib/server/credentials"

const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"])

function imageDir(profileId: string) {
  const id = /^[a-z0-9-]{1,64}$/.test(profileId) ? profileId : "default"
  return path.join(process.cwd(), "assets", "characters", id)
}

function metaPath(profileId: string) {
  return path.join(imageDir(profileId), "meta.json")
}

export type CharacterFile = {
  id: string
  url: string
}

export type CharacterAngleSlot = {
  key: CharacterAngleKey
  label: string
  image: CharacterFile | null
}

export type CharacterOutfit = {
  id: string
  name: string
  active: boolean
  front: CharacterFile | null
  angles: CharacterAngleSlot[]
}

export type CharacterLibrary = {
  outfits: CharacterOutfit[]
  hostId: string
  canGenerate: boolean
  activeReferences: CharacterFile[]
}

type OutfitRecord = {
  id: string
  name: string
  active: boolean
  front: string | null
  angles: Record<CharacterAngleKey, string | null>
}

type Meta = {
  outfits: OutfitRecord[]
}

export async function getCharacterLibrary(
  profileId = "default"
): Promise<CharacterLibrary> {
  await ensureChannelAssets(profileId)
  const meta = await readMeta(profileId)
  const outfits = await Promise.all(
    meta.outfits.map((outfit) => toOutfit(outfit, profileId))
  )
  const host = outfits[0]
  return {
    outfits,
    hostId: host?.id ?? "",
    canGenerate: await canGenerateCharacterAngles(),
    activeReferences: host ? outfitReferences(host) : [],
  }
}

async function ensureChannelAssets(profileId: string) {
  if (profileId === "default") return
  try {
    await access(metaPath(profileId))
  } catch {
    try {
      await cp(imageDir("default"), imageDir(profileId), { recursive: true })
    } catch {
      await mkdir(imageDir(profileId), { recursive: true })
    }
  }
}

export async function addOutfit(profileId = "default") {
  const meta = await readMeta(profileId)
  meta.outfits.push({
    id: randomUUID(),
    name:
      meta.outfits.length === 0 ? "진행자" : `인물 ${meta.outfits.length + 1}`,
    active: true,
    front: null,
    angles: emptyAngles(),
  })
  await writeMeta(meta, profileId)
  return getCharacterLibrary(profileId)
}

export async function deleteOutfit(id: string, profileId = "default") {
  const meta = await readMeta(profileId)
  const outfit = meta.outfits.find((item) => item.id === id)
  if (!outfit || meta.outfits[0]?.id === id) {
    return getCharacterLibrary(profileId)
  }
  await removeStoredFiles(outfit, profileId)
  meta.outfits = ensureHost(meta.outfits.filter((item) => item.id !== id))
  await writeMeta(meta, profileId)
  return getCharacterLibrary(profileId)
}

export async function updateOutfit(
  id: string,
  patch: { name?: string; active?: boolean },
  profileId = "default"
) {
  const meta = await readMeta(profileId)
  const hostId = meta.outfits[0]?.id
  meta.outfits = meta.outfits.map((outfit) => {
    if (outfit.id !== id) {
      return outfit
    }
    const name = patch.name?.trim()
    const active = outfit.id === hostId ? true : (patch.active ?? outfit.active)
    return {
      ...outfit,
      name: name ? name : outfit.name,
      active,
    }
  })
  meta.outfits = ensureHost(meta.outfits)
  await writeMeta(meta, profileId)
  return getCharacterLibrary(profileId)
}

export async function saveFrontImage(
  outfitId: string,
  file: { name: string; bytes: Uint8Array },
  profileId = "default"
) {
  const ext = path.extname(file.name).toLowerCase()
  if (!allowed.has(ext)) {
    throw new Error("unsupported")
  }
  const directory = imageDir(profileId)
  await mkdir(directory, { recursive: true })
  const meta = await readMeta(profileId)
  const outfit = meta.outfits.find((item) => item.id === outfitId)
  if (!outfit || outfit.front) {
    throw new Error("missing")
  }
  const id = `${randomUUID()}${ext}`
  await writeFile(path.join(directory, id), file.bytes)
  outfit.front = id
  outfit.angles = emptyAngles()
  await writeMeta(meta, profileId)
  return getCharacterLibrary(profileId)
}

export async function saveOutfitAngles(
  outfitId: string,
  files: { key: CharacterAngleKey; bytes: Uint8Array; ext: string }[],
  profileId = "default"
) {
  const directory = imageDir(profileId)
  await mkdir(directory, { recursive: true })
  const meta = await readMeta(profileId)
  const outfit = meta.outfits.find((item) => item.id === outfitId)
  if (!outfit) {
    throw new Error("missing")
  }
  for (const file of files) {
    const previous = outfit.angles[file.key]
    if (previous) {
      await rm(path.join(directory, previous), { force: true })
    }
    const ext = allowed.has(file.ext) ? file.ext : ".png"
    const id = `${randomUUID()}${ext}`
    await writeFile(path.join(directory, id), file.bytes)
    outfit.angles[file.key] = id
  }
  await writeMeta(meta, profileId)
  return getCharacterLibrary(profileId)
}

export async function outfitFrontPath(outfitId: string, profileId = "default") {
  const meta = await readMeta(profileId)
  const outfit = meta.outfits.find((item) => item.id === outfitId)
  if (!outfit?.front) {
    return null
  }
  const name = safeName(outfit.front)
  if (!name) {
    return null
  }
  return path.join(imageDir(profileId), name)
}

export async function readCharacterImage(id: string, profileId = "default") {
  const name = safeName(id)
  if (!name) {
    return null
  }
  try {
    const bytes = await readFile(path.join(imageDir(profileId), name))
    return { bytes, type: contentType(name) }
  } catch {
    return null
  }
}

export async function removeCharacterImage(id: string, profileId = "default") {
  const name = safeName(id)
  if (!name) {
    return
  }
  const meta = await readMeta(profileId)
  for (const outfit of meta.outfits) {
    if (outfit.front === name) {
      outfit.front = null
    }
    for (const angle of CHARACTER_ANGLES) {
      if (outfit.angles[angle.key] === name) {
        outfit.angles[angle.key] = null
      }
    }
  }
  await rm(path.join(imageDir(profileId), name), { force: true })
  await writeMeta(meta, profileId)
}

export async function canGenerateCharacterAngles() {
  return (await readHiggsfield()) !== null
}

function outfitReferences(outfit: CharacterOutfit) {
  return [outfit.front, ...outfit.angles.map((angle) => angle.image)].filter(
    (file): file is CharacterFile => file !== null
  )
}

async function toOutfit(
  record: OutfitRecord,
  profileId: string
): Promise<CharacterOutfit> {
  return {
    id: record.id,
    name: record.name,
    active: record.active,
    front: await fileOf(record.front, profileId),
    angles: await Promise.all(
      CHARACTER_ANGLES.map(async (angle) => ({
        key: angle.key,
        label: angle.label,
        image: await fileOf(record.angles[angle.key], profileId),
      }))
    ),
  }
}

async function fileOf(
  id: string | null,
  profileId: string
): Promise<CharacterFile | null> {
  if (!id || !(await readCharacterImage(id, profileId))) {
    return null
  }
  return {
    id,
    url: `/api/character/file/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`,
  }
}

async function readMeta(profileId: string): Promise<Meta> {
  try {
    const parsed = JSON.parse(await readFile(metaPath(profileId), "utf8")) as {
      front?: unknown
      angles?: Partial<Record<CharacterAngleKey, unknown>>
      outfits?: Partial<OutfitRecord>[]
    }
    if (Array.isArray(parsed.outfits)) {
      return {
        outfits: ensureHost(
          parsed.outfits.map((outfit, index) => normalizeOutfit(outfit, index))
        ),
      }
    }
    return {
      outfits: [
        normalizeOutfit(
          {
            id: "default",
            name: "기본",
            active: true,
            front: typeof parsed.front === "string" ? parsed.front : null,
            angles: anglesFrom(parsed.angles),
          },
          0
        ),
      ],
    }
  } catch {
    return {
      outfits: [
        normalizeOutfit(
          {
            id: "default",
            name: "기본",
            active: true,
            front: null,
            angles: emptyAngles(),
          },
          0
        ),
      ],
    }
  }
}

async function writeMeta(meta: Meta, profileId: string) {
  await mkdir(imageDir(profileId), { recursive: true })
  await writeFile(metaPath(profileId), JSON.stringify(meta, null, 2))
}

async function removeStoredFiles(outfit: OutfitRecord, profileId: string) {
  const names = [
    outfit.front,
    ...CHARACTER_ANGLES.map((angle) => outfit.angles[angle.key]),
  ].filter((name): name is string => Boolean(name))
  await Promise.all(
    names.map((name) =>
      rm(path.join(imageDir(profileId), name), { force: true })
    )
  )
}

function ensureHost(outfits: OutfitRecord[]) {
  if (outfits.length === 0) {
    return outfits
  }
  return outfits.map((outfit, index) =>
    index === 0 ? { ...outfit, active: true } : outfit
  )
}

function normalizeOutfit(
  raw: Partial<OutfitRecord> | undefined,
  index: number
): OutfitRecord {
  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : randomUUID(),
    name:
      typeof raw?.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : index === 0
          ? "진행자"
          : `인물 ${index + 1}`,
    active: raw?.active === true,
    front: typeof raw?.front === "string" ? raw.front : null,
    angles: anglesFrom(raw?.angles),
  }
}

function anglesFrom(
  raw: Partial<Record<CharacterAngleKey, unknown>> | undefined
) {
  const angles = emptyAngles()
  for (const angle of CHARACTER_ANGLES) {
    const value = raw?.[angle.key]
    angles[angle.key] = typeof value === "string" ? value : null
  }
  return angles
}

function emptyAngles(): Record<CharacterAngleKey, string | null> {
  return Object.fromEntries(
    CHARACTER_ANGLES.map((angle) => [angle.key, null])
  ) as Record<CharacterAngleKey, string | null>
}

function safeName(id: string) {
  if (!/^[\w.-]+$/.test(id) || !allowed.has(path.extname(id).toLowerCase())) {
    return null
  }
  return id
}

function contentType(name: string) {
  const ext = path.extname(name).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".webp") return "image/webp"
  return "image/jpeg"
}
