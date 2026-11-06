import { NextResponse } from "next/server"

import type { NewsClipProject, NewsClipSettings } from "@/lib/news-clips/types"
import { renderNewsClip } from "@/lib/server/news-clips/render"
import { newsTtsErrorMessage } from "@/lib/server/news-clips/tts-provider"

export const runtime = "nodejs"
export const maxDuration = 900

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    project?: NewsClipProject
    settings?: NewsClipSettings
    force?: boolean
  } | null
  if (!body?.project || !body.settings) {
    return NextResponse.json(
      { message: "미리보기 정보를 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  try {
    const result = await renderNewsClip(
      body.project,
      body.settings,
      "preview",
      {
        force: body.force === true,
      }
    )
    return NextResponse.json(
      {
        ...result,
        message: "540×960 저해상도 초안을 만들었습니다.",
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    const ttsMessage = newsTtsErrorMessage(code)
    const message =
      ttsMessage ||
      (code === "source-upload-required"
        ? "승인한 원본을 다운로드하지 못했습니다. 합법적으로 보유한 원본 파일을 올려 주세요."
        : code === "local-tts-unavailable"
          ? "이 컴퓨터에서 무료 한국어 음성 기능을 사용할 수 없습니다."
          : code === "local-tts-failed"
            ? "무료 한국어 아나운서 음성을 만들지 못했습니다."
            : code === "invalid-duration"
              ? "초안 길이는 제목 프레임을 포함해 59초 미만이어야 합니다."
              : code === "invalid-project"
                ? "제목, 보도 대본과 문장별 화면 구성을 확인해 주세요."
                : "저해상도 초안을 만들지 못했습니다.")
    return NextResponse.json({ message }, { status: 422 })
  }
}
