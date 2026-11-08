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
      { message: "렌더링 정보를 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  try {
    const result = await renderNewsClip(body.project, body.settings, "final", {
      force: body.force === true,
    })
    return NextResponse.json(
      {
        ...result,
        message: "영상, 자막, 제목 프레임, 썸네일과 제작 기록을 생성했습니다.",
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    const ttsMessage = newsTtsErrorMessage(code)
    const message =
      ttsMessage ||
      (code === "source-upload-required"
        ? "URL만으로는 렌더링할 수 없습니다. 합법적으로 보유한 원본 영상 파일을 올려 주세요."
        : code === "local-tts-unavailable"
          ? "이 컴퓨터에서 무료 한국어 음성 기능을 사용할 수 없습니다."
          : code === "local-tts-failed"
            ? "무료 한국어 아나운서 음성을 만들지 못했습니다."
            : code === "preview-revision-stale"
              ? "현재 수정본으로 미리보기를 먼저 만들어 확인해 주세요."
              : code === "invalid-project"
                ? "제목, 보도 대본과 문장별 화면 구성을 먼저 확인해 주세요."
                : code.startsWith("output-validation-")
                  ? "완성 영상의 음성·자막 동기화 검사를 통과하지 못했습니다. 출력을 다시 만들어 주세요."
                  : "FFmpeg 최종 렌더링을 완료하지 못했습니다.")
    return NextResponse.json({ message }, { status: 422 })
  }
}
