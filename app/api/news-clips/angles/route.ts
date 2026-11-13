import { NextResponse } from "next/server"

import { isPrimarilyKorean } from "@/lib/news-clips/language"
import { parseTranscript } from "@/lib/news-clips/transcript"
import { transcriptHasExplicitTimestamps } from "@/lib/news-clips/transcript-storage"
import { extractNewsAngles } from "@/lib/server/news-clips/angles"
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
import { extractVideoSummaryPlan } from "@/lib/server/news-clips/video-summary"
import { videoSummaryPlanToAngleOptions } from "@/lib/news-clips/video-summary"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sourceId?: unknown
    profileId?: unknown
    productionMode?: unknown
    sourceSelectionMode?: unknown
    issueTitle?: unknown
    directSource?: unknown
    focus?: unknown
  } | null
  const productionMode =
    body?.productionMode === "buildup2" ? "buildup2" : "report"
  const sourceSelectionMode =
    productionMode === "buildup2" &&
    body?.sourceSelectionMode === "video-summary"
      ? "video-summary"
      : "single-range"
  const directSource = body?.directSource === true
  const focus =
    typeof body?.focus === "string" ? body.focus.trim().slice(0, 300) : ""
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
  // 원본 SRT/VTT가 있으면 전체 영상 Whisper 캐시로 덮어쓰지 않는다.
  // 빌드업형인데 시간 정보가 전혀 없을 때만 단어 시간 STT를 만든다.
  if (
    productionMode === "buildup2" &&
    source.localFile &&
    !transcriptHasExplicitTimestamps(transcript)
  ) {
    try {
      transcript = await transcribeWithLocalWhisper(source.localFile, source.id)
      await writeStoredTranscript(source.id, transcript)
    } catch {
      // 로컬 Whisper를 쓸 수 없을 때만 첨부/플랫폼 자막으로 계속한다.
    }
  }
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
  const parsedTranscript = parseTranscript(transcript)
  const spokenText = parsedTranscript.map((segment) => segment.text).join(" ")
  if (!isPrimarilyKorean(spokenText)) {
    return NextResponse.json(
      {
        message:
          "영어로 작성된 원본은 제외됩니다. 한국어 기사나 영상을 선택해 주세요.",
      },
      { status: 422 }
    )
  }
  try {
    if (sourceSelectionMode === "video-summary") {
      const plan = await extractVideoSummaryPlan(transcript, {
        sourceId: source.id,
        sourceTitle: source.title,
      })
      const angles = videoSummaryPlanToAngleOptions(plan)
      if (angles.length === 0) {
        return NextResponse.json(
          { message: "전체 영상에서 요약 후보를 찾지 못했습니다." },
          { status: 422 }
        )
      }
      const detectedSilences = await detectAudioSilence(source.localFile).catch(
        () => []
      )
      return NextResponse.json({
        transcript: parsedTranscript,
        angles,
        sourceOverview: plan.overallSummary,
        detectedSilences,
        sourceChannel: source.channel,
        sourceTitle: source.title,
      })
    }
    const angles = await extractNewsAngles(transcript, {
      productionMode,
      sourceTitle: source.title,
      issueTitle:
        typeof body?.issueTitle === "string" ? body.issueTitle.trim() : "",
      directSource,
      focus,
    })
    if (angles.length === 0) {
      return NextResponse.json(
        { message: "원본에서 선택할 핵심 내용을 찾지 못했습니다." },
        { status: 422 }
      )
    }
    const detectedSilences = await detectAudioSilence(source.localFile).catch(
      () => []
    )
    return NextResponse.json({
      transcript: parsedTranscript,
      angles,
      detectedSilences,
      sourceChannel: source.channel,
      sourceTitle: source.title,
    })
  } catch {
    return NextResponse.json(
      {
        message:
          sourceSelectionMode === "video-summary"
            ? "영상 전체 요약을 만들지 못했습니다. 다시 분석해 주세요."
            : "핵심 각도를 만들지 못했습니다.",
      },
      { status: 500 }
    )
  }
}
