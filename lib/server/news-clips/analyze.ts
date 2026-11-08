import { claudeText } from "@/lib/server/anthropic"
import {
  buildCandidateWindows,
  buildCompleteUtteranceCandidates,
  fitEditPlan,
} from "@/lib/news-clips/timeline"
import {
  issueAngleTerms,
  scriptMatchesIssueFocus,
  type NewsIssueFocus,
} from "@/lib/news-clips/issue-focus"
import {
  fitTitleToLineLayouts,
  titleLineCharacterLimit,
} from "@/lib/news-clips/text-layout"
import { parseTranscript } from "@/lib/news-clips/transcript"
import {
  buildBuildup2Scenes,
  localBuildup2Draft,
} from "@/lib/news-clips/buildup"
import {
  appendEndCtaScenes,
  buildReportScenes,
  ensureReportEndCta,
  isEndCtaScene,
  normalizeQuoteScenes,
  splitEndCtaFromScript,
} from "@/lib/news-clips/report"
import type {
  NewsClipCandidate,
  NewsClipProductionMode,
  NewsClipSettings,
  NewsReportScene,
  RemovedRange,
  TranscriptSegment,
} from "@/lib/news-clips/types"

const REPORT_MIN_CHARACTERS = 288
const REPORT_TARGET_CHARACTERS = 312
const REPORT_MAX_CHARACTERS = 320

export type NewsAnalysisSource = {
  id: string
  title: string
  summary: string
  transcript: TranscriptSegment[]
}

export type NewsAnalysisSourceContext = {
  primarySourceId: string
  primarySourceTitle: string
  primarySourceSummary: string
  supportingSources: NewsAnalysisSource[]
  issue: NewsIssueFocus
  supplementalContext: string
  channelDirection: string
  directSource?: boolean
  /** 재작성 시 재탕 금지용. 있으면 새 표현으로 다시 쓴다. */
  avoidPrevious?: {
    titles?: string[]
    script?: string
  }
  /** 주제고르기에서 확정한 원본 구간. 있으면 하이라이트를 이 구간으로 고정한다. */
  lockedRange?: {
    start: number
    end: number
  }
}

export async function analyzeNewsTranscript(
  transcriptText: string,
  settings: NewsClipSettings,
  useClaude = true,
  sourceContext: NewsAnalysisSourceContext = {
    primarySourceId: "",
    primarySourceTitle: "",
    primarySourceSummary: "",
    supportingSources: [],
    issue: { title: "", keywords: [] },
    supplementalContext: "",
    channelDirection: "",
  },
  productionMode: NewsClipProductionMode = "report",
  detectedSilences: RemovedRange[] = []
) {
  const transcript = parseTranscript(transcriptText)
  if (transcript.length === 0) throw new Error("empty-transcript")
  const localCandidates =
    productionMode === "buildup2"
      ? buildCompleteUtteranceCandidates(transcript)
      : buildCandidateWindows(transcript, settings)
  if (localCandidates.length === 0) throw new Error("no-candidates")
  let candidates = fitCandidateTitles(localCandidates, settings)
  let analysisMode: "claude" | "local" = "local"
  if (useClaude) {
    try {
      candidates = fitCandidateTitles(
        await refineWithClaude(
          transcript,
          localCandidates,
          settings,
          sourceContext.issue,
          sourceContext.supplementalContext,
          sourceContext.directSource === true
            ? ""
            : sourceContext.channelDirection,
          sourceContext.directSource === true,
          sourceContext.avoidPrevious?.titles ?? []
        ),
        settings
      )
      analysisMode = "claude"
    } catch {
      candidates = fitCandidateTitles(localCandidates, settings)
    }
  }
  const selectedCandidate = lockCandidateToAngleRange(
    bestCandidate(candidates, sourceContext.issue),
    transcript,
    sourceContext.lockedRange
  )
  if (productionMode === "buildup2") {
    return analyzeBuildup2Transcript(
      transcript,
      selectedCandidate,
      candidates,
      settings,
      sourceContext,
      useClaude,
      analysisMode,
      detectedSilences
    )
  }
  const editPlan = fitEditPlan({
    segments: transcript,
    start: selectedCandidate.sourceStart,
    end: selectedCandidate.sourceEnd,
    silenceRanges: detectedSilences,
    titleSeconds: settings.titleCardSeconds,
    targetMinSeconds: settings.targetMinSeconds,
    targetMaxSeconds: settings.targetMaxSeconds,
    idealMinSeconds: settings.idealMinSeconds,
    idealMaxSeconds: settings.idealMaxSeconds,
  })
  const windowStart =
    editPlan.keepRanges[0]?.sourceStart ?? selectedCandidate.sourceStart
  const windowEnd =
    editPlan.keepRanges.at(-1)?.sourceEnd ?? selectedCandidate.sourceEnd
  let report = localReport(transcript, {
    ...selectedCandidate,
    sourceStart: windowStart,
    sourceEnd: windowEnd,
  })
  try {
    if (useClaude) {
      report = await reportWithClaude(
        transcript,
        {
          ...selectedCandidate,
          sourceStart: windowStart,
          sourceEnd: windowEnd,
        },
        settings,
        sourceContext
      )
      analysisMode = "claude"
    }
  } catch (error) {
    if (error instanceof Error && error.message === "issue-focus-mismatch") {
      throw error
    }
    report = localReport(transcript, {
      ...selectedCandidate,
      sourceStart: windowStart,
      sourceEnd: windowEnd,
    })
  }
  const reportScript = ensureReportEndCta(
    report.script,
    sourceContext.issue.title,
    sourceContext.issue.keywords
  )
  const { body: bodyScript, cta: endCtaText } =
    splitEndCtaFromScript(reportScript)
  const reportScenes = appendEndCtaScenes(
    buildReportScenes(
      bodyScript || reportScript,
      transcript,
      windowStart,
      windowEnd,
      report.preferred,
      sourceContext.primarySourceId
    ),
    endCtaText,
    sourceContext.primarySourceId
  )
  const distributedScenes = distributeSupportingSources(
    reportScenes,
    sourceContext
  )
  const transcripts = Object.fromEntries([
    [sourceContext.primarySourceId, transcript],
    ...sourceContext.supportingSources.map(
      (source) => [source.id, source.transcript] as const
    ),
  ])
  // 인트로 제목은 refineWithClaude titleOptions를 유지한다.
  // 대본 생성 후 제목을 다시 쓰면 주제고르기에서 고른 톤이 바뀐다.
  const rangedCandidate = {
    ...selectedCandidate,
    sourceStart: windowStart,
    sourceEnd: windowEnd,
  }
  return {
    transcript,
    candidates: replaceCandidate(candidates, rangedCandidate),
    selectedCandidate: rangedCandidate,
    reportScript,
    reportScenes: normalizeQuoteScenes(
      distributedScenes,
      transcripts,
      sourceContext.primarySourceId,
      settings.titleVoiceRate
    ),
    removedRanges: editPlan.removedRanges,
    keepRanges: editPlan.keepRanges,
    analysisMode,
  }
}

async function analyzeBuildup2Transcript(
  transcript: TranscriptSegment[],
  selectedCandidate: NewsClipCandidate,
  candidates: NewsClipCandidate[],
  settings: NewsClipSettings,
  sourceContext: NewsAnalysisSourceContext,
  useClaude: boolean,
  analysisMode: "claude" | "local",
  detectedSilences: RemovedRange[]
) {
  let draft = localBuildup2Draft(
    transcript,
    selectedCandidate,
    settings,
    detectedSilences,
    sourceContext.primarySourceId
  )
  let mode = analysisMode
  if (useClaude) {
    try {
      const claudeDraft = await buildup2WithClaude(
        transcript,
        selectedCandidate,
        sourceContext
      )
      const locked = sourceContext.lockedRange
      const highlightStart = locked
        ? Math.min(locked.start, locked.end)
        : claudeDraft.highlightStart
      const highlightEnd = locked
        ? Math.max(locked.start, locked.end)
        : claudeDraft.highlightEnd
      draft = {
        ...draft,
        script: claudeDraft.script,
        preferred: buildBuildup2Scenes(
          claudeDraft.script,
          highlightStart,
          highlightEnd,
          transcript,
          sourceContext.primarySourceId,
          claudeDraft.preferred
        ),
      }
      mode = "claude"
    } catch {
      // keep local draft
    }
  }
  const reportScript = ensureReportEndCta(
    draft.script,
    sourceContext.issue.title,
    sourceContext.issue.keywords
  )
  const { body: bodyScript, cta: endCtaText } =
    splitEndCtaFromScript(reportScript)
  const locked = sourceContext.lockedRange
  const highlightStart = locked
    ? Math.min(locked.start, locked.end)
    : (draft.preferred[1]?.sourceStart ?? selectedCandidate.sourceStart)
  const highlightEnd = locked
    ? Math.max(locked.start, locked.end)
    : (draft.preferred[1]?.sourceEnd ?? selectedCandidate.sourceEnd)
  const reportScenes = appendEndCtaScenes(
    buildBuildup2Scenes(
      bodyScript || reportScript,
      highlightStart,
      highlightEnd,
      transcript,
      sourceContext.primarySourceId,
      draft.preferred
    ),
    endCtaText,
    sourceContext.primarySourceId
  )
  const completedHighlight = reportScenes.find(
    (scene) => scene.id === "buildup2-quote"
  )
  const completedStart =
    completedHighlight?.sourceStart ??
    draft.preferred[1]?.sourceStart ??
    highlightStart
  const completedEnd =
    completedHighlight?.sourceEnd ??
    draft.preferred[1]?.sourceEnd ??
    highlightEnd
  const completedDuration = Math.max(0.12, completedEnd - completedStart)
  const rangedCandidate = {
    ...selectedCandidate,
    sourceStart: completedStart,
    sourceEnd: completedEnd,
    estimatedFinalSeconds: completedDuration,
  }
  return {
    transcript,
    candidates: replaceCandidate(candidates, rangedCandidate),
    selectedCandidate: rangedCandidate,
    reportScript,
    reportScenes,
    removedRanges: [],
    keepRanges: [
      {
        sourceStart: completedStart,
        sourceEnd: completedEnd,
        outputStart: 0,
        outputEnd: completedDuration,
      },
    ],
    analysisMode: mode,
  }
}

async function buildup2WithClaude(
  transcript: TranscriptSegment[],
  candidate: NewsClipCandidate,
  sourceContext: NewsAnalysisSourceContext
) {
  const relevant = sourceContext.directSource
    ? transcript.slice(0, 180)
    : transcript.filter(
        (segment) =>
          segment.end >= candidate.sourceStart - 15 &&
          segment.start <= candidate.sourceEnd + 15
      )
  const highlightQuote = relevant
    .filter(
      (segment) =>
        segment.end > candidate.sourceStart &&
        segment.start < candidate.sourceEnd
    )
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
  const avoidScript = sourceContext.avoidPrevious?.script?.trim() || ""
  const avoidLead = avoidScript
    ? splitEndCtaFromScript(avoidScript).body || avoidScript
    : ""
  const locked = sourceContext.lockedRange
  const lockedStart = locked
    ? Math.min(locked.start, locked.end)
    : candidate.sourceStart
  const lockedEnd = locked
    ? Math.max(locked.start, locked.end)
    : candidate.sourceEnd
  const response = await claudeText(
    [
      "너는 정치/시사 쇼츠의 빌드업형 오프닝 멘트를 쓰는 작가다.",
      "결과 영상은 제목 TTS 인트로 다음에, 짧은 서두 TTS를 읽고 바로 원본 하이라이트 발언을 들려준다.",
      "원문 밖의 사실을 만들지 않는다.",
      sourceContext.directSource
        ? "사용자가 지정한 원본 영상이 기준이다. selectedIssue(고른 핵심 각도)와 highlightQuote·transcript만으로 서두를 쓰고 다른 이슈로 바꾸지 않는다."
        : "selectedIssue(고른 핵심 각도)와 highlightQuote(핵심 발언)를 먼저 보고 서두를 만든다. transcript는 구간 확인용이다.",
      "말투는 옆 사람에게 중요한 사실을 조근조근 알려 주는 차분한 반말이다. 시니컬하게 연기하거나 방송 멘트처럼 쓰지 않는다.",
      "teaser는 한국어 해체 반말 1~2문장만 쓴다. 존댓말(~요, ~습니다, ~죠)은 쓰지 않는다.",
      "첫 문장은 highlightQuote에서 가장 도드라진 사실·모순·온도만 한 조각 짚는다. 발언을 길게 요약하거나 그대로 복붙하지 않는다.",
      "둘째 문장(또는 한 문장일 때 끝)은 원본으로 자연스럽게 넘긴다. 연결 문구는 매번 다르게 쓰고, 고정 훅을 반복하지 않는다.",
      "금지: '들어봐', '직접 들어봐', '어떤 내용인지 들어봐', '그냥 넘기기 어렵더라', '충격적', '비밀', '오늘 알아볼게', 훈계·연설조, 댓글 유도.",
      "teaser에는 마무리 CTA('어떻게 생각해?', '댓글로 남겨줘.' 등)를 절대 넣지 않는다. CTA는 시스템이 따로 붙인다.",
      ...(avoidLead
        ? [
            "avoidPrevious.teaser는 직전에 쓴 서두다. 같은 문장·비슷한 말순서·같은 훅을 재탕하지 말고, 사실만 유지한 채 완전히 새 표현으로 다시 쓴다.",
            "단어 몇 개만 바꾸거나 앞뒤만 뒤집지 않는다. 첫 구절부터 다르게 시작한다.",
          ]
        : []),
      "나쁜 예: '이 발언, 그냥 넘기기 어렵더라. 직접 들어봐.'",
      "나쁜 예: '충격적인 발언이 나왔어. 어떤 내용인지 들어봐.'",
      "좋은 예: '예산은 늘었다는데, 현장 얘기는 정반대야.'",
      "좋은 예: '본인은 문제 없다는데, 숫자 설명이 안 맞아.'",
      locked
        ? "selectedRange는 주제고르기에서 확정한 핵심 구간이다. 시작점은 유지하고, 끝점은 현재 문장과 생각이 자연스럽게 끝나는 지점까지 잡는다."
        : "highlight_start와 highlight_end는 가장 강하고 맥락이 완결된 연속 발언 구간으로 잡는다. 고정된 목표 시간은 없으며 문장과 생각을 중간에서 자르지 않는다.",
      "JSON 객체만 출력한다: {teaser:string,highlight_start:number,highlight_end:number}",
    ].join("\n"),
    JSON.stringify({
      channelDirection: sourceContext.directSource
        ? ""
        : sourceContext.channelDirection,
      directSource: sourceContext.directSource === true,
      selectedIssue: sourceContext.issue,
      supplementalContext: sourceContext.supplementalContext,
      highlightQuote,
      rangeLocked: Boolean(locked),
      ...(avoidLead ? { avoidPrevious: { teaser: avoidLead } } : {}),
      selectedRange: {
        start: lockedStart,
        end: lockedEnd,
      },
      transcript: relevant.map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
      })),
    }),
    900
  )
  const value = JSON.parse(stripFence(response)) as {
    teaser?: unknown
    highlight_start?: unknown
    highlight_end?: unknown
  }
  let script = typeof value.teaser === "string" ? value.teaser.trim() : ""
  if (!script) throw new Error("empty-buildup2")
  if (avoidLead && textsTooSimilar(script, avoidLead)) {
    const retry = await claudeText(
      [
        "직전 서두와 너무 비슷하다. 같은 사실이라도 문장 구조·어휘·시작 구절을 완전히 바꿔 새 서두 1~2문장만 JSON으로 출력한다.",
        "JSON: {teaser:string}",
        `금지 서두: ${avoidLead}`,
      ].join("\n"),
      JSON.stringify({ highlightQuote, avoidTeaser: avoidLead }),
      400
    )
    const retryValue = JSON.parse(stripFence(retry)) as { teaser?: unknown }
    const retryScript =
      typeof retryValue.teaser === "string" ? retryValue.teaser.trim() : ""
    if (retryScript) script = retryScript
  }
  const highlightStart = locked ? lockedStart : Number(value.highlight_start)
  const highlightEnd = locked ? lockedEnd : Number(value.highlight_end)
  const start = Number.isFinite(highlightStart)
    ? highlightStart
    : candidate.sourceStart
  const end = Number.isFinite(highlightEnd) ? highlightEnd : candidate.sourceEnd
  const preferred = buildBuildup2Scenes(
    script,
    Math.min(start, end),
    Math.max(start, end),
    transcript,
    sourceContext.primarySourceId
  )
  return {
    script,
    highlightStart: Math.min(start, end),
    highlightEnd: Math.max(start, end),
    preferred,
  }
}

function lockCandidateToAngleRange(
  fallback: NewsClipCandidate,
  transcript: TranscriptSegment[],
  locked: NewsAnalysisSourceContext["lockedRange"]
): NewsClipCandidate {
  if (!locked) return fallback
  const start = Math.min(locked.start, locked.end)
  const end = Math.max(locked.start, locked.end)
  if (end - start < 3) return fallback
  const text = transcript
    .filter((segment) => segment.end > start && segment.start < end)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
  return {
    ...fallback,
    id: "angle-locked",
    sourceStart: Math.round(start * 100) / 100,
    sourceEnd: Math.round(end * 100) / 100,
    preview: (text || fallback.preview).slice(0, 180),
    reason: "주제고르기에서 확정한 구간",
    estimatedFinalSeconds: end - start,
  }
}

function distributeSupportingSources(
  scenes: NewsReportScene[],
  context: NewsAnalysisSourceContext
) {
  if (!context.supportingSources.length) return scenes
  let previousSourceId = ""
  return scenes.map((scene, index) => {
    if (scene.visual === "quote" || isEndCtaScene(scene)) {
      previousSourceId = scene.sourceId || context.primarySourceId
      return scene
    }
    const requestedSourceId = scene.sourceId || context.primarySourceId
    const shouldFindAlternative =
      requestedSourceId === context.primarySourceId ||
      requestedSourceId === previousSourceId
    if (!shouldFindAlternative) {
      previousSourceId = requestedSourceId
      return scene
    }
    const ranked = context.supportingSources
      .map((source) => ({
        source,
        match: bestSupportingSegment(scene.narration, source),
      }))
      .sort((left, right) => right.match.score - left.match.score)
    const preferred =
      ranked.find(
        (item) => item.source.id !== previousSourceId && item.match.score > 0
      ) ??
      (index % 2 === 1
        ? ranked.find((item) => item.source.id !== previousSourceId)
        : undefined)
    if (!preferred) {
      previousSourceId = requestedSourceId
      return scene
    }
    previousSourceId = preferred.source.id
    return {
      ...scene,
      sourceId: preferred.source.id,
      sourceStart: preferred.match.start,
      sourceEnd: preferred.match.end,
    }
  })
}

function bestSupportingSegment(narration: string, source: NewsAnalysisSource) {
  const tokens = narration
    .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2)
  const metadata = `${source.title} ${source.summary}`
  const ranked = source.transcript
    .map((segment) => ({
      segment,
      score: tokens.filter((token) => segment.text.includes(token)).length,
    }))
    .sort((left, right) => right.score - left.score)[0]
  const metadataScore = tokens.filter((token) =>
    metadata.includes(token)
  ).length
  return {
    start: ranked?.segment.start ?? 0,
    end: ranked?.segment.end ?? 5,
    score: (ranked?.score ?? 0) + metadataScore,
  }
}

async function reportWithClaude(
  transcript: TranscriptSegment[],
  candidate: NewsClipCandidate,
  settings: NewsClipSettings,
  sourceContext: NewsAnalysisSourceContext
) {
  const captionLineLimit = titleLineCharacterLimit(settings.bodySubtitleText)
  const captionChunkLimit = captionLineLimit * 2
  const relevant = sourceContext.directSource
    ? transcript.slice(0, 180)
    : transcript.filter(
        (segment) =>
          segment.end >= candidate.sourceStart - 15 &&
          segment.start <= candidate.sourceEnd + 15
      )
  const focusRules = sourceContext.directSource
    ? [
        "사용자가 URL이나 파일로 직접 지정한 원본 영상이다. 대본의 절대 기준은 제공된 transcript(원본 발언)다.",
        "원본 자막에 실제로 나온 인물·사건·주장만 다룬다. 원본에 없는 다른 정치 이슈·정책·사건을 끌어와 주제를 바꾸지 않는다.",
        "channelDirection은 말투와 논평 어조만 참고하고, 원본 내용과 무관한 주제로 재구성하지 않는다.",
        "selectedIssue는 사용자가 고른 핵심 각도다. 이 각도의 title·reason·keywords만 중심으로 쓰고, 다른 각도로 주제를 바꾸지 않는다.",
        "원본 발언자의 핵심 주장과 근거를 먼저 전달하고, 확인된 범위에서만 짧게 평가한다.",
      ]
    : [
        "대본을 쓰기 전 channelDirection, selectedIssue, supplementalContext, 원본 발언을 함께 보고 이번 콘텐츠가 누구의 주장을 지지하고 누구를 비판해야 하는지 먼저 판단한다.",
        "selectedIssue나 원본의 주인공이라는 이유로 그 인물을 자동으로 비판 대상으로 삼지 마라. 채널 방향과 맞는 발언자나 주장은 의미와 근거를 살려 옹호하고, 그 발언이 지적하는 조치·수사·보도·반박의 모순을 비판한다.",
        "selectedIssue는 사용자가 고른 핵심 각도이자 절대적인 중심 논점이다. 원본 영상은 근거 자료일 뿐이며, 원본에 더 흥미로운 다른 이야기가 있어도 논점을 바꾸지 않는다.",
        "도입부터 마지막 결론까지 selectedIssue가 제기한 대상과 논점을 다룬다. 선택 논점과 직접 연결되지 않는 장점·단점·지역 사례·부수 효과는 대본에서 제외한다.",
        "selectedIssue.reason과 articleTitles는 제작 의도와 검증 방향이다. availableSources에서 이를 뒷받침하는 수치와 발언만 골라 쓴다.",
      ]
  const response = await claudeText(
    [
      "너는 뉴스스토리 채널의 짧은 시사 논평을 쓰는 작가다.",
      "사실을 차례로 읽는 중립 뉴스 리포트가 아니라, 확인된 사실을 바탕으로 이슈를 평가하는 구어체 논평을 작성한다. 논평은 이슈에 따라 비판일 수도, 옹호일 수도 있다.",
      ...focusRules,
      "옹호는 무조건적인 찬양이 아니다. 원본에서 확인되는 주장과 근거를 분명히 전달하고, 발언자의 주장은 확정된 사실과 구분해 '주장했다', '지적했다'로 표현한다.",
      "관점이 애매하면 임의로 한쪽을 공격하지 말고, 확인된 차이와 쟁점을 보여 주는 문제 제기형 논평으로 쓴다.",
      "supplementalContext는 사용자가 강조하거나 연결하고 싶은 보조 내용이다. 이 내용을 대본의 관점과 질문에 반영하고 availableSources에서 직접 연결되는 근거를 찾아 핵심 흐름으로 구성한다.",
      "supplementalContext에만 있고 원본 영상·자막에서 확인되지 않는 사실은 단정하지 않는다. 근거가 없으면 배경 주장으로 추가하지 말고 질문 또는 검토할 관점으로만 제한한다.",
      "말투는 옆 사람에게 중요한 사실을 조근조근 알려 주는 차분한 반말이다. 너무 가까운 친구처럼 가볍거나 장난스럽게 말하지 말고, 시청자를 훈계하거나 연설하지도 마라.",
      "대본의 서술과 질문은 처음부터 끝까지 한국어 해체 반말로 통일한다. '~요', '~습니다', '~입니다', '~세요', '~죠'와 같은 존댓말 종결은 직접 발언을 그대로 인용하는 경우 외에는 절대 쓰지 않는다.",
      "문장 종결은 '말했어.', '가볍지 않아.', '넌센스라고 주장했어.', '증거가 됐다는 거야.', '가능했다고 했어.', '문제일까?' 같은 절제된 반말을 기준으로 삼는다. '~했어', '~라는 거야', '~인 셈이야', '~일까?', '~아닐까?' 등을 문맥에 맞게 섞되 같은 종결을 연속해 반복하지 않는다.",
      "'이거 알고 있었어?', '여기서 중요한 게 하나 있어.', '결국 이런 얘기인 거야.', '그런데 이 지적, 그냥 넘길 얘기일까?' 같은 짧은 연결과 반문을 문맥에 맞게 사용한다.",
      "대본은 바로 세부 평가나 숫자로 시작하지 않는다. 첫 1~2문장에서는 최근 어떤 이슈가 생겼고 무엇이 바뀌었는지 처음 보는 사람도 이해할 수 있게 짧게 설명한다.",
      "도입은 전체 분량의 10~15%만 사용하고 '오늘은 알아볼게'와 같은 방송식 예고는 쓰지 않는다. 이슈 소개 뒤에는 '그런데', '핵심은', '여기서 봐야 할 건'처럼 자연스럽게 핵심 논점으로 전환한다.",
      "도입 다음 문장부터 핵심 주장이나 가장 중요한 전후 차이를 훅·대조·반문 중 적합한 방식으로 제시한다. 중간은 확인된 숫자·직접 발언·전후 차이를 근거로 파고들고, 마지막은 선택한 관점이 선명하게 남는 평가나 질문으로 끝낸다.",
      "'시행됩니다', '선정됐습니다', '나타났습니다', '전해졌습니다', '비판이 나오고 있습니다', '자세히 알아보겠습니다'처럼 보도자료를 읽는 존댓말 종결은 사용하지 않는다.",
      "제공된 원문 밖의 사실이나 숨은 의도를 만들어내지 않는다. 확인되지 않은 의혹은 사실처럼 단정하지 말고 반드시 질문·가능성·추론으로 구분한다.",
      "근거 없이 '언론이 숨겼다', '아무도 모른다', '충격적인 진실'처럼 비밀을 과장하는 표현은 쓰지 않는다. 친밀한 말투와 사실의 희소성을 혼동하지 않는다.",
      `댓글 유도 문구까지 포함한 전체 본문 TTS가 약 50~56초가 되도록 공백 제외 ${REPORT_MIN_CHARACTERS}~${REPORT_MAX_CHARACTERS}자로 작성하고, ${REPORT_TARGET_CHARACTERS}자 안팎을 우선한다.`,
      "대본의 마지막에는 앞선 결론과 자연스럽게 연결되는 짧은 질문과 댓글 유도를 반드시 포함한다.",
      "질문 예: 인물이면 '김계리의 의견에 어떻게 생각해?', 이슈면 '조작기소에 대해 어떻게 생각해?'. '주제, 어떻게 봐?'처럼 끊긴 말투는 쓰지 않는다.",
      "바로 다음 줄에 '댓글로 남겨줘.'를 둔다. 이 문구도 script의 마지막 발화이자 자막·visuals 마지막 source 장면으로 포함한다.",
      "댓글 유도까지 포함해 7~11개의 완결된 문장으로 작성한다.",
      "각 문장은 한 가지 주장과 근거를 담고 자연스러운 한국어 문장으로 완성한다.",
      "script 문자열은 한 문단으로 출력하지 말고, 화면에 함께 보여 줄 자연스러운 자막 호흡마다 줄바꿈(\\n)을 넣는다. 한 문장이 여러 자막 호흡으로 나뉘어도 문장부호는 문장 마지막에만 둔다.",
      `자막 한 구간은 현재 화면 기준 최대 2줄이며 공백 제외 ${captionChunkLimit}자 이내로 쓴다. 지나치게 짧게 자르지 말고 대체로 ${Math.max(6, captionLineLimit - 3)}~${captionChunkLimit}자 안에서 의미가 읽히는 구절로 묶는다.`,
      "쉼표 뒤, 시간·대상 제시 뒤, 관형절이 끝난 뒤, 주어부와 서술부가 자연스럽게 갈리는 지점을 우선한다. 단어 내부, 숫자와 단위, 명사와 조사, 짧은 수식어와 피수식어 사이는 절대 나누지 않는다.",
      "좋은 분할 예시: '인구 감소 지역 주민에게,' / '월 15만 원씩 지역 상품권을 주는' / '농어촌 기본소득 사업이' / '내년부터 2년간 시범 시행돼.'",
      "전체 문장 중 최소 두 문장은 반문·대조·평가를 담고, 사실 나열 문장만 세 개 이상 연속하지 않는다.",
      settings.removeFillers
        ? "원문의 말버릇, 머뭇거림과 반복 표현은 보도 대본에서 제거한다."
        : "원문의 의미 있는 반복은 강조 의도를 해치지 않는 범위에서 유지한다.",
      "visuals는 각 문장 순서대로 source 또는 quote 중 하나와 사용할 sourceId를 지정한다. 같은 자료를 연속 반복하지 말고 문장 근거와 가장 가까운 자료를 골고루 배치한다.",
      "source는 아나운서 TTS가 이어지는 무음 자료 화면이다. quote는 TTS를 멈추고 원본 음성을 그대로 들려주는 강한 직접 발언이다.",
      "보조 자료는 기본적으로 source로만 사용한다. 제공된 보조 자료 자막에 실제 직접 발언과 정확한 타임코드가 있을 때만 quote로 지정할 수 있다.",
      "quote 문장의 script 내용은 지정한 원본 구간에서 실제로 말한 문장을 그대로 사용하고, 앞뒤 맥락을 왜곡하지 않는다.",
      "quote에는 원문을 요약하거나 '주장했어', '말했어', '지적했어' 같은 해설형 종결로 바꾼 문장을 절대 넣지 않는다. 한 글자라도 확신할 수 없으면 source로 지정한다.",
      "quote의 sourceStart와 sourceEnd는 해당 직접 발언 문장의 시작과 끝에 맞추고, 다음 문장이나 앞 문장이 섞이지 않게 한다.",
      "quote 다음 문장은 원본 발언을 다시 반복하지 말고, '그런데', '이 말의 핵심은', '문제는'처럼 방금 들은 발언에서 다음 근거나 평가로 자연스럽게 이어지는 TTS 해설로 쓴다.",
      "quote 앞뒤 문장을 이어 읽었을 때 주어와 논점이 갑자기 바뀌거나 같은 내용을 두 번 설명하지 않도록 전체 흐름을 검토한다.",
      "source와 quote에는 해당 근거가 실제 등장하는 sourceStart와 sourceEnd를 원본 타임코드 안에서 지정한다.",
      ...(sourceContext.avoidPrevious?.script?.trim()
        ? [
            "avoidPrevious.script는 직전에 쓴 대본이다. 문장·말순서·훅을 재탕하지 말고 같은 논점이라도 완전히 새 표현으로 다시 쓴다.",
            "단어만 살짝 바꾸거나 문장 앞뒤만 뒤집지 않는다. 도입 첫 문장부터 다르게 시작한다.",
          ]
        : []),
      "JSON 객체만 출력한다: {script:string, visuals:[{visual:'source'|'quote',sourceId:string,sourceStart:number,sourceEnd:number}]}",
    ].join("\n"),
    JSON.stringify({
      channelDirection: sourceContext.directSource
        ? ""
        : sourceContext.channelDirection,
      directSource: sourceContext.directSource === true,
      selectedIssue: sourceContext.issue,
      supplementalContext: sourceContext.supplementalContext,
      ...(sourceContext.avoidPrevious?.script?.trim()
        ? {
            avoidPrevious: {
              script: sourceContext.avoidPrevious.script.trim().slice(0, 1200),
            },
          }
        : {}),
      selectedRange: {
        start: candidate.sourceStart,
        end: candidate.sourceEnd,
      },
      transcript: relevant.map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text,
      })),
      availableSources: [
        {
          id: sourceContext.primarySourceId,
          role: "primary",
          title: sourceContext.primarySourceTitle || "핵심 근거 원본",
          summary: sourceContext.primarySourceSummary,
          transcript: relevant.map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.text,
          })),
        },
        ...sourceContext.supportingSources.map((source) => ({
          id: source.id,
          role: "supporting",
          title: source.title,
          summary: source.summary,
          transcript: source.transcript.slice(0, 100).map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.text,
          })),
        })),
      ],
    }),
    1600
  )
  const value = JSON.parse(stripFence(response)) as {
    script?: unknown
    visuals?: unknown
  }
  let script = typeof value.script === "string" ? value.script.trim() : ""
  if (!script) throw new Error("empty-report")
  const avoidScript = sourceContext.avoidPrevious?.script?.trim() || ""
  if (avoidScript && textsTooSimilar(script, avoidScript)) {
    const retry = await claudeText(
      [
        "직전 대본과 너무 비슷하다. 같은 논점이라도 문장 구조·어휘·도입을 완전히 바꿔 새 대본을 다시 쓴다.",
        "기존 작성 규칙을 유지하고 JSON만 출력한다: {script:string, visuals:[{visual:'source'|'quote',sourceId:string,sourceStart:number,sourceEnd:number}]}",
      ].join("\n"),
      JSON.stringify({
        avoidPrevious: { script: avoidScript.slice(0, 1200) },
        selectedIssue: sourceContext.issue,
        selectedRange: {
          start: candidate.sourceStart,
          end: candidate.sourceEnd,
        },
      }),
      1600
    )
    const retryValue = JSON.parse(stripFence(retry)) as {
      script?: unknown
      visuals?: unknown
    }
    const retryScript =
      typeof retryValue.script === "string" ? retryValue.script.trim() : ""
    if (retryScript) {
      script = retryScript
      value.visuals = retryValue.visuals ?? value.visuals
    }
  }
  if (
    !sourceContext.directSource &&
    !scriptMatchesIssueFocus(script, sourceContext.issue)
  ) {
    throw new Error("issue-focus-mismatch")
  }
  const preferred = Array.isArray(value.visuals)
    ? value.visuals.flatMap((item, index) => {
        if (!item || typeof item !== "object") return []
        const visual = (item as { visual?: unknown }).visual
        const requestedSourceId = (item as { sourceId?: unknown }).sourceId
        const availableSourceIds = new Set([
          sourceContext.primarySourceId,
          ...sourceContext.supportingSources.map((source) => source.id),
        ])
        const sourceStart = Number(
          (item as { sourceStart?: unknown }).sourceStart
        )
        const sourceEnd = Number((item as { sourceEnd?: unknown }).sourceEnd)
        if (visual !== "source" && visual !== "quote") return []
        return [
          {
            id: `report-scene-${index + 1}`,
            narration: "",
            visual,
            sourceId:
              sourceContext.supportingSources.length > 0 &&
              typeof requestedSourceId === "string" &&
              availableSourceIds.has(requestedSourceId)
                ? requestedSourceId
                : sourceContext.primarySourceId,
            sourceStart: Number.isFinite(sourceStart)
              ? sourceStart
              : candidate.sourceStart,
            sourceEnd: Number.isFinite(sourceEnd)
              ? sourceEnd
              : candidate.sourceEnd,
          } satisfies NewsReportScene,
        ]
      })
    : []
  return { script, preferred }
}

function localReport(
  transcript: TranscriptSegment[],
  candidate: NewsClipCandidate
) {
  const relevant = transcript.filter(
    (segment) =>
      segment.end > candidate.sourceStart && segment.start < candidate.sourceEnd
  )
  const selected: TranscriptSegment[] = []
  let length = 0
  for (const segment of relevant) {
    if (length >= REPORT_TARGET_CHARACTERS) break
    selected.push(segment)
    length += segment.text.replace(/\s+/g, "").length
  }
  const body = selected.map((segment) => segment.text.trim()).join(" ")
  const script = body || candidate.preview
  return { script, preferred: [] as NewsReportScene[] }
}

function bestCandidate(candidates: NewsClipCandidate[], issue: NewsIssueFocus) {
  const angleTerms = issueAngleTerms(issue)
  return [...candidates].sort((a, b) => {
    const riskPenalty = (value: NewsClipCandidate["contextRisk"]) =>
      value === "high" ? 20 : value === "medium" ? 8 : 0
    const issueScore = (candidate: NewsClipCandidate) => {
      const text = `${candidate.preview} ${candidate.titleOptions.join(" ")}`
      return angleTerms.filter((term) => text.includes(term)).length * 15
    }
    const leftScore =
      a.scores.total - riskPenalty(a.contextRisk) + issueScore(a)
    const rightScore =
      b.scores.total - riskPenalty(b.contextRisk) + issueScore(b)
    return rightScore - leftScore
  })[0]
}

async function refineWithClaude(
  transcript: TranscriptSegment[],
  candidates: NewsClipCandidate[],
  settings: NewsClipSettings,
  issue: NewsIssueFocus,
  supplementalContext: string,
  channelDirection = settings.issueSearchGuidance,
  directSource = false,
  avoidTitles: string[] = []
) {
  const firstLineLimit = titleLineCharacterLimit(settings.titleCardText)
  const secondLineLimit = titleLineCharacterLimit({
    ...settings.titleCardText,
    fontSize: settings.titleCardSecondFontSize,
  })
  const avoidTitleList = avoidTitles
    .map((title) => title.trim())
    .filter(Boolean)
    .slice(0, 8)
  const response = await claudeText(
    [
      "너는 뉴스스토리 채널의 시사 논평 쇼츠를 기획하는 편집자다.",
      directSource
        ? "사용자가 직접 지정한 원본 영상이다. transcript에 실제로 나온 발언·인물·사건을 기준으로 구간을 고르고, channelDirection이나 다른 이슈로 주제를 바꾸지 않는다."
        : "channelDirection, selectedIssue, supplementalContext를 보고 이번 콘텐츠의 옹호 대상과 비판 대상을 먼저 구분한다. 원본 발언자나 주제를 자동으로 비판 대상으로 삼지 마라.",
      directSource
        ? "화제성이 높은 연속 발언과 핵심 주장이 선명한 구간을 우선한다."
        : "채널이 지지하는 발언은 그 주장의 핵심 근거가 선명한 구간을 우선하고, 비판해야 할 사안은 앞뒤 불일치·구체적 피해·수치·책임 회피가 선명한 구간을 우선한다.",
      directSource
        ? "selectedIssue는 영상 제목 참고용이다. 제목과 자막이 다르면 자막을 따른다."
        : "selectedIssue가 있으면 후보의 일반적인 화제성보다 선택 이슈의 구체 논점과 직접 맞는 구간을 최우선으로 고른다.",
      directSource
        ? ""
        : "같은 정책을 다뤄도 selectedIssue의 문제 제기와 다른 효과·사례를 중심으로 한 구간은 감점한다.",
      "supplementalContext가 있으면 그 내용과 직접 연결되는 원본 발언·수치가 포함된 후보 구간을 우선한다.",
      "맥락 왜곡과 확인되지 않은 주장은 감점한다. 원문에 없는 사실을 제목에 추가하지 마라.",
      "titleOptions는 각 후보 preview/windowText에 실제로 나온 인물·기관·숫자·핵심 명사만 써서 만든다. 구간에 없는 소재를 끌어오지 않는다.",
      "제목은 자극용 허풍이 아니라, 그 구간 발언을 한눈에 알아듣는 짧은 두 줄 헤드라인이다.",
      "1단=구체적 사실·주장의 주어/핵심어, 2단=그 구간의 반전·쟁점·핵심 결과. 서로 이어지는 한 문장을 억지로 쪼개지 않는다.",
      "금지: '그 말', '진짜 문제', '아무도 모르는', '충격', '경악', 구간과 무관한 감탄·추상어.",
      "어색한 조사 생략·말꼬리 자르기를 피하고, 평소 뉴스 쇼츠에서 자연스럽게 읽히는 한국어로 쓴다.",
      "인트로 제목은 의미가 독립된 짧은 구절 2개를 만들어 반드시 줄바꿈(\\n)으로 구분한다. 각 구절은 한 줄만 사용한다.",
      `1단은 공백 제외 ${firstLineLimit}자 이내, 2단은 공백 제외 ${secondLineLimit}자 이내로 작성한다.`,
      ...(avoidTitleList.length
        ? [
            "avoidPrevious.titles는 직전에 쓴 제목들이다. 같은 제목·비슷한 1단/2단 조합을 재탕하지 말고 완전히 새 헤드라인 3개를 만든다.",
          ]
        : []),
      "JSON 배열만 출력한다. 각 항목은 id, reason, contextRisk(low|medium|high), titleOptions(정확히 3개)를 갖는다.",
    ]
      .filter(Boolean)
      .join("\n"),
    JSON.stringify({
      channelDirection,
      directSource,
      selectedIssue: issue,
      supplementalContext,
      ...(avoidTitleList.length
        ? { avoidPrevious: { titles: avoidTitleList } }
        : {}),
      candidates: candidates.map((item) => ({
        id: item.id,
        start: item.sourceStart,
        end: item.sourceEnd,
        preview: item.preview,
        windowText: transcript
          .filter(
            (segment) =>
              segment.end > item.sourceStart && segment.start < item.sourceEnd
          )
          .map((segment) => segment.text)
          .join(" ")
          .slice(0, 500),
        scores: item.scores,
      })),
    }),
    1800
  )
  const parsed = JSON.parse(stripFence(response)) as unknown
  if (!Array.isArray(parsed)) return candidates
  const refinements = new Map(
    parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const value = item as Record<string, unknown>
      if (typeof value.id !== "string") return []
      return [[value.id, value] as const]
    })
  )
  return candidates.map((candidate) => {
    const value = refinements.get(candidate.id)
    const titles = Array.isArray(value?.titleOptions)
      ? value.titleOptions.filter(
          (title): title is string =>
            typeof title === "string" && title.trim() !== ""
        )
      : []
    const risk = value?.contextRisk
    return {
      ...candidate,
      reason:
        typeof value?.reason === "string" && value.reason.trim()
          ? value.reason.trim()
          : candidate.reason,
      contextRisk:
        risk === "medium" || risk === "high" || risk === "low"
          ? risk
          : candidate.contextRisk,
      titleOptions: titles.length === 3 ? titles : candidate.titleOptions,
    }
  })
}

function fitCandidateTitles(
  candidates: NewsClipCandidate[],
  settings: NewsClipSettings
) {
  const secondLayout = {
    ...settings.titleCardText,
    fontSize: settings.titleCardSecondFontSize,
  }
  return candidates.map((candidate) => ({
    ...candidate,
    titleOptions: candidate.titleOptions.map((title) =>
      fitTitleToLineLayouts(title, settings.titleCardText, secondLayout)
    ),
  }))
}

function replaceCandidate(
  candidates: NewsClipCandidate[],
  next: NewsClipCandidate
) {
  const exists = candidates.some((candidate) => candidate.id === next.id)
  if (!exists) return [next, ...candidates]
  return candidates.map((candidate) =>
    candidate.id === next.id ? next : candidate
  )
}

function textsTooSimilar(left: string, right: string) {
  const a = left.replace(/\s+/g, "")
  const b = right.replace(/\s+/g, "")
  if (!a || !b) return false
  if (a === b) return true
  const sample = Math.min(a.length, b.length, 48)
  if (sample < 12) return a === b
  let same = 0
  for (let index = 0; index < sample; index += 1) {
    if (a[index] === b[index]) same += 1
  }
  return same / sample >= 0.82
}

function stripFence(value: string) {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
}
