import { NextResponse } from "next/server"

import type { NewsClipProject, NewsClipSettings } from "@/lib/news-clips/types"
import { renderNewsClip } from "@/lib/server/news-clips/render"
import {
  validRenderJobId,
  writeNewsRenderProgress,
} from "@/lib/server/news-clips/render-progress"
import { newsTtsErrorMessage } from "@/lib/server/news-clips/tts-provider"

export const runtime = "nodejs"
export const maxDuration = 900

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    project?: NewsClipProject
    settings?: NewsClipSettings
    force?: boolean
    jobId?: string
  } | null
  if (!body?.project || !body.settings) {
    return NextResponse.json(
      { message: "미리보기 정보를 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  try {
    const jobId = validRenderJobId(body.jobId) ? body.jobId : ""
    if (jobId) await writeNewsRenderProgress(jobId, 1, "준비 중")
    const result = await renderNewsClip(
      body.project,
      body.settings,
      "preview",
      {
        force: body.force === true,
        signal: request.signal,
        onProgress: jobId
          ? (percent, label) =>
              writeNewsRenderProgress(jobId, percent, label)
          : undefined,
      }
    )
    return NextResponse.json(
      {
        ...result,
        message: "360×640 저해상도 초안을 만들었습니다.",
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "render-cancelled" || request.signal.aborted) {
      return NextResponse.json(
        { message: "미리보기 만들기를 취소했습니다." },
        { status: 499 }
      )
    }
    const ttsMessage = newsTtsErrorMessage(code)
    const message =
      ttsMessage ||
      (code === "source-upload-required"
        ? "승인한 원본을 다운로드하지 못했습니다. 합법적으로 보유한 원본 파일을 올려 주세요."
        : code === "local-tts-unavailable"
          ? "이 컴퓨터에서 무료 한국어 음성 기능을 사용할 수 없습니다."
          : code === "local-tts-failed"
            ? "무료 한국어 아나운서 음성을 만들지 못했습니다."
            : code === "invalid-channel"
              ? "뉴스 채널 정보가 올바르지 않습니다."
              : code === "invalid-project-id"
                ? "프로젝트 ID가 올바르지 않습니다."
                : code === "source-not-approved"
                  ? "승인된 원본 영상이 필요합니다."
                  : code === "title-required"
                    ? "인트로 제목을 입력해 주세요."
                    : code === "title-second-line-required"
                      ? "인트로 제목 2단을 입력해 주세요."
                      : code === "title-first-line-overflow" ||
                          code === "title-second-line-overflow"
                        ? "인트로 제목 폭이 초과됐습니다. 길이를 줄여 주세요."
                        : code === "report-script-required"
                          ? "보도 대본을 입력해 주세요."
                          : code === "report-scenes-required"
                            ? "화면 구성 장면이 없습니다. 대본을 저장해 장면을 만들어 주세요."
                            : code === "report-scene-narration-required"
                              ? "나레이션이 비어 있는 장면이 있습니다."
                              : code === "report-scene-quote-range-invalid"
                                ? "직접 발언 장면의 원본 구간이 올바르지 않습니다."
                                : code === "invalid-project"
                                  ? "제목, 보도 대본과 문장별 화면 구성을 확인해 주세요."
                                  : code.startsWith("output-validation-")
                                    ? "초안의 영상·음성 동기화 검사를 통과하지 못했습니다. 초안을 다시 만들어 주세요."
                                    : "저해상도 초안을 만들지 못했습니다.")
    return NextResponse.json({ message }, { status: 422 })
  }
}
