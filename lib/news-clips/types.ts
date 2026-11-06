import type { RecommendedNewsIssue } from "./issues.ts"
import { isPrimarilyKorean } from "./language.ts"

export type ProjectType = "character" | "news_clip"

export type NewsChannelProfile = {
  id: string
  name: string
  language: string
  avatarUrl: string
  youtubeChannelId: string
  youtubeChannelCredentials: string
  createdAt: string
}

export type NewsSourceKind = "search" | "youtube" | "upload"

export type NewsSearchChannel = {
  id: string
  name: string
  youtubeChannelId: string
  priority: number
  enabled: boolean
}

export type NewsCandidateMetrics = {
  recommendationScore: number
  relevanceScore?: number
  relevanceReason?: string
  viewsPerHour: number
  commentRate: number
  commentsPerHour: number
  responseMultiple: number
  sameIssueChannelCount: number
  ageHours: number
  directSpeechLikelihood: number
  expectedShortTitle: string
  recommendationReason: string
  riskFactors: string[]
  transcriptExcerpt: string
}

export type NewsSource = {
  id: string
  kind: NewsSourceKind
  title: string
  channel: string
  publishedAt: string
  durationSeconds: number
  viewCount: number
  originalUrl: string
  summary: string
  localFile: string
  approved: boolean
  requiresUpload: boolean
  commentCount: number
  searchMetrics: NewsCandidateMetrics | null
}

export type NewsSourceSearchState = {
  issueId: string
  results: NewsSource[]
  message: string
  youtubeDataMissing: boolean
  status: "idle" | "searching" | "complete" | "error"
}

export function normalizeNewsSourceSearchState(
  value: unknown
): NewsSourceSearchState {
  const raw = value && typeof value === "object" ? value : {}
  const record = raw as Partial<NewsSourceSearchState>
  const results = Array.isArray(record.results)
    ? record.results.filter((result): result is NewsSource =>
        Boolean(
          result &&
          typeof result === "object" &&
          typeof result.id === "string" &&
          typeof result.title === "string" &&
          isPrimarilyKorean(result.title) &&
          typeof result.originalUrl === "string"
        )
      )
    : []
  const youtubeDataMissing = record.youtubeDataMissing === true
  const savedStatus =
    record.status === "complete" || record.status === "error"
      ? record.status
      : "idle"
  return {
    issueId: typeof record.issueId === "string" ? record.issueId : "",
    results,
    message: typeof record.message === "string" ? record.message : "",
    youtubeDataMissing,
    status: youtubeDataMissing && results.length === 0 ? "idle" : savedStatus,
  }
}

export type TranscriptWord = {
  text: string
  start: number
  end: number
  speaker?: string
  confidence?: number
}

export type TranscriptSegment = {
  id: string
  text: string
  start: number
  end: number
  speaker: string
  words: TranscriptWord[]
}

export type CandidateScores = {
  audienceFit: number
  timeliness: number
  hook: number
  specificity: number
  standalone: number
  contextIntegrity: number
  mediaQuality: number
  total: number
}

export type NewsClipCandidate = {
  id: string
  sourceStart: number
  sourceEnd: number
  estimatedFinalSeconds: number
  reason: string
  preview: string
  contextRisk: "low" | "medium" | "high"
  scores: CandidateScores
  titleOptions: string[]
}

export type RemovedRange = {
  id: string
  start: number
  end: number
  reason: "silence" | "low_importance" | "filler" | "manual"
  restored: boolean
}

export type KeepRange = {
  sourceStart: number
  sourceEnd: number
  outputStart: number
  outputEnd: number
}

export type SubtitleCue = {
  id: string
  sceneId?: string
  start: number
  end: number
  text: string
  emphasis: string[]
  emphasisColor: "yellow" | "green"
}

export type NewsReportScene = {
  id: string
  narration: string
  visual: "source" | "quote"
  sourceId?: string
  sourceStart: number
  sourceEnd: number
}

export type CropPosition = {
  x: number
  y: number
  zoom: number
  faceTracking: boolean
}

export type NewsTextAlignment = "left" | "center" | "right"

export type NewsTtsProvider = "auto" | "free" | "typecast"

export type TypecastVoiceProfile = {
  id: string
  name: string
  voiceId: string
}

export type NewsTextLayout = {
  fontSize: number
  fontWeight: 400 | 500 | 600 | 700 | 800 | 900
  letterSpacing: number
  x: number
  y: number
  width: number
  alignment: NewsTextAlignment
}

export type NewsClipSettings = {
  profileId: string
  preferredChannels: NewsSearchChannel[]
  issueSearchGuidance: string
  communitySignalsEnabled: boolean
  communityCacheMinutes: number
  targetMinSeconds: number
  targetMaxSeconds: number
  idealMinSeconds: number
  idealMaxSeconds: number
  hardMaxSeconds: number
  titleCardSeconds: number
  titleFrameImage: string
  bodyFrameImage: string
  bgmFile: string
  bgmEnabled: boolean
  bgmVolume: number
  ttsProvider: NewsTtsProvider
  titleVoice: string
  typecastVoiceId: string
  typecastVoices: TypecastVoiceProfile[]
  titleVoiceRate: number
  titleVolume: number
  sourceVolume: number
  quoteVolume: number
  fontFamily: "Pretendard" | "Black Han Sans"
  titleCardText: NewsTextLayout
  titleCardSecondFontSize: number
  titleCardLineHeightPercent: number
  titleCardColor: string
  titleCardSecondColor: string
  bodyTitleText: NewsTextLayout
  bodyTitleColor: string
  bodySubtitleText: NewsTextLayout
  subtitleColor: string
  emphasisColor: "#ffd84d" | "#5ee28b"
  videoRect: { x: number; y: number; width: number; height: number }
  safeMarginPercent: number
  removeFillers: boolean
  cutTransition: "hard" | "dissolve"
  youtubeAutoUpload: boolean
}

export type NewsClipProject = {
  id: string
  type: "news_clip"
  profileId: string
  createdAt: string
  updatedAt: string
  source: NewsSource | null
  supportingSources: NewsSource[]
  sourceIssueId: string
  selectedIssue: RecommendedNewsIssue | null
  transcript: TranscriptSegment[]
  candidates: NewsClipCandidate[]
  selectedCandidateId: string
  title: string
  titleOptions: string[]
  reportScript: string
  supplementalContext: string
  reportScenes: NewsReportScene[]
  detectedSilences: RemovedRange[]
  removedRanges: RemovedRange[]
  keepRanges: KeepRange[]
  subtitles: SubtitleCue[]
  crop: CropPosition
  bgmEnabled: boolean
  bgmVolume: number
  titleVolume: number
  sourceVolume: number
  quoteVolume: number
  introStillTimeSeconds: number | null
  introStillZoom: number
  introStillX: number
  introStillY: number
  titleCardDurationSeconds: number
  outputDurationSeconds: number
  renderSignature: string
  outputUrl: string
  previewUrl: string
  previewSignature: string
  renderSettingsKey: string
  thumbnailUrl: string
  youtubeVideoId: string
  youtubeUploadUrl: string
  metadata: { youtubeTitle: string; description: string; tags: string[] }
}

export type NewsClipStep =
  "issue" | "source" | "script" | "direction" | "preview" | "final"

export type NewsClipStudioState = {
  projectType: "news_clip"
  step: NewsClipStep
  project: NewsClipProject
}

export const NEWS_CLIP_STEPS: {
  id: NewsClipStep
  label: string
  role: string
}[] = [
  { id: "issue", label: "이슈 탐색·승인", role: "제작할 주제 결정" },
  { id: "source", label: "원본 영상 선택", role: "보도 근거 결정" },
  { id: "script", label: "보도 대본 검수", role: "제목·보도문 확정" },
  { id: "direction", label: "화면 연출 구성", role: "장면·음성 방식 확정" },
  {
    id: "preview",
    label: "통합 검수·영상 제작",
    role: "대본·자막·화면 검수 후 영상 제작",
  },
  { id: "final", label: "최종 결과", role: "720p 결과 확인" },
]

// Figma body frame 900×1600 has a 900×600 (3:2) video opening at y=350.
// Layout settings use a logical 1080×1920 canvas. Final output scales the
// complete composition to 720×1280 without changing its visual proportions.
export const NEWS_BODY_VIDEO_RECT = {
  x: 0,
  y: 420,
  width: 1080,
  height: 720,
} as const

export const defaultNewsClipSettings: NewsClipSettings = {
  profileId: "default",
  preferredChannels: [],
  issueSearchGuidance:
    "현 정부와 민주당의 정책·발언·수사·권력 행사는 모순과 국민 피해를 근거로 비판한다. 보수 진영 인사와 그들이 제시하는 근거·해명·문제 제기는 원본에서 확인되는 범위에서 긍정적·옹호적으로 다룬다. 주장은 확정 사실과 구분하고 공식 자료·직접 발언·복수 매체 근거를 우선한다.",
  communitySignalsEnabled: false,
  communityCacheMinutes: 30,
  targetMinSeconds: 45,
  targetMaxSeconds: 58,
  idealMinSeconds: 50,
  idealMaxSeconds: 55,
  hardMaxSeconds: 59,
  titleCardSeconds: 2.5,
  titleFrameImage: "",
  bodyFrameImage: "",
  bgmFile: "",
  bgmEnabled: true,
  bgmVolume: 0.12,
  ttsProvider: "auto",
  titleVoice: "mms-kor",
  typecastVoiceId: "tc_5e4f7a5da82e1f000aca31af",
  typecastVoices: [
    {
      id: "typecast-default",
      name: "기본 Typecast 음성",
      voiceId: "tc_5e4f7a5da82e1f000aca31af",
    },
  ],
  titleVoiceRate: -4,
  titleVolume: 1,
  sourceVolume: 1,
  quoteVolume: 1,
  fontFamily: "Pretendard",
  titleCardText: {
    fontSize: 82,
    fontWeight: 700,
    letterSpacing: 0,
    x: 108,
    y: 820,
    width: 864,
    alignment: "center",
  },
  titleCardSecondFontSize: 64,
  titleCardLineHeightPercent: 108,
  titleCardColor: "#ffffff",
  titleCardSecondColor: "#ffd84d",
  bodyTitleText: {
    fontSize: 68,
    fontWeight: 700,
    letterSpacing: 0,
    x: 72,
    y: 72,
    width: 936,
    alignment: "center",
  },
  bodyTitleColor: "#ffffff",
  bodySubtitleText: {
    fontSize: 58,
    fontWeight: 600,
    letterSpacing: 0,
    x: 22,
    y: 1180,
    width: 1037,
    alignment: "center",
  },
  subtitleColor: "#ffffff",
  emphasisColor: "#ffd84d",
  videoRect: { ...NEWS_BODY_VIDEO_RECT },
  safeMarginPercent: 7,
  removeFillers: false,
  cutTransition: "hard",
  youtubeAutoUpload: false,
}

export function freshNewsClipProject(profileId: string): NewsClipProject {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    type: "news_clip",
    profileId,
    createdAt: now,
    updatedAt: now,
    source: null,
    supportingSources: [],
    sourceIssueId: "",
    selectedIssue: null,
    transcript: [],
    candidates: [],
    selectedCandidateId: "",
    title: "",
    titleOptions: [],
    reportScript: "",
    supplementalContext: "",
    reportScenes: [],
    detectedSilences: [],
    removedRanges: [],
    keepRanges: [],
    subtitles: [],
    crop: { x: 50, y: 50, zoom: 1.02, faceTracking: false },
    bgmEnabled: true,
    bgmVolume: 0.12,
    titleVolume: 1,
    sourceVolume: 1,
    quoteVolume: 1,
    introStillTimeSeconds: null,
    introStillZoom: 1,
    introStillX: 50,
    introStillY: 50,
    titleCardDurationSeconds: 0,
    outputDurationSeconds: 0,
    renderSignature: "",
    outputUrl: "",
    previewUrl: "",
    previewSignature: "",
    renderSettingsKey: "",
    thumbnailUrl: "",
    youtubeVideoId: "",
    youtubeUploadUrl: "",
    metadata: { youtubeTitle: "", description: "", tags: [] },
  }
}

export function resetNewsClipProjectProgress(
  project: NewsClipProject,
  selectedIssue: RecommendedNewsIssue | null
): NewsClipProject {
  return {
    ...freshNewsClipProject(project.profileId),
    id: project.id,
    createdAt: project.createdAt,
    selectedIssue,
  }
}
