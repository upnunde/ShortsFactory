import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

const libraryPath = path.join(process.cwd(), "config", "bgm.json")
const audioDir = path.join(process.cwd(), "assets", "bgm")
const defaultTrackId = "stella-waltz"
const maxBytes = 20 * 1024 * 1024

const extensions: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
}

export type BgmTrack = {
  id: string
  name: string
  file: string
}

export type BgmLibrary = {
  defaultId: string
  tracks: BgmTrack[]
}

let chain: Promise<void> = Promise.resolve()

export async function readBgmLibrary() {
  return enqueue(readStored)
}

export async function addBgmTrack(filename: string, bytes: Uint8Array) {
  return enqueue(async () => {
    const extension = path.extname(filename).toLowerCase()
    if (
      !extensions[extension] ||
      bytes.byteLength === 0 ||
      bytes.byteLength > maxBytes
    ) {
      throw new Error("unsupported-audio")
    }
    const library = await readStored()
    const name = path.basename(filename, extension).trim() || "배경음악"
    const id = uniqueId(slug(name), library.tracks)
    const file = `${id}${extension}`
    await mkdir(audioDir, { recursive: true })
    await writeFile(path.join(audioDir, file), bytes)
    const next = {
      ...library,
      tracks: [...library.tracks, { id, name, file }],
    }
    await writeStored(next)
    return next
  })
}

export async function removeBgmTrack(id: string) {
  return enqueue(async () => {
    if (id === defaultTrackId) {
      throw new Error("keep-default")
    }
    const library = await readStored()
    const track = library.tracks.find((item) => item.id === id)
    if (!track) {
      return library
    }
    await unlink(path.join(audioDir, path.basename(track.file))).catch(
      () => undefined
    )
    const tracks = library.tracks.filter((item) => item.id !== id)
    const next = {
      defaultId: tracks.some((item) => item.id === library.defaultId)
        ? library.defaultId
        : defaultTrackId,
      tracks,
    }
    await writeStored(next)
    return next
  })
}

export async function readBgmAudio(id: string) {
  const library = await readBgmLibrary()
  const track = library.tracks.find((item) => item.id === id)
  if (!track || !isSafeFile(track.file)) {
    return null
  }
  try {
    const bytes = await readFile(path.join(audioDir, track.file))
    return {
      bytes,
      type:
        extensions[path.extname(track.file).toLowerCase()] ||
        "application/octet-stream",
    }
  } catch {
    return null
  }
}

export async function bgmFilePath(id: string) {
  const library = await readBgmLibrary()
  const selected =
    library.tracks.find((item) => item.id === id) ??
    library.tracks.find((item) => item.id === library.defaultId)
  if (!selected || !isSafeFile(selected.file)) {
    return null
  }
  const filePath = path.join(audioDir, selected.file)
  try {
    await access(filePath)
    return filePath
  } catch {
    return null
  }
}

async function readStored(): Promise<BgmLibrary> {
  try {
    return normalizeLibrary(JSON.parse(await readFile(libraryPath, "utf8")))
  } catch {
    return {
      defaultId: defaultTrackId,
      tracks: [
        {
          id: defaultTrackId,
          name: "Stella Princess Waltz",
          file: "stella-waltz.mp3",
        },
      ],
    }
  }
}

async function writeStored(library: BgmLibrary) {
  await mkdir(path.dirname(libraryPath), { recursive: true })
  await writeFile(libraryPath, `${JSON.stringify(library, null, 2)}\n`)
}

function normalizeLibrary(value: unknown): BgmLibrary {
  const record =
    value && typeof value === "object" ? (value as Partial<BgmLibrary>) : {}
  const tracks = Array.isArray(record.tracks)
    ? record.tracks.flatMap((item) => {
        if (!item || typeof item !== "object") {
          return []
        }
        const track = item as Partial<BgmTrack>
        if (
          typeof track.id !== "string" ||
          typeof track.name !== "string" ||
          typeof track.file !== "string" ||
          !isSafeId(track.id) ||
          !isSafeFile(track.file)
        ) {
          return []
        }
        return [
          {
            id: track.id,
            name: track.name.trim() || track.id,
            file: track.file,
          },
        ]
      })
    : []
  const withDefault = tracks.some((track) => track.id === defaultTrackId)
    ? tracks
    : [
        {
          id: defaultTrackId,
          name: "Stella Princess Waltz",
          file: "stella-waltz.mp3",
        },
        ...tracks,
      ]
  return { defaultId: defaultTrackId, tracks: withDefault }
}

function uniqueId(base: string, tracks: BgmTrack[]) {
  const used = new Set(tracks.map((track) => track.id))
  if (!used.has(base)) {
    return base
  }
  let index = 2
  while (used.has(`${base}-${index}`)) {
    index += 1
  }
  return `${base}-${index}`
}

function slug(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
  return cleaned || "track"
}

function isSafeId(id: string) {
  return /^[a-z0-9-]{1,64}$/.test(id)
}

function isSafeFile(file: string) {
  return (
    path.basename(file) === file &&
    extensions[path.extname(file).toLowerCase()] !== undefined
  )
}

function enqueue<T>(job: () => Promise<T>) {
  const run = chain.then(job, job)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}
