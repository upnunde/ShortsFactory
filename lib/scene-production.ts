import { narrationSeconds } from "./timing.ts"

export const SCENE_PRODUCTION_MODES = [
  "ai_video",
  "character_motion",
  "graphic_motion",
  "still_motion",
  "composite",
] as const

export type SceneProductionMode = (typeof SCENE_PRODUCTION_MODES)[number]

export const SCENE_PRODUCTION_LABELS: Record<SceneProductionMode, string> = {
  ai_video: "Seedance 영상",
  character_motion: "2D 캐릭터 모션",
  graphic_motion: "자료·도표",
  still_motion: "정지 화면 모션",
  composite: "혼합 합성",
}

export function normalizeProductionMode(
  value: unknown,
  shot: "room" | "insert" = "room"
): SceneProductionMode {
  if (
    typeof value === "string" &&
    SCENE_PRODUCTION_MODES.includes(value as SceneProductionMode)
  ) {
    return value as SceneProductionMode
  }
  return shot === "insert" ? "graphic_motion" : "character_motion"
}

export function isAiVideoMode(mode: SceneProductionMode) {
  return mode === "ai_video"
}

export function productionUsage(
  scenes: { scriptTarget: string; productionMode: SceneProductionMode }[]
) {
  const aiScenes = scenes.filter((scene) => isAiVideoMode(scene.productionMode))
  return {
    aiSceneCount: aiScenes.length,
    aiSeconds: aiScenes.reduce(
      (sum, scene) => sum + Math.max(4, Math.ceil(narrationSeconds(scene.scriptTarget))),
      0
    ),
  }
}

export function constrainAiVideoUsage<T extends {
  shot: "room" | "insert"
  scriptTarget: string
  productionMode: SceneProductionMode
}>(scenes: T[], maxScenes: number, maxSeconds: number): T[] {
  let usedScenes = 0
  let usedSeconds = 0
  return scenes.map((scene) => {
    if (!isAiVideoMode(scene.productionMode)) {
      return scene
    }
    const seconds = Math.max(4, Math.ceil(narrationSeconds(scene.scriptTarget)))
    if (usedScenes >= maxScenes || usedSeconds + seconds > maxSeconds) {
      return {
        ...scene,
        productionMode:
          scene.shot === "insert" ? "graphic_motion" : "character_motion",
      }
    }
    usedScenes += 1
    usedSeconds += seconds
    return scene
  })
}
