import { NextResponse } from "next/server"

import {
  prepareVisualAssetsForPlans,
  type ReportVisualAssetPlan,
} from "@/lib/server/news-clips/visual-assets"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    queries?: unknown
  } | null
  const queries = normalizeQueries(body?.queries)
  if (!queries.length) {
    return NextResponse.json(
      { message: "시각자료 검색어를 읽을 수 없습니다." },
      { status: 400 }
    )
  }

  const result = await prepareVisualAssetsForPlans(queries)
  return NextResponse.json({
    ...result,
    message: result.sources.length
      ? `공개 라이선스 자료 ${result.sources.length}개를 준비했습니다.`
      : "조건에 맞는 공개 자료를 찾지 못해 기존 자료로 계속합니다.",
  })
}

function normalizeQueries(value: unknown): ReportVisualAssetPlan[] {
  if (!Array.isArray(value)) return []
  const seenScenes = new Set<string>()
  return value.slice(0, 4).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as { sceneId?: unknown; query?: unknown }
    const sceneId =
      typeof record.sceneId === "string"
        ? record.sceneId.trim().slice(0, 120)
        : ""
    const query =
      typeof record.query === "string"
        ? record.query.replace(/\s+/g, " ").trim().slice(0, 160)
        : ""
    if (!sceneId || !query || seenScenes.has(sceneId)) return []
    seenScenes.add(sceneId)
    return [{ sceneId, query }]
  })
}
