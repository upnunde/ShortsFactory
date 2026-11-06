import { NextResponse } from "next/server"

import { newsRenderSettingsKey } from "@/lib/news-clips/render-key"
import { isPrimarilyKorean } from "@/lib/news-clips/language"
import { scoreSourceRelevance } from "@/lib/news-clips/source-relevance"
import { analyzeNewsTranscript } from "@/lib/server/news-clips/analyze"
import { parseTranscript } from "@/lib/news-clips/transcript"
import { newsChannelId } from "@/lib/server/news-clips/channels"
import { readNewsClipSettings } from "@/lib/server/news-clips/settings"
import {
  downloadApprovedSource,
  readAnalysisCache,
  readSource,
  readStoredTranscript,
  writeAnalysisCache,
  writeStoredTranscript,
} from "@/lib/server/news-clips/source-store"
import { transcribeWithLocalWhisper } from "@/lib/server/news-clips/whisper"
import { detectAudioSilence } from "@/lib/server/news-clips/vad"
import type { RemovedRange } from "@/lib/news-clips/types"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sourceId?: unknown
    profileId?: unknown
    transcript?: unknown
    useClaude?: unknown
    reselect?: unknown
    supportingSourceIds?: unknown
    issueTitle?: unknown
    issueKeywords?: unknown
    issueReason?: unknown
    issueArticleTitles?: unknown
    supplementalContext?: unknown
  } | null
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
  const profileId =
    typeof body?.profileId === "string" ? newsChannelId(body.profileId) : ""
  if (!profileId) {
    return NextResponse.json(
      { message: "뉴스 채널을 먼저 선택해 주세요." },
      { status: 400 }
    )
  }
  const settings = await readNewsClipSettings(profileId)
  const settingsKey = newsRenderSettingsKey(settings)
  const supportingSourceIds = Array.isArray(body?.supportingSourceIds)
    ? [
        ...new Set(
          body.supportingSourceIds.filter(
            (value): value is string =>
              typeof value === "string" && value !== sourceId
          )
        ),
      ].slice(0, 8)
    : []
  const issueContext = {
    title: typeof body?.issueTitle === "string" ? body.issueTitle.trim() : "",
    keywords: Array.isArray(body?.issueKeywords)
      ? body.issueKeywords
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [],
    reason:
      typeof body?.issueReason === "string"
        ? body.issueReason.trim().slice(0, 300)
        : "",
    articleTitles: Array.isArray(body?.issueArticleTitles)
      ? body.issueArticleTitles
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
  }
  const sourceSetKey = [
    "issue-script-v3",
    sourceId,
    ...supportingSourceIds,
    settings.issueSearchGuidance,
    issueContext.title,
    ...issueContext.keywords,
    issueContext.reason,
    ...issueContext.articleTitles,
    typeof body?.supplementalContext === "string"
      ? body.supplementalContext.trim().slice(0, 5000)
      : "",
  ].join(":")
  const supplementalContext =
    typeof body?.supplementalContext === "string"
      ? body.supplementalContext.trim().slice(0, 5000)
      : ""
  const pasted =
    typeof body?.transcript === "string" ? body.transcript.trim() : ""
  const cached = await readAnalysisCache(sourceId)
  if (body?.reselect !== true) {
    if (
      cached &&
      typeof cached === "object" &&
      typeof (cached as { reportScript?: unknown }).reportScript === "string" &&
      Array.isArray((cached as { reportScenes?: unknown }).reportScenes) &&
      (cached as { settingsKey?: unknown }).settingsKey === settingsKey &&
      (cached as { sourceSetKey?: unknown }).sourceSetKey === sourceSetKey
    ) {
      const cachedTranscript = Array.isArray(
        (cached as { transcript?: unknown }).transcript
      )
        ? (cached as { transcript: Array<{ text?: unknown }> }).transcript
            .map((segment) =>
              typeof segment?.text === "string" ? segment.text : ""
            )
            .join(" ")
        : ""
      if (isPrimarilyKorean(cachedTranscript)) {
        return NextResponse.json({ ...(cached as object), cached: true })
      }
    }
  }
  let transcript = pasted || (await readStoredTranscript(sourceId)) || ""
  if (!transcript && source.localFile) {
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
          "원본 자막에 접근할 수 없고 로컬 Whisper도 사용할 수 없습니다. srt/vtt 자막을 함께 올리거나 자막을 붙여넣어 주세요.",
        needsTranscript: true,
      },
      { status: 422 }
    )
  }
  if (!isPrimarilyKorean(transcript)) {
    return NextResponse.json(
      {
        message:
          "영어로 작성된 원본은 제외됩니다. 한국어 기사나 영상을 선택해 주세요.",
        unsupportedLanguage: true,
      },
      { status: 422 }
    )
  }
  if (issueContext.title) {
    const relevance = scoreSourceRelevance(issueContext, {
      title: source.title,
      description: source.summary,
      transcriptExcerpt: transcript,
      publishedAt: source.publishedAt,
    })
    if (!relevance.passes || relevance.transcriptMatches.length === 0) {
      return NextResponse.json(
        {
          message:
            "실제 자막을 확인한 결과 선택한 이슈와 직접 관련된 발언을 찾지 못했습니다. 다른 자료를 선택해 주세요.",
          relevanceScore: relevance.score,
          unsupportedRelevance: true,
        },
        { status: 422 }
      )
    }
  }
  try {
    const supportingSources = await Promise.all(
      supportingSourceIds.map(async (supportingSourceId) => {
        let supporting = await readSource(supportingSourceId)
        if (!supporting?.approved) return null
        if (supporting.requiresUpload && supporting.originalUrl) {
          supporting =
            (await downloadApprovedSource(supportingSourceId)) ?? supporting
        }
        if (!supporting.localFile) return null
        let supportingTranscript =
          (await readStoredTranscript(supportingSourceId)) ?? ""
        if (!supportingTranscript && supporting.localFile) {
          try {
            supportingTranscript = await transcribeWithLocalWhisper(
              supporting.localFile,
              supporting.id
            )
            await writeStoredTranscript(supporting.id, supportingTranscript)
          } catch {
            supportingTranscript = ""
          }
        }
        if (!isPrimarilyKorean(supportingTranscript)) return null
        if (issueContext.title) {
          const relevance = scoreSourceRelevance(issueContext, {
            title: supporting.title,
            description: supporting.summary,
            transcriptExcerpt: supportingTranscript,
            publishedAt: supporting.publishedAt,
          })
          if (!relevance.passes || relevance.transcriptMatches.length === 0)
            return null
        }
        return {
          id: supporting.id,
          title: supporting.title,
          summary: supporting.summary,
          transcript: parseTranscript(supportingTranscript),
        }
      })
    )
    const cachedSilences =
      cached &&
      typeof cached === "object" &&
      Array.isArray((cached as { detectedSilences?: unknown }).detectedSilences)
        ? (cached as { detectedSilences: RemovedRange[] }).detectedSilences
        : null
    const [analysis, detectedSilences] = await Promise.all([
      analyzeNewsTranscript(transcript, settings, body?.useClaude !== false, {
        primarySourceId: source.id,
        primarySourceTitle: source.title,
        primarySourceSummary: source.summary,
        supportingSources: supportingSources.filter(
          (item): item is NonNullable<typeof item> => Boolean(item)
        ),
        issue: issueContext,
        supplementalContext,
        channelDirection: settings.issueSearchGuidance,
      }),
      cachedSilences
        ? Promise.resolve(cachedSilences)
        : source.localFile
          ? detectAudioSilence(source.localFile).catch(() => [])
          : Promise.resolve([]),
    ])
    const result = {
      ...analysis,
      detectedSilences,
      settingsKey,
      sourceSetKey,
    }
    await writeAnalysisCache(sourceId, result)
    return NextResponse.json({ ...result, cached: false })
  } catch (error) {
    if (error instanceof Error && error.message === "issue-focus-mismatch") {
      return NextResponse.json(
        {
          message:
            "선택한 이슈의 핵심 논점과 원본 근거가 충분히 맞지 않습니다. 이슈에 더 가까운 원본을 다시 선택해 주세요.",
          unsupportedIssueFocus: true,
        },
        { status: 422 }
      )
    }
    return NextResponse.json(
      { message: "자막에서 발언 구간을 분석하지 못했습니다." },
      { status: 422 }
    )
  }
}
