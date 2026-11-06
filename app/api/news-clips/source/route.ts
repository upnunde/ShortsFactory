import { NextResponse } from "next/server"

import type { NewsCandidateMetrics } from "@/lib/news-clips/types"
import { newsChannelId } from "@/lib/server/news-clips/channels"
import {
  confirmCommunityIssues,
  readPublicCommunityIssues,
} from "@/lib/server/news-clips/community"
import { readNewsClipSettings } from "@/lib/server/news-clips/settings"
import { searchRecentNews } from "@/lib/server/news-clips/search"
import { readYouTubeDataKey } from "@/lib/server/credentials"
import {
  createRemoteSource,
  createUploadedSource,
  downloadApprovedSource,
} from "@/lib/server/news-clips/source-store"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = url.searchParams.get("query") ?? ""
  const topic = url.searchParams.get("topic") ?? query
  const keywords = (url.searchParams.get("keywords") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8)
  const profileId = url.searchParams.get("profileId") ?? ""
  if (!newsChannelId(profileId)) {
    return NextResponse.json(
      { message: "뉴스 채널을 먼저 선택해 주세요." },
      { status: 400 }
    )
  }
  const settings = await readNewsClipSettings(profileId)
  try {
    const community = await readPublicCommunityIssues(
      settings.communitySignalsEnabled,
      settings.communityCacheMinutes
    )
    const results = await searchRecentNews(
      query,
      settings.preferredChannels,
      community.issues,
      { title: topic, keywords }
    )
    const confirmedCommunityIssues = confirmCommunityIssues(
      community.issues,
      results
    )
    const youtubeDataKey = await readYouTubeDataKey()
    return NextResponse.json({
      results,
      configured: Boolean(youtubeDataKey),
      preferredChannelCount: settings.preferredChannels.filter(
        (channel) => channel.enabled && channel.youtubeChannelId
      ).length,
      searchScope: "youtube",
      community: {
        status: community.status,
        issues: confirmedCommunityIssues.slice(0, 5),
      },
    })
  } catch {
    return NextResponse.json(
      { message: "최근 영상을 검색하지 못했습니다." },
      { status: 502 }
    )
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData()
      const file = form.get("file")
      const subtitle = form.get("subtitle")
      if (!(file instanceof File)) {
        return NextResponse.json(
          { message: "원본 영상 파일을 선택해 주세요." },
          { status: 400 }
        )
      }
      const source = await createUploadedSource({
        file,
        subtitle: subtitle instanceof File ? subtitle : null,
        title: String(form.get("title") ?? ""),
        channel: String(form.get("channel") ?? ""),
        originalUrl: String(form.get("originalUrl") ?? ""),
      })
      return NextResponse.json(source)
    }
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body || typeof body.url !== "string") {
      return NextResponse.json(
        { message: "영상 URL을 입력해 주세요." },
        { status: 400 }
      )
    }
    const source = await createRemoteSource({
      url: body.url,
      title: typeof body.title === "string" ? body.title : "",
      channel: typeof body.channel === "string" ? body.channel : "",
      summary: typeof body.summary === "string" ? body.summary : "",
      kind: body.kind === "search" ? "search" : "youtube",
      publishedAt: typeof body.publishedAt === "string" ? body.publishedAt : "",
      durationSeconds:
        typeof body.durationSeconds === "number" ? body.durationSeconds : 0,
      viewCount: typeof body.viewCount === "number" ? body.viewCount : 0,
      commentCount:
        typeof body.commentCount === "number" ? body.commentCount : 0,
      searchMetrics:
        body.searchMetrics && typeof body.searchMetrics === "object"
          ? (body.searchMetrics as NewsCandidateMetrics)
          : null,
    })
    return NextResponse.json(
      (await downloadApprovedSource(source.id)) ?? source
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    const message =
      code === "invalid-url"
        ? "http 또는 https 영상 URL만 사용할 수 있습니다."
        : "mp4, mov, mkv, webm 영상과 srt, vtt 자막을 확인해 주세요."
    return NextResponse.json({ message }, { status: 400 })
  }
}
