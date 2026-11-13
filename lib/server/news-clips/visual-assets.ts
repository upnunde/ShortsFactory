import { reportScenePart } from "../../news-clips/clip-parts.ts"
import { issueTokens } from "../../news-clips/discovery.ts"
import { isEndCtaScene } from "../../news-clips/report.ts"
import type {
  NewsClipProject,
  NewsReportScene,
  NewsSource,
} from "../../news-clips/types.ts"
import {
  searchWikimediaCommonsImages,
  type WikimediaCommonsImage,
} from "./wikimedia-commons.ts"

const QUERY_STOP_WORDS = new Set([
  "그리고",
  "그런데",
  "하지만",
  "때문에",
  "문제는",
  "이라는",
  "있다는",
  "없다는",
  "정부",
  "정치",
  "논란",
  "사실",
  "이번",
  "대한",
  "우리",
  "지금",
  "정말",
])
const MIN_RELEVANCE_SCORE = 36

export type ReportVisualAssetPlan = {
  sceneId: string
  query: string
  narration?: string
}

export type ReportVisualAssetAssignment = {
  sceneId: string
  sourceId: string
}

type SearchImages = typeof searchWikimediaCommonsImages
type StoreImage = (candidate: WikimediaCommonsImage) => Promise<NewsSource>

export type ReportVisualAssetDependencies = {
  searchImages?: SearchImages
  storeImage?: StoreImage
}

/**
 * 근거 원본과 별개인 공개 시각자료 검색 계획을 만든다. 이미 사용자가
 * 보조 소스를 고른 장면은 덮어쓰지 않고, 핵심 원본만 쓰는 장면을 채운다.
 */
export function buildReportVisualAssetPlans(
  project: NewsClipProject,
  limit = 4
): ReportVisualAssetPlan[] {
  if (project.productionMode !== "report") return []
  const primarySourceId = project.source?.id ?? ""
  const supportingIds = new Set(
    project.supportingSources.map((source) => source.id)
  )
  return project.reportScenes
    .filter((scene) => {
      if (!scene.narration.trim() || isEndCtaScene(scene)) return false
      // 서두·마무리는 원본 화면을 유지하고, 본문만 공개 자료로 채운다.
      const part = reportScenePart(scene, project.productionMode)
      if (part === "lead" || part === "outro") return false
      const sourceId = scene.sourceId || primarySourceId
      return (
        !sourceId ||
        sourceId === primarySourceId ||
        !supportingIds.has(sourceId)
      )
    })
    .slice(0, Math.max(0, Math.min(8, Math.floor(limit))))
    .flatMap((scene) => {
      const query = reportVisualAssetQuery(project, scene)
      return query
        ? [{ sceneId: scene.id, query, narration: scene.narration.trim() }]
        : []
    })
}

export function reportVisualAssetQuery(
  project: Pick<NewsClipProject, "selectedIssue" | "title">,
  scene: Pick<NewsReportScene, "narration">
) {
  const issue = project.selectedIssue
  const priority = uniqueTokens([
    ...(issue?.keywords ?? []),
    ...(issue ? issueTokens(issue.title) : []),
    ...issueTokens(project.title),
  ]).filter(usefulQueryToken)
  const sceneTokens = issueTokens(scene.narration)
    .filter(usefulQueryToken)
    .filter((token) => !priority.includes(token))
  const terms = uniqueTokens([
    ...priority.slice(0, 2),
    ...sceneTokens.slice(0, 2),
  ]).slice(0, 4)
  return terms.join(" ")
}

export function scoreReportVisualCandidate(
  candidate: WikimediaCommonsImage,
  query: string,
  rank = 0
) {
  const queryTerms = issueTokens(query).map((token) => token.toLowerCase())
  const title =
    `${candidate.title} ${candidate.titleKo} ${candidate.titleEn}`.toLowerCase()
  const description =
    `${candidate.descriptionKo} ${candidate.descriptionEn}`.toLowerCase()
  const titleMatches = queryTerms.filter((term) => title.includes(term)).length
  const descriptionMatches = queryTerms.filter((term) =>
    description.includes(term)
  ).length
  const longSide = Math.max(candidate.width, candidate.height)
  const shortSide = Math.min(candidate.width, candidate.height)
  const quality = longSide >= 1920 && shortSide >= 1080 ? 8 : 3
  const portraitBonus = candidate.height >= candidate.width ? 3 : 0
  return (
    Math.max(0, 20 - rank * 2) +
    titleMatches * 18 +
    descriptionMatches * 8 +
    quality +
    portraitBonus
  )
}

/** 검색·다운로드 한 건이 실패해도 나머지 장면은 계속 준비한다. */
export async function prepareReportVisualAssets(
  project: NewsClipProject,
  dependencies: ReportVisualAssetDependencies = {}
) {
  return prepareVisualAssetsForPlans(
    buildReportVisualAssetPlans(project),
    dependencies
  )
}

export async function prepareVisualAssetsForPlans(
  plans: ReportVisualAssetPlan[],
  dependencies: ReportVisualAssetDependencies = {}
) {
  const searchImages = dependencies.searchImages ?? searchWikimediaCommonsImages
  const storeImage: StoreImage =
    dependencies.storeImage ??
    (async (candidate) => {
      const { createLicensedWebImageSource } = await import("./source-store.ts")
      return createLicensedWebImageSource(candidate)
    })
  const usedCandidateIds = new Set<string>()
  const sources: NewsSource[] = []
  const assignments: ReportVisualAssetAssignment[] = []

  for (const plan of plans) {
    try {
      const candidates = await searchImages(plan.query, { limit: 10 })
      const candidate = candidates
        .map((item, rank) => ({
          item,
          score: scoreReportVisualCandidate(item, plan.query, rank),
        }))
        .filter(
          ({ item, score }) =>
            !usedCandidateIds.has(item.id) && score >= MIN_RELEVANCE_SCORE
        )
        .sort((left, right) => right.score - left.score)[0]?.item
      if (!candidate) continue
      const source = await storeImage(candidate)
      usedCandidateIds.add(candidate.id)
      sources.push(source)
      assignments.push({ sceneId: plan.sceneId, sourceId: source.id })
    } catch {
      // 한 장면의 공급자/다운로드 오류가 전체 대본 준비를 막지 않는다.
    }
  }

  return { sources, assignments }
}

function usefulQueryToken(token: string) {
  return token.length >= 2 && !QUERY_STOP_WORDS.has(token)
}

function uniqueTokens(values: string[]) {
  const seen = new Set<string>()
  return values.flatMap((value) =>
    issueTokens(value).filter((token) => {
      const key = token.toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  )
}
