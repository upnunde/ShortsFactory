import { isEndCtaScene } from "./report.ts"
import type {
  NewsClipProductionMode,
  NewsReportScene,
  NewsReportScenePart,
  SubtitleCue,
} from "./types.ts"

export type NewsClipPartId = "intro" | "lead" | "body" | "outro"

/** 장면 ID로 분리된 마무리 문구가 서두 끝에 중복 저장된 레거시 상태를 정리한다. */
export function removeTrailingPartText(value: string, trailing: string) {
  const source = value.replace(/\s+/g, " ").trim()
  const suffix = trailing.replace(/\s+/g, " ").trim()
  if (!source || !suffix) return source
  if (source === suffix) return ""
  return source.endsWith(` ${suffix}`)
    ? source.slice(0, -(suffix.length + 1)).trim()
    : source
}

/** 명시적 마무리 장면이 불완전해도 서두 끝의 댓글 유도 문장을 제거한다. */
export function removeTrailingCtaFromLead(value: string, trailing = "") {
  const source = removeTrailingPartText(value, trailing)
  const sentences =
    source.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((item) => item.trim()) ?? []
  if (!sentences.length) return source
  const tailStart = Math.max(0, sentences.length - 3)
  let cutIndex = -1
  for (let index = tailStart; index < sentences.length; index += 1) {
    const sentence = sentences[index]!
    const question =
      /(?:어떻게\s*생각|어떻게\s*봐|어떻게\s*보|의견은|생각은|판단은)/.test(
        sentence
      )
    const request =
      /(?:댓글|의견|한마디).*(?:남겨|달아|적어|알려|써)|(?:남겨|달아|적어|알려|써).*(?:댓글|의견|한마디)/.test(
        sentence
      )
    if (!question && !request) continue
    cutIndex = index
    if (request && index > tailStart && /[?？]$/.test(sentences[index - 1]!)) {
      cutIndex = index - 1
    }
    break
  }
  return cutIndex >= 0 ? sentences.slice(0, cutIndex).join(" ").trim() : source
}

/** 본편 장면을 서두·본문·마무리로 나눈다. 인트로(제목 카드)는 별도. */
export function reportScenePart(
  scene: NewsReportScene,
  productionMode: NewsClipProductionMode
): NewsReportScenePart {
  if (isEndCtaScene(scene)) return "outro"
  if (scene.part) return scene.part
  if (productionMode === "buildup2") {
    return scene.id === "buildup2-lead" ? "lead" : "body"
  }
  // 신규 보도 장면은 part를 저장한다. 아래 ID 판정은 기존 저장본 전용이며
  // 배열의 첫 항목을 서두로 간주하지 않아 재정렬해도 역할이 바뀌지 않는다.
  return /^(?:report-)?lead(?:-|$)/.test(scene.id) ||
    scene.id === "report-scene-1"
    ? "lead"
    : "body"
}

/** 본편 장면을 서두·본문·마무리로 나눈다. 인트로(제목 카드)는 별도. */
export function splitScenesByClipPart(
  scenes: NewsReportScene[],
  productionMode: NewsClipProductionMode
) {
  return {
    lead: scenes.filter(
      (scene) => reportScenePart(scene, productionMode) === "lead"
    ),
    body: scenes.filter(
      (scene) => reportScenePart(scene, productionMode) === "body"
    ),
    outro: scenes.filter(
      (scene) => reportScenePart(scene, productionMode) === "outro"
    ),
  }
}

export function isLeadSceneId(
  sceneId: string | undefined,
  leadScenes: Array<Pick<NewsReportScene, "id">>
) {
  if (!sceneId) return false
  return leadScenes.some((scene) => scene.id === sceneId)
}

export function partitionSubtitlesByPart(
  cues: SubtitleCue[],
  leadScenes: Array<Pick<NewsReportScene, "id">>,
  bodyScenes: Array<Pick<NewsReportScene, "id">>
) {
  const leadIds = new Set(leadScenes.map((scene) => scene.id))
  const bodyIds = new Set(bodyScenes.map((scene) => scene.id))
  const lead: SubtitleCue[] = []
  const body: SubtitleCue[] = []
  const outro: SubtitleCue[] = []

  for (const cue of cues) {
    const sceneId = cue.sceneId || ""
    if (isEndCtaScene({ id: sceneId }) || cue.id.startsWith("end-cta")) {
      outro.push(cue)
      continue
    }
    if (leadIds.has(sceneId)) {
      lead.push(cue)
      continue
    }
    if (bodyIds.has(sceneId) || !sceneId) {
      body.push(cue)
      continue
    }
    body.push(cue)
  }

  return { lead, body, outro }
}
