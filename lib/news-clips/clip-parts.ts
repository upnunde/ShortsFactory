import { isEndCtaScene } from "./report.ts"
import type {
  NewsClipProject,
  NewsClipProductionMode,
  NewsOptionalPart,
  NewsReportScene,
  NewsReportScenePart,
  SubtitleCue,
} from "./types.ts"

export type NewsClipPartId = "intro" | "hook" | "lead" | "body" | "outro"

export function newsOptionalPartEnabled(
  project: Pick<
    NewsClipProject,
    "disabledParts" | "productionMode" | "reportScenes"
  >,
  part: NewsOptionalPart
) {
  if (part === "hook") {
    return (
      project.productionMode === "buildup2" &&
      project.reportScenes.some(
        (scene) => reportScenePart(scene, "buildup2") === "hook"
      ) &&
      !project.disabledParts.includes(part)
    )
  }
  return !project.disabledParts.includes(part)
}

export function activeReportScenes(
  project: Pick<
    NewsClipProject,
    "disabledParts" | "productionMode" | "reportScenes"
  >
) {
  return project.reportScenes.filter((scene) => {
    const part = reportScenePart(scene, project.productionMode)
    return part === "body" || newsOptionalPartEnabled(project, part)
  })
}

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
    if (scene.id === "buildup2-hook") return "hook"
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
    hook: scenes.filter(
      (scene) => reportScenePart(scene, productionMode) === "hook"
    ),
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

/**
 * 자막 편집 내용을 장면 대본에 되돌린다. 보도형은 모든 TTS 장면을 갱신하고,
 * 원본 구간형은 TTS로 읽는 서두·마무리만 갱신한다. 원본 음성 본문은 자막
 * 문구를 고쳐도 영상의 기준 대본을 바꾸지 않는다.
 */
export function syncSceneNarrationFromSubtitles(
  scenes: NewsReportScene[],
  cues: SubtitleCue[],
  productionMode: NewsClipProductionMode
) {
  const cuesByScene = new Map<string, SubtitleCue[]>()
  for (const cue of cues) {
    if (!cue.sceneId) continue
    const sceneCues = cuesByScene.get(cue.sceneId) ?? []
    sceneCues.push(cue)
    cuesByScene.set(cue.sceneId, sceneCues)
  }

  return scenes.map((scene) => {
    const part = reportScenePart(scene, productionMode)
    if (productionMode === "buildup2" && (part === "hook" || part === "body")) {
      return scene
    }
    const sceneCues = cuesByScene.get(scene.id)
    if (!sceneCues?.length) return scene
    const narration = [...sceneCues]
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .map((cue) => cue.text.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
    return narration ? { ...scene, narration } : scene
  })
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
  bodyScenes: Array<Pick<NewsReportScene, "id">>,
  hookScenes: Array<Pick<NewsReportScene, "id">> = []
) {
  const hookIds = new Set(hookScenes.map((scene) => scene.id))
  const leadIds = new Set(leadScenes.map((scene) => scene.id))
  const bodyIds = new Set(bodyScenes.map((scene) => scene.id))
  const hook: SubtitleCue[] = []
  const lead: SubtitleCue[] = []
  const body: SubtitleCue[] = []
  const outro: SubtitleCue[] = []

  for (const cue of cues) {
    const sceneId = cue.sceneId || ""
    if (
      isEndCtaScene({ id: sceneId }) ||
      cue.id.startsWith("end-cta") ||
      subtitleCueLooksLikeEndCta(cue)
    ) {
      outro.push(cue)
      continue
    }
    if (hookIds.has(sceneId)) {
      hook.push(cue)
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
    // 대본 다시 작성으로 장면 ID가 바뀐 뒤 남은 이전 자막을 본문에
    // 되살리지 않는다. 현재 장면에 연결되지 않은 cue는 폐기해야 새 자막과
    // 같은 시간대에 겹치거나 본문 끝에 다시 붙지 않는다.
  }

  return { hook, lead, body, outro }
}

/** 레거시 저장본에서 CTA 첫 질문이 마지막 본문 sceneId로 남은 경우를 복구한다. */
function subtitleCueLooksLikeEndCta(cue: SubtitleCue) {
  const text = cue.text.replace(/\s+/g, " ").trim()
  if (!text) return false
  if (/(?:댓글|의견|한마디).*(?:남겨|달아|적어|알려|써)/u.test(text)) {
    return true
  }
  return /(?:어떻게\s*(?:생각해|생각하|봐|보는지)|의견(?:은|이)\s*어때|생각(?:은|이)\s*어때)[?？]?$/u.test(
    text
  )
}
