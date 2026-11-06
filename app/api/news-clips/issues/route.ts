import { NextResponse } from "next/server"

import { newsChannelId } from "@/lib/server/news-clips/channels"
import { discoverRecommendedNewsIssues } from "@/lib/server/news-clips/issues"
import { readNewsClipSettings } from "@/lib/server/news-clips/settings"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const profileId = newsChannelId(url.searchParams.get("profileId"))
  const query = url.searchParams.get("query") ?? ""
  const limit = Number(url.searchParams.get("limit") ?? 5)
  if (!profileId) {
    return NextResponse.json(
      { message: "뉴스 채널을 먼저 선택해 주세요." },
      { status: 400 }
    )
  }
  const settings = await readNewsClipSettings(profileId)
  try {
    const result = await discoverRecommendedNewsIssues(
      query,
      settings.communitySignalsEnabled,
      settings.communityCacheMinutes,
      Number.isFinite(limit) ? limit : 5,
      settings.issueSearchGuidance
    )
    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      { message: "웹 뉴스에서 최근 이슈를 찾지 못했습니다." },
      { status: 502 }
    )
  }
}
