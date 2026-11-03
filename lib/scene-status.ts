import { narrationSeconds } from "./timing.ts"
import type { Project, Scene } from "./types.ts"

export function englishIsStale(scene: Scene) {
  return scene.scriptKo.trim() !== scene.approvedKo.trim()
}

export function visualReady(scene: Scene) {
  return (
    scene.visualDescription !== "" &&
    scene.visualDescription === scene.sceneDescription &&
    !englishIsStale(scene)
  )
}

export function voiceReady(scene: Scene) {
  return (
    scene.voiceScript !== "" &&
    scene.voiceScript === scene.scriptTarget &&
    !englishIsStale(scene)
  )
}

export function sceneReady(scene: Scene) {
  return (
    scene.scriptTarget.trim() !== "" &&
    scene.sceneDescription.trim() !== "" &&
    !englishIsStale(scene)
  )
}

export function projectSeconds(scenes: Scene[]) {
  return scenes.reduce(
    (total, scene) => total + narrationSeconds(scene.scriptTarget),
    0
  )
}

export function narrationSignature(scenes: Scene[], voicePreviewKey = "") {
  return [
    voicePreviewKey,
    ...scenes.map(
      (scene) =>
        `${scene.id}|${scene.scriptKo.trim()}|${scene.approvedKo.trim()}|${scene.scriptTarget.trim()}`
    ),
  ].join("\n")
}

export function directionReady(project: Project) {
  return (
    project.directionSignature !== "" &&
    project.directionSignature ===
      narrationSignature(project.scenes, project.voicePreviewKey)
  )
}

export function filmSignature(
  project: Pick<
    Project,
    "topicEn" | "placeEn" | "scenes" | "bgmId" | "voicePreviewKey"
  >
) {
  return [
    project.bgmId,
    project.voicePreviewKey,
    project.topicEn,
    project.placeEn,
    ...project.scenes.map(
      (scene) =>
        `${scene.id}|${scene.shot}|${scene.productionMode}|${scene.scriptTarget}|${scene.subtitle}|${scene.sceneDescription}|${(scene.castIds ?? []).join(",")}`
    ),
  ].join("\n")
}

export function filmReady(project: Project) {
  return (
    project.finalSignature !== "" &&
    project.finalSignature === filmSignature(project) &&
    project.scenes.every(sceneReady)
  )
}

export function scriptBlocked(project: Project) {
  if (project.scenes.length === 0) {
    return "씬이 없습니다."
  }
  if (project.placeKo.trim() === "") {
    return "화면의 장소가 아직 없습니다."
  }
  if (project.placeKo.trim() !== project.placeApprovedKo.trim()) {
    return "장소 설명을 영어로 맞춰야 합니다."
  }
  if (
    project.scenes.some(
      (scene) =>
        scene.scriptKo.trim() === "" || scene.scriptTarget.trim() === ""
    )
  ) {
    return "비어 있는 대사가 있습니다."
  }
  if (project.scenes.some((scene) => scene.sceneDescription.trim() === "")) {
    return "비어 있는 화면이 있습니다."
  }
  if (project.scenes.some(englishIsStale)) {
    return "변경된 씬의 연결 항목을 다시 맞춰야 합니다."
  }
  return ""
}
