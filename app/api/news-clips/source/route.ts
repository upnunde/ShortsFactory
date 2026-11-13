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
  validRenderJobId,
  writeNewsRenderProgress,
} from "@/lib/server/news-clips/render-progress"
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
          { message: "이미지 또는 영상 파일을 선택해 주세요." },
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
    const jobId = validRenderJobId(body.jobId) ? body.jobId : ""
    const progress = (percent: number, label: string) =>
      jobId ? writeNewsRenderProgress(jobId, percent, label) : Promise.resolve()
    await progress(2, "URL 확인 중")
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
    await progress(5, "영상 준비 중")
    const downloaded = await downloadApprovedSource(source.id, {
      onProgress: (percent) =>
        progress(5 + Math.round(percent * 0.88), `영상 받는 중 ${percent}%`),
    })
    if (!downloaded?.localFile || downloaded.requiresUpload) {
      throw new Error("video-download-failed")
    }
    await progress(100, "영상 확인 완료")
    return NextResponse.json(downloaded)
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (
      code === "video-unavailable" ||
      code === "video-download-failed" ||
      code === "video-downloader-unavailable"
    ) {
      const message =
        code === "video-unavailable"
          ? "비공개·연령 제한 또는 재생할 수 없는 영상입니다. 다른 공개 URL을 입력해 주세요."
          : code === "video-downloader-unavailable"
            ? "YouTube 영상 도구를 실행하지 못했습니다. 잠시 후 다시 시도해 주세요."
            : "YouTube 영상을 받지 못했습니다. URL을 확인하거나 영상 파일을 올려 주세요."
      return NextResponse.json({ message }, { status: 422 })
    }
    const message =
      code === "invalid-url"
        ? "http 또는 https 영상 URL만 사용할 수 있습니다."
        : code === "image-conversion-failed"
          ? "이미지를 영상 화면으로 변환하지 못했습니다. 다른 파일을 선택해 주세요."
          : "jpg, png, webp 이미지 또는 mp4, mov, mkv, webm 영상을 확인해 주세요."
    return NextResponse.json({ message }, { status: 400 })
  }
}
