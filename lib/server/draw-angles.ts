import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { CHARACTER_ANGLES, type CharacterAngleKey } from "@/lib/character-angles"
import { outfitFrontPath, saveOutfitAngles } from "@/lib/server/character"

const cacheRoot = path.join(process.cwd(), "assets", "characters", "default", ".angle-cache")

const prompts: Record<CharacterAngleKey, string> = {
  "three-quarter-face":
    "Close-up three-quarter portrait of the same character, head and shoulders, face turned slightly, same glasses, comb, beak, and black turtleneck.",
  profile: "Strict side profile of the same character, head and shoulders, beak and glasses in profile, same black turtleneck.",
  "front-body":
    "Full-body front view of the same character standing straight toward the camera, same outfit, tail, and shoes, entire body visible.",
  "three-quarter-body":
    "Full-body three-quarter view of the same character standing, body turned about 45 degrees, same outfit and tail, entire body visible.",
  "back-body":
    "Full-body back view of the same character standing, seen from behind, same sweater, jeans, shoes, tail, and comb.",
}

export async function generateOutfitAngles(outfitId: string) {
  const frontPath = await outfitFrontPath(outfitId)
  if (!frontPath) {
    throw new Error("no-front")
  }
  const frontBytes = await readFile(frontPath)
  const hash = createHash("sha256").update(frontBytes).digest("hex")
  const cacheDir = path.join(cacheRoot, hash)
  const drawn = await readCachedAngles(cacheDir)
  if (!drawn) {
    await writeDrawRequest(cacheDir, frontPath)
    throw new Error("draw-failed")
  }
  return saveOutfitAngles(outfitId, drawn)
}

export function anglePrompt(key: CharacterAngleKey) {
  return prompts[key]
}

async function readCachedAngles(cacheDir: string) {
  const files: { key: CharacterAngleKey; bytes: Uint8Array; ext: string }[] = []
  for (const angle of CHARACTER_ANGLES) {
    const filePath = path.join(cacheDir, `${angle.key}.jpg`)
    try {
      files.push({ key: angle.key, bytes: await readFile(filePath), ext: ".jpg" })
    } catch {
      return null
    }
  }
  return files
}

async function writeDrawRequest(cacheDir: string, frontPath: string) {
  await mkdir(cacheDir, { recursive: true })
  await writeFile(
    path.join(cacheDir, "request.json"),
    JSON.stringify(
      {
        frontPath,
        angles: CHARACTER_ANGLES.map((angle) => ({ key: angle.key, label: angle.label, prompt: prompts[angle.key] })),
      },
      null,
      2,
    ),
  )
}
