import { NextResponse } from "next/server"

import type { NewsClipProject } from "@/lib/news-clips/types"
import { uploadNewsClipToYoutube } from "@/lib/server/news-clips/youtube-upload"
import {
  validRenderJobId,
  writeNewsRenderProgress,
} from "@/lib/server/news-clips/render-progress"

export const runtime = "nodejs"
export const maxDuration = 180

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    project?: NewsClipProject
    scheduledAt?: string
    jobId?: unknown
  } | null
  if (!body?.project || body.project.type !== "news_clip") {
    return NextResponse.json(
      { message: "업로드할 프로젝트를 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  const jobId = validRenderJobId(body.jobId) ? body.jobId : ""
  try {
    if (jobId) await writeNewsRenderProgress(jobId, 1, "업로드 준비 중")
    return NextResponse.json(
      await uploadNewsClipToYoutube(
        body.project,
        typeof body.scheduledAt === "string" ? body.scheduledAt : "",
        jobId
          ? (percent, label) => writeNewsRenderProgress(jobId, percent, label)
          : undefined
      )
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    const message =
      code === "youtube-not-connected"
        ? "YouTube 채널을 먼저 연결해 주세요."
        : code === "youtube-channel-mismatch"
          ? "연결된 YouTube 채널이 이 뉴스 채널과 다릅니다."
          : code === "video-not-found"
            ? "업로드할 최종 영상이 없습니다."
            : code === "youtube-refresh-failed"
              ? "YouTube 로그인이 만료되었습니다. 다시 연결해 주세요."
              : "YouTube에 업로드하지 못했습니다."
    return NextResponse.json({ message }, { status: 502 })
  }
}
