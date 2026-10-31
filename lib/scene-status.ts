import { narrationSeconds } from "@/lib/timing"
import type { Project, Scene } from "@/lib/types"

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
  return visualReady(scene) && voiceReady(scene) && scene.scriptTarget.trim() !== ""
}

export function projectSeconds(scenes: Scene[]) {
  return scenes.reduce((total, scene) => total + narrationSeconds(scene.scriptTarget), 0)
}

export function filmSignature(scenes: Scene[]) {
  return scenes
    .map((scene) => `${scene.id}|${scene.scriptTarget}|${scene.subtitle}|${scene.sceneDescription}`)
    .join("\n")
}

export function filmReady(project: Project) {
  return (
    project.finalSignature !== "" &&
    project.finalSignature === filmSignature(project.scenes) &&
    project.scenes.every(sceneReady)
  )
}

export function scriptBlocked(project: Project) {
  if (project.scenes.length === 0) {
    return "씬이 없습니다."
  }
  if (project.scenes.some((scene) => scene.scriptKo.trim() === "" || scene.scriptTarget.trim() === "")) {
    return "비어 있는 대사가 있습니다."
  }
  if (project.scenes.some(englishIsStale)) {
    return "영어를 다시 써야 하는 씬이 있습니다."
  }
  if (projectSeconds(project.scenes) > 60) {
    return "예상 길이가 1분을 넘습니다."
  }
  return ""
}
