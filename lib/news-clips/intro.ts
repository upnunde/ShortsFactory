import type { NewsClipProject, NewsReportScene } from "./types.ts"

export type IntroStillRange = {
  sceneId: string
  sourceId: string
  start: number
  end: number
  visual: NewsReportScene["visual"] | "candidate" | "manual"
}

export function selectIntroStillRange(
  project: NewsClipProject
): IntroStillRange {
  if (
    typeof project.introStillTimeSeconds === "number" &&
    Number.isFinite(project.introStillTimeSeconds)
  ) {
    const sourceDuration = project.source?.durationSeconds ?? 0
    const time = Math.max(
      0,
      sourceDuration > 0
        ? Math.min(sourceDuration - 0.05, project.introStillTimeSeconds)
        : project.introStillTimeSeconds
    )
    return {
      sceneId: "manual-intro-still",
      sourceId: project.source?.id ?? "",
      start: time,
      end: time,
      visual: "manual",
    }
  }

  const rankedScenes = project.reportScenes
    .map((scene, index) => ({ scene, score: introStillScore(scene, index) }))
    .filter(
      ({ scene }) =>
        Number.isFinite(scene.sourceStart) &&
        Number.isFinite(scene.sourceEnd) &&
        scene.sourceEnd > scene.sourceStart
    )
    .sort((left, right) => right.score - left.score)
  const selectedScene = rankedScenes[0]?.scene
  if (selectedScene) {
    return {
      sceneId: selectedScene.id,
      sourceId: selectedScene.sourceId || project.source?.id || "",
      start: selectedScene.sourceStart,
      end: selectedScene.sourceEnd,
      visual: selectedScene.visual,
    }
  }

  const candidate =
    project.candidates.find(
      (item) => item.id === project.selectedCandidateId
    ) ?? project.candidates[0]
  if (candidate?.sourceEnd > candidate?.sourceStart) {
    return {
      sceneId: candidate.id,
      sourceId: project.source?.id ?? "",
      start: candidate.sourceStart,
      end: candidate.sourceEnd,
      visual: "candidate",
    }
  }

  const fallbackScene = project.reportScenes.find(
    (scene) => scene.sourceEnd > scene.sourceStart
  )
  return {
    sceneId: fallbackScene?.id ?? "source-start",
    sourceId: fallbackScene?.sourceId || project.source?.id || "",
    start: Math.max(0, fallbackScene?.sourceStart ?? 0),
    end: Math.max(1, fallbackScene?.sourceEnd ?? 5),
    visual: fallbackScene?.visual ?? "candidate",
  }
}

export function introStillTime(range: IntroStillRange) {
  return range.start === range.end
    ? range.start
    : range.start + Math.max(0.1, range.end - range.start) * 0.5
}

function introStillScore(scene: NewsReportScene, index: number) {
  const numbers = scene.narration.match(
    /\d[\d,.]*\s*(?:%|원|명|건|배|조|억|만)?/g
  )
  const keyTerms = scene.narration.match(
    /정부|국회|대통령|피해|세금|일자리|안보|외교|사법|논란|발언|결정|변경/g
  )
  return (
    (scene.visual === "quote" ? 100 : scene.visual === "source" ? 60 : 0) +
    (numbers?.length ?? 0) * 8 +
    (keyTerms?.length ?? 0) * 4 +
    Math.min(12, scene.narration.length / 8) -
    index * 0.25
  )
}
