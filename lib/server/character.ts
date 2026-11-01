import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { CHARACTER_ANGLES, type CharacterAngleKey } from "@/lib/character-angles"
import { readHiggsfield } from "@/lib/server/credentials"

const imageDir = path.join(process.cwd(), "assets", "characters", "default")
const metaPath = path.join(imageDir, "meta.json")
const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"])

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

export async function getCharacterLibrary(): Promise<CharacterLibrary> {
  const meta = await readMeta()
  const outfits = await Promise.all(meta.outfits.map(toOutfit))
  const host = outfits[0]
  return {
    outfits,
    hostId: host?.id ?? "",
    canGenerate: await canGenerateCharacterAngles(),
    activeReferences: host ? outfitReferences(host) : [],
  }
}

export async function addOutfit() {
  const meta = await readMeta()
  meta.outfits.push({
    id: randomUUID(),
    name: meta.outfits.length === 0 ? "진행자" : `인물 ${meta.outfits.length + 1}`,
    active: true,
    front: null,
    angles: emptyAngles(),
  })
  await writeMeta(meta)
  return getCharacterLibrary()
}

export async function deleteOutfit(id: string) {
  const meta = await readMeta()
  const outfit = meta.outfits.find((item) => item.id === id)
  if (!outfit || meta.outfits[0]?.id === id) {
    return getCharacterLibrary()
  }
  await removeStoredFiles(outfit)
  meta.outfits = ensureHost(meta.outfits.filter((item) => item.id !== id))
  await writeMeta(meta)
  return getCharacterLibrary()
}

export async function updateOutfit(id: string, patch: { name?: string; active?: boolean }) {
  const meta = await readMeta()
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
  await writeMeta(meta)
  return getCharacterLibrary()
}

export async function saveFrontImage(outfitId: string, file: { name: string; bytes: Uint8Array }) {
  const ext = path.extname(file.name).toLowerCase()
  if (!allowed.has(ext)) {
    throw new Error("unsupported")
  }
  await mkdir(imageDir, { recursive: true })
  const meta = await readMeta()
  const outfit = meta.outfits.find((item) => item.id === outfitId)
  if (!outfit || outfit.front) {
    throw new Error("missing")
  }
  const id = `${randomUUID()}${ext}`
  await writeFile(path.join(imageDir, id), file.bytes)
  outfit.front = id
  outfit.angles = emptyAngles()
  await writeMeta(meta)
  return getCharacterLibrary()
}

export async function saveOutfitAngles(
  outfitId: string,
  files: { key: CharacterAngleKey; bytes: Uint8Array; ext: string }[],
) {
  await mkdir(imageDir, { recursive: true })
  const meta = await readMeta()
  const outfit = meta.outfits.find((item) => item.id === outfitId)
  if (!outfit) {
    throw new Error("missing")
  }
  for (const angle of CHARACTER_ANGLES) {
    const previous = outfit.angles[angle.key]
    if (previous) {
      await rm(path.join(imageDir, previous), { force: true })
    }
    outfit.angles[angle.key] = null
  }
  for (const file of files) {
    const ext = allowed.has(file.ext) ? file.ext : ".png"
    const id = `${randomUUID()}${ext}`
    await writeFile(path.join(imageDir, id), file.bytes)
    outfit.angles[file.key] = id
  }
  await writeMeta(meta)
  return getCharacterLibrary()
}

export async function outfitFrontPath(outfitId: string) {
  const meta = await readMeta()
  const outfit = meta.outfits.find((item) => item.id === outfitId)
  if (!outfit?.front) {
    return null
  }
  const name = safeName(outfit.front)
  if (!name) {
    return null
  }
  return path.join(imageDir, name)
}

export async function readCharacterImage(id: string) {
  const name = safeName(id)
  if (!name) {
    return null
  }
  try {
    const bytes = await readFile(path.join(imageDir, name))
    return { bytes, type: contentType(name) }
  } catch {
    return null
  }
}

export async function removeCharacterImage(id: string) {
  const name = safeName(id)
  if (!name) {
    return
  }
  const meta = await readMeta()
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
  await rm(path.join(imageDir, name), { force: true })
  await writeMeta(meta)
}

export async function canGenerateCharacterAngles() {
  return (await readHiggsfield()) !== null
}

function outfitReferences(outfit: CharacterOutfit) {
  return [outfit.front, ...outfit.angles.map((angle) => angle.image)].filter(
    (file): file is CharacterFile => file !== null,
  )
}

async function toOutfit(record: OutfitRecord): Promise<CharacterOutfit> {
  return {
    id: record.id,
    name: record.name,
    active: record.active,
    front: await fileOf(record.front),
    angles: await Promise.all(
      CHARACTER_ANGLES.map(async (angle) => ({
        key: angle.key,
        label: angle.label,
        image: await fileOf(record.angles[angle.key]),
      })),
    ),
  }
}

async function fileOf(id: string | null): Promise<CharacterFile | null> {
  if (!id || !(await readCharacterImage(id))) {
    return null
  }
  return { id, url: `/api/character/file/${encodeURIComponent(id)}` }
}

async function readMeta(): Promise<Meta> {
  try {
    const parsed = JSON.parse(await readFile(metaPath, "utf8")) as {
      front?: unknown
      angles?: Partial<Record<CharacterAngleKey, unknown>>
      outfits?: Partial<OutfitRecord>[]
    }
    if (Array.isArray(parsed.outfits)) {
      return { outfits: ensureHost(parsed.outfits.map((outfit, index) => normalizeOutfit(outfit, index))) }
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
          0,
        ),
      ],
    }
  } catch {
    return {
      outfits: [normalizeOutfit({ id: "default", name: "기본", active: true, front: null, angles: emptyAngles() }, 0)],
    }
  }
}

async function writeMeta(meta: Meta) {
  await mkdir(imageDir, { recursive: true })
  await writeFile(metaPath, JSON.stringify(meta, null, 2))
}

async function removeStoredFiles(outfit: OutfitRecord) {
  const names = [outfit.front, ...CHARACTER_ANGLES.map((angle) => outfit.angles[angle.key])].filter(
    (name): name is string => Boolean(name),
  )
  await Promise.all(names.map((name) => rm(path.join(imageDir, name), { force: true })))
}

function ensureHost(outfits: OutfitRecord[]) {
  if (outfits.length === 0) {
    return outfits
  }
  return outfits.map((outfit, index) => (index === 0 ? { ...outfit, active: true } : outfit))
}

function normalizeOutfit(raw: Partial<OutfitRecord> | undefined, index: number): OutfitRecord {
  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : randomUUID(),
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : index === 0 ? "진행자" : `인물 ${index + 1}`,
    active: raw?.active === true,
    front: typeof raw?.front === "string" ? raw.front : null,
    angles: anglesFrom(raw?.angles),
  }
}

function anglesFrom(raw: Partial<Record<CharacterAngleKey, unknown>> | undefined) {
  const angles = emptyAngles()
  for (const angle of CHARACTER_ANGLES) {
    const value = raw?.[angle.key]
    angles[angle.key] = typeof value === "string" ? value : null
  }
  return angles
}

function emptyAngles(): Record<CharacterAngleKey, string | null> {
  return Object.fromEntries(CHARACTER_ANGLES.map((angle) => [angle.key, null])) as Record<
    CharacterAngleKey,
    string | null
  >
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
