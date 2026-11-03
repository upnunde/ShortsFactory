import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  CHARACTER_ANGLES,
  type CharacterAngleKey,
} from "@/lib/character-angles"
import {
  getCharacterLibrary,
  outfitFrontPath,
  saveOutfitAngles,
} from "@/lib/server/character"
import {
  downloadFile,
  generateMedia,
  uploadBytes,
} from "@/lib/server/higgsfield"

const prompts: Record<CharacterAngleKey, string> = {
  "three-quarter-face":
    "Close-up three-quarter portrait of the same character, head and shoulders, face turned slightly, same glasses, comb, beak, and black turtleneck.",
  profile:
    "Strict side profile of the same character, head and shoulders, beak and glasses in profile, same black turtleneck.",
  "front-body":
    "Full-body front view of the same character standing straight toward the camera, same outfit, tail, and shoes, entire body visible.",
  "three-quarter-body":
    "Full-body three-quarter view of the same character standing, body turned about 45 degrees, same outfit and tail, entire body visible.",
  "back-body":
    "Full-body back view of the same character standing, seen from behind, same sweater, jeans, shoes, tail, and comb.",
  "gesture-explain":
    "Full-body front view explaining calmly with both wings open at chest height, same outfit and proportions, entire body visible.",
  "gesture-point-left":
    "Full-body front view pointing clearly toward the viewer's left with one wing, same outfit and proportions, entire body visible.",
  "gesture-point-right":
    "Full-body front view pointing clearly toward the viewer's right with one wing, same outfit and proportions, entire body visible.",
  "gesture-thinking":
    "Full-body three-quarter view in a thoughtful pose with one wing lightly touching the lower beak, same outfit and proportions.",
  "gesture-wave":
    "Full-body front view giving one small friendly wave with a wing, same outfit and proportions, entire body visible.",
  "mouth-small":
    "Close-up front portrait with the beak slightly open for a quiet speaking phoneme, neutral friendly eyes, same glasses and clothing.",
  "mouth-wide":
    "Close-up front portrait with the beak clearly open for an emphasized speaking phoneme, same face, glasses, and clothing.",
  "expression-smile":
    "Close-up front portrait with a warm pleased expression and relaxed eyes, beak closed, same glasses and clothing.",
  "expression-surprised":
    "Close-up front portrait with a mild surprised expression, eyes slightly wider and beak slightly open, same glasses and clothing.",
  "expression-serious":
    "Close-up front portrait with a calm serious explanatory expression, beak closed, same glasses and clothing.",
}

export async function generateOutfitAngles(
  outfitId: string,
  profileId = "default"
) {
  const frontPath = await outfitFrontPath(outfitId, profileId)
  if (!frontPath) {
    throw new Error("no-front")
  }
  const library = await getCharacterLibrary(profileId)
  const outfit = library.outfits.find((item) => item.id === outfitId)
  if (!outfit) {
    throw new Error("missing")
  }
  const missing = outfit.angles.filter((slot) => !slot.image)
  if (missing.length === 0) {
    return library
  }
  const frontBytes = await readFile(frontPath)
  const hash = createHash("sha256").update(frontBytes).digest("hex")
  const cacheDir = path.join(
    process.cwd(),
    "assets",
    "characters",
    profileId,
    ".angle-cache",
    hash
  )
  await mkdir(cacheDir, { recursive: true })
  const drawn: { key: CharacterAngleKey; bytes: Uint8Array; ext: string }[] = []
  let referenceUrl = ""
  for (const slot of missing) {
    const angle = CHARACTER_ANGLES.find((item) => item.key === slot.key)
    if (!angle) continue
    const cached = await readCachedAngle(cacheDir, angle.key)
    if (cached) {
      drawn.push(cached)
      continue
    }
    referenceUrl ||= await uploadBytes(
      frontBytes,
      imageType(path.extname(frontPath))
    )
    const url = await generateMedia("xai/grok-imagine-image-2.0", {
      prompt: [
        "Create a strict character model-sheet view from the reference image.",
        prompts[angle.key],
        "Preserve the exact same individual, illustration style, proportions, colors, face, outfit, and accessories.",
        "Plain neutral background. No text, labels, extra characters, or alternate outfit.",
      ].join(" "),
      image_urls: [referenceUrl],
      resolution: "1k",
      aspect_ratio: "3:4",
      quality: "low",
    })
    await writeFile(
      path.join(cacheDir, `${angle.key}.jpg`),
      await downloadFile(url)
    )
    const generated = await readCachedAngle(cacheDir, angle.key)
    if (generated) drawn.push(generated)
  }
  if (drawn.length !== missing.length) {
    throw new Error("draw-failed")
  }
  return saveOutfitAngles(outfitId, drawn, profileId)
}

export function anglePrompt(key: CharacterAngleKey) {
  return prompts[key]
}

async function readCachedAngle(cacheDir: string, key: CharacterAngleKey) {
  try {
    return {
      key,
      bytes: await readFile(path.join(cacheDir, `${key}.jpg`)),
      ext: ".jpg",
    }
  } catch {
    return null
  }
}

function imageType(extension: string) {
  if (extension.toLowerCase() === ".png") return "image/png"
  if (extension.toLowerCase() === ".webp") return "image/webp"
  return "image/jpeg"
}
