import { NextResponse } from "next/server"

import { isPrimarilyKorean } from "@/lib/news-clips/language"
import { extractNewsAngles } from "@/lib/server/news-clips/angles"
import { parseTranscript } from "@/lib/news-clips/transcript"
import { newsChannelId } from "@/lib/server/news-clips/channels"
import { readNewsClipSettings } from "@/lib/server/news-clips/settings"
import {
  downloadApprovedSource,
  readSource,
  readStoredTranscript,
  writeStoredTranscript,
} from "@/lib/server/news-clips/source-store"
import { transcribeWithLocalWhisper } from "@/lib/server/news-clips/whisper"
import { detectAudioSilence } from "@/lib/server/news-clips/vad"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sourceId?: unknown
    profileId?: unknown
    productionMode?: unknown
    issueTitle?: unknown
    directSource?: unknown
  } | null
  const productionMode =
    body?.productionMode === "buildup" ? "buildup" : "report"
  const directSource = body?.directSource === true
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : ""
  let source = await readSource(sourceId)
  if (!source || !source.approved) {
    return NextResponse.json(
      { message: "먼저 원본 영상을 승인해 주세요." },
      { status: 400 }
    )
  }
  if (source.requiresUpload && source.originalUrl) {
    source = (await downloadApprovedSource(sourceId)) ?? source
  }
  if (!source.localFile) {
    return NextResponse.json(
      { message: "원본 영상 파일이 없습니다." },
      { status: 422 }
    )
  }
  await readNewsClipSettings(newsChannelId(body?.profileId))
  let transcript = (await readStoredTranscript(sourceId)) || ""
  if (!transcript) {
    try {
      transcript = await transcribeWithLocalWhisper(source.localFile, source.id)
      await writeStoredTranscript(source.id, transcript)
    } catch {
      transcript = ""
    }
  }
  if (!transcript) {
    return NextResponse.json(
      {
        message:
          "원본 자막에 접근할 수 없습니다. 자막을 함께 올리거나 다시 시도해 주세요.",
      },
      { status: 422 }
    )
  }
  if (!isPrimarilyKorean(transcript)) {
    return NextResponse.json(
      {
        message:
          "영어로 작성된 원본은 제외됩니다. 한국어 기사나 영상을 선택해 주세요.",
      },
      { status: 422 }
    )
  }
  try {
    const angles = await extractNewsAngles(transcript, {
      productionMode,
      sourceTitle: source.title,
      issueTitle:
        typeof body?.issueTitle === "string" ? body.issueTitle.trim() : "",
      directSource,
    })
    if (angles.length < 3) {
      return NextResponse.json(
        { message: "원본에서 핵심 각도를 충분히 뽑지 못했습니다." },
        { status: 422 }
      )
    }
    const detectedSilences = await detectAudioSilence(source.localFile).catch(
      () => []
    )
    return NextResponse.json({
      transcript: parseTranscript(transcript),
      angles,
      detectedSilences,
      sourceChannel: source.channel,
      sourceTitle: source.title,
    })
  } catch {
    return NextResponse.json(
      { message: "핵심 각도를 만들지 못했습니다." },
      { status: 500 }
    )
  }
}
