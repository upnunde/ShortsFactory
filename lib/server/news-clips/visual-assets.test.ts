import assert from "node:assert/strict"
import test from "node:test"

import type { NewsClipProject, NewsSource } from "../../news-clips/types.ts"
import type { WikimediaCommonsImage } from "./wikimedia-commons.ts"
import {
  buildReportVisualAssetPlans,
  prepareReportVisualAssets,
  prepareVisualAssetsForPlans,
  reportVisualAssetQuery,
  scoreReportVisualCandidate,
} from "./visual-assets.ts"

const project = {
  productionMode: "report",
  title: "국회 예산 논란\n무슨 일이야",
  source: { id: "primary" },
  supportingSources: [],
  selectedIssue: {
    title: "국회 예산안 처리 논란",
    keywords: ["국회", "예산안"],
  },
  reportScenes: [
    {
      id: "lead-1",
      part: "lead",
      narration: "국회 본회의장에서 예산안 처리가 시작됐어.",
      visual: "source",
      sourceId: "primary",
    },
    {
      id: "body-1",
      part: "body",
      narration: "지방 재정 부담을 둘러싼 비판이 커지고 있어.",
      visual: "source",
      sourceId: "primary",
    },
    {
      id: "end-cta",
      part: "outro",
      narration: "댓글로 남겨줘.",
      visual: "source",
      sourceId: "primary",
    },
  ],
} as unknown as NewsClipProject

const image = (id: string, title: string): WikimediaCommonsImage => ({
  id,
  provider: "wikimedia_commons",
  mediaType: "image",
  title,
  titleKo: title,
  titleEn: "",
  descriptionKo: "국회 예산안 본회의",
  descriptionEn: "",
  author: "촬영자",
  mimeType: "image/jpeg",
  width: 2400,
  height: 1600,
  fileSizeBytes: 500_000,
  pageUrl: `https://commons.wikimedia.org/wiki/${id}`,
  downloadUrl: `https://upload.wikimedia.org/${id}.jpg`,
  previewUrl: `https://upload.wikimedia.org/${id}-preview.jpg`,
  license: {
    name: "CC BY-SA 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    usageTerms: "CC BY-SA 4.0",
    attributionRequired: true,
  },
})

test("보도 장면 검색어는 이슈 핵심어와 장면 의미를 함께 쓴다", () => {
  const query = reportVisualAssetQuery(project, project.reportScenes[0]!)
  assert.match(query, /국회/)
  assert.match(query, /예산안/)
  assert.match(query, /본회의장/)
})

test("서두·마무리와 이미 선택한 보조자료 장면은 자동 배치에서 제외한다", () => {
  const withSupporting = {
    ...project,
    supportingSources: [{ id: "manual-source" } as NewsSource],
    reportScenes: project.reportScenes.map((scene, index) =>
      index === 1 ? { ...scene, sourceId: "manual-source" } : scene
    ),
  }
  assert.deepEqual(
    buildReportVisualAssetPlans(withSupporting).map((plan) => plan.sceneId),
    []
  )
  assert.deepEqual(
    buildReportVisualAssetPlans(project).map((plan) => plan.sceneId),
    ["body-1"]
  )
})

test("검색 결과의 제목 일치와 화질을 관련도 점수에 반영한다", () => {
  const relevant = image("relevant", "국회 예산안 본회의")
  const unrelated = image("unrelated", "산 풍경")
  unrelated.descriptionKo = "자연 경관"
  assert.ok(
    scoreReportVisualCandidate(relevant, "국회 예산안", 0) >
      scoreReportVisualCandidate(unrelated, "국회 예산안", 0)
  )
})

test("장면별 검색 실패를 건너뛰고 성공한 공개자료만 배정한다", async () => {
  let call = 0
  const result = await prepareVisualAssetsForPlans(
    [
      { sceneId: "body-1", query: "국회 예산안" },
      { sceneId: "body-2", query: "지방 재정" },
    ],
    {
      searchImages: async () => {
        call += 1
        if (call === 1) throw new Error("temporary")
        return [image("second", "지방 재정 부담")]
      },
      storeImage: async (candidate) =>
        ({
          id: `stored-${candidate.id}`,
          title: candidate.title,
          kind: "web",
          mediaType: "image",
        }) as NewsSource,
    }
  )

  assert.deepEqual(result.assignments, [
    { sceneId: "body-2", sourceId: "stored-second" },
  ])
  assert.equal(result.sources.length, 1)
})

test("검색 순위만 높고 대본 핵심어가 없는 자료는 자동 배치하지 않는다", async () => {
  let stored = false
  const unrelated = image("unrelated", "산과 바다 풍경")
  unrelated.descriptionKo = "자연 풍경"
  const result = await prepareVisualAssetsForPlans(
    [{ sceneId: "body-1", query: "국회 예산안" }],
    {
      searchImages: async () => [unrelated],
      storeImage: async () => {
        stored = true
        return { id: "should-not-store" } as NewsSource
      },
    }
  )

  assert.equal(stored, false)
  assert.deepEqual(result, { sources: [], assignments: [] })
})
