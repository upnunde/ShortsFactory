import { createHash } from "node:crypto"

import { NextResponse } from "next/server"

import { newsRenderSettingsKey } from "@/lib/news-clips/render-key"
import { isPrimarilyKorean } from "@/lib/news-clips/language"
import { scoreSourceRelevance } from "@/lib/news-clips/source-relevance"
import { normalizeSourceAssemblyRanges } from "@/lib/news-clips/source-assembly"
import { analyzeNewsTranscript } from "@/lib/server/news-clips/analyze"
import {
  parseTranscript,
  normalizeKoreanRecognitionText,
  serializeTranscript,
  updateTranscriptSegmentText,
} from "@/lib/news-clips/transcript"
import { selectTranscriptRangeReplacement } from "@/lib/news-clips/transcript-quality"
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
import {
  transcribeRangeWithLocalWhisper,
  transcribeWithLocalWhisper,
} from "@/lib/server/news-clips/whisper"
import { detectAudioSilence } from "@/lib/server/news-clips/vad"
import {
  validRenderJobId,
  writeNewsRenderProgress,
} from "@/lib/server/news-clips/render-progress"
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
    productionMode?: unknown
    directSource?: unknown
    angleTitle?: unknown
    angleSummary?: unknown
    angleKeywords?: unknown
    angleSourceStart?: unknown
    angleSourceEnd?: unknown
    angleSourceRanges?: unknown
    previousTitle?: unknown
    previousTitles?: unknown
    previousScript?: unknown
    jobId?: unknown
  } | null
  const jobId = validRenderJobId(body?.jobId) ? body.jobId : ""
  const progress = (percent: number, label: string) =>
    jobId ? writeNewsRenderProgress(jobId, percent, label) : Promise.resolve()
  await progress(2, "요청 확인 중")
  const productionMode =
    body?.productionMode === "buildup2" ? "buildup2" : "report"
  const directSource = body?.directSource === true
  const angleTitle =
    typeof body?.angleTitle === "string" ? body.angleTitle.trim() : ""
  const angleSummary =
    typeof body?.angleSummary === "string" ? body.angleSummary.trim() : ""
  const angleKeywords = Array.isArray(body?.angleKeywords)
    ? body.angleKeywords
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 8)
    : []
  const angleSourceStart = Number(body?.angleSourceStart)
  const angleSourceEnd = Number(body?.angleSourceEnd)
  const lockedAngleRanges = normalizeSourceAssemblyRanges(
    body?.angleSourceRanges
  )
  const lockedAngleRange = lockedAngleRanges.length
    ? {
        start: lockedAngleRanges[0]!.start,
        end: lockedAngleRanges.at(-1)!.end,
      }
    : Number.isFinite(angleSourceStart) &&
        Number.isFinite(angleSourceEnd) &&
        Math.abs(angleSourceEnd - angleSourceStart) >= 3
      ? {
          start: Math.min(angleSourceStart, angleSourceEnd),
          end: Math.max(angleSourceStart, angleSourceEnd),
        }
      : undefined
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
  await progress(10, "원본 확인 완료")
  const profileId =
    typeof body?.profileId === "string" ? newsChannelId(body.profileId) : ""
  if (!profileId) {
    return NextResponse.json(
      { message: "뉴스 채널을 먼저 선택해 주세요." },
      { status: 400 }
    )
  }
  const settings = await readNewsClipSettings(profileId)
  await progress(15, "설정 확인 완료")
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
  const baseIssueContext = {
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
  const issueContext = angleTitle
    ? {
        title: angleTitle,
        keywords: angleKeywords.length
          ? angleKeywords
          : baseIssueContext.keywords,
        reason: angleSummary || baseIssueContext.reason,
        articleTitles: baseIssueContext.articleTitles,
      }
    : baseIssueContext
  const pasted =
    typeof body?.transcript === "string" ? body.transcript.trim() : ""
  const transcriptKey = pasted
    ? createHash("sha256").update(pasted).digest("hex")
    : "stored-transcript"
  const sourceSetKey = [
    "issue-script-v7-locked-angle-bounds",
    productionMode,
    directSource ? "direct" : "issue",
    sourceId,
    ...supportingSourceIds,
    lockedAngleRange
      ? `${lockedAngleRange.start.toFixed(2)}-${lockedAngleRange.end.toFixed(2)}`
      : "automatic-range",
    ...lockedAngleRanges.map(
      (range) => `${range.start.toFixed(2)}-${range.end.toFixed(2)}`
    ),
    settings.issueSearchGuidance,
    issueContext.title,
    ...issueContext.keywords,
    issueContext.reason,
    ...issueContext.articleTitles,
    transcriptKey,
    typeof body?.supplementalContext === "string"
      ? body.supplementalContext.trim().slice(0, 5000)
      : "",
  ].join(":")
  const supplementalContext =
    typeof body?.supplementalContext === "string"
      ? body.supplementalContext.trim().slice(0, 5000)
      : ""
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
        const refreshedSource = (await readSource(source.id)) ?? source
        await progress(100, "캐시 분석 완료")
        return NextResponse.json({
          ...(cached as object),
          sourceChannel: refreshedSource.channel,
          sourceTitle: refreshedSource.title,
          cached: true,
        })
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
  await progress(30, "원본 자막 준비 완료")
  const transcriptLanguageText = parseTranscript(transcript)
    .map((segment) => segment.text)
    .join(" ")
  if (!isPrimarilyKorean(transcriptLanguageText)) {
    return NextResponse.json(
      {
        message:
          "영어로 작성된 원본은 제외됩니다. 한국어 기사나 영상을 선택해 주세요.",
        unsupportedLanguage: true,
      },
      { status: 422 }
    )
  }
  // URL·파일 직행이거나 사용자가 핵심 각도를 고른 경우 연관도 검사로 막지 않는다.
  if (issueContext.title && !directSource && !angleTitle) {
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
  await progress(38, "관련성 확인 완료")
  try {
    await progress(42, "보조 자료 확인 중")
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
        const supportingSpokenText = parseTranscript(supportingTranscript)
          .map((segment) => segment.text)
          .join(" ")
        if (!isPrimarilyKorean(supportingSpokenText)) return null
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
    await progress(52, "보조 자료 확인 완료")
    const cachedSilences =
      cached &&
      typeof cached === "object" &&
      Array.isArray((cached as { detectedSilences?: unknown }).detectedSilences)
        ? (cached as { detectedSilences: RemovedRange[] }).detectedSilences
        : null
    const detectedSilences = cachedSilences
      ? cachedSilences
      : source.localFile
        ? await detectAudioSilence(source.localFile).catch(() => [])
        : []
    await progress(60, "음성 구간 확인 완료")
    const previousTitle =
      typeof body?.previousTitle === "string" ? body.previousTitle.trim() : ""
    const previousTitles = Array.isArray(body?.previousTitles)
      ? body.previousTitles
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 8)
      : []
    const previousScript =
      typeof body?.previousScript === "string"
        ? body.previousScript.trim().slice(0, 4000)
        : ""
    const avoidPrevious =
      body?.reselect === true &&
      (previousTitle || previousTitles.length || previousScript)
        ? {
            titles: [
              ...new Set([previousTitle, ...previousTitles].filter(Boolean)),
            ].slice(0, 8),
            script: previousScript,
          }
        : undefined
    const analysisContext = {
      primarySourceId: source.id,
      primarySourceTitle: source.title,
      primarySourceSummary: source.summary,
      supportingSources: supportingSources.filter(
        (item): item is NonNullable<typeof item> => Boolean(item)
      ),
      issue: issueContext,
      supplementalContext,
      channelDirection: settings.issueSearchGuidance,
      directSource,
      avoidPrevious,
      lockedRange: lockedAngleRange,
      lockedRanges: lockedAngleRanges,
    }
    let transcriptForAnalysis = transcript
    let refinedRange = lockedAngleRange
    let transcriptRefinementStatus:
      | "not-attempted"
      | "accepted"
      | "retry-accepted"
      | "baseline-retained"
      | "unavailable" = "not-attempted"
    let transcriptNeedsReview = false
    let transcriptQualityReasons: string[] = []
    await progress(66, "핵심 구간 정밀 분석 중")
    if (source.localFile && !pasted && lockedAngleRanges.length <= 1) {
      try {
        if (!refinedRange) {
          const preliminary = await analyzeNewsTranscript(
            transcript,
            settings,
            false,
            analysisContext,
            productionMode,
            detectedSilences
          )
          refinedRange = {
            start: preliminary.selectedCandidate.sourceStart,
            end: preliminary.selectedCandidate.sourceEnd,
          }
        }
        const rangeToRefine = refinedRange
        const baselineSegments = parseTranscript(transcript)
        const precedingBaseline = baselineSegments.filter(
          (segment) => segment.end <= rangeToRefine.start + 0.1
        )
        const normalizeRecognition = (timedText: string) =>
          parseTranscript(timedText).map((segment) =>
            updateTranscriptSegmentText(
              segment,
              normalizeKoreanRecognitionText(segment.text)
            )
          )
        const selectReplacement = (candidate: typeof baselineSegments) =>
          selectTranscriptRangeReplacement({
            candidate,
            baseline: baselineSegments,
            preceding: precedingBaseline,
            range: rangeToRefine,
          })

        const refinedTimedText = await transcribeRangeWithLocalWhisper(
          source.localFile,
          source.id,
          rangeToRefine
        )
        const refinedSegments = normalizeRecognition(refinedTimedText)
        let replacement = selectReplacement(refinedSegments)
        transcriptRefinementStatus = "accepted"

        if (!replacement.accepted) {
          const initialReasons = replacement.assessment.reasons
          await progress(72, "의심 구간 재확인 중")
          const retryTimedText = await transcribeRangeWithLocalWhisper(
            source.localFile,
            source.id,
            rangeToRefine,
            "",
            { paddingSeconds: 7 }
          )
          const retrySegments = normalizeRecognition(retryTimedText)
          replacement = selectReplacement(retrySegments)
          if (replacement.accepted) {
            transcriptRefinementStatus = "retry-accepted"
          } else {
            transcriptRefinementStatus = "baseline-retained"
            transcriptNeedsReview = true
            transcriptQualityReasons = [
              ...new Set([
                ...initialReasons,
                ...replacement.assessment.reasons,
              ]),
            ]
          }
        }

        // 구간 전사가 낮은 신뢰도·앞 문장 재생성·반복 환각으로 의심되면
        // YouTube 자막을 정답으로 간주하지는 않되, 검증되지 않은 결과로
        // 덮어쓰지 않고 기존 기준 전사를 그대로 유지한다.
        if (replacement.accepted) {
          transcriptForAnalysis = serializeTranscript(replacement.transcript)
        }
      } catch {
        // 로컬 2차 전사가 불가능하면 기존 자막으로 계속 진행한다.
        transcriptRefinementStatus = "unavailable"
        transcriptNeedsReview = true
        transcriptQualityReasons = ["range-transcription-unavailable"]
      }
    }
    await progress(80, "대본 작성 중")
    const analysis = await analyzeNewsTranscript(
      transcriptForAnalysis,
      settings,
      body?.useClaude !== false,
      { ...analysisContext, lockedRange: refinedRange },
      productionMode,
      detectedSilences
    )
    await progress(95, "분석 결과 저장 중")
    const refreshedSource = (await readSource(source.id)) ?? source
    const result = {
      ...analysis,
      detectedSilences,
      settingsKey,
      sourceSetKey,
      transcriptRefinementStatus,
      transcriptNeedsReview,
      transcriptQualityReasons,
      sourceChannel: refreshedSource.channel,
      sourceTitle: refreshedSource.title,
    }
    await writeAnalysisCache(sourceId, result)
    await progress(100, "완료")
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
