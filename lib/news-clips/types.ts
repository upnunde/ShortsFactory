import type { NewsAngleOption } from "./angles.ts"
import type { RecommendedNewsIssue } from "./issues.ts"
import { isPrimarilyKorean } from "./language.ts"
import { nextKoreaUploadSlot } from "../youtube-metadata.ts"

export type ProjectType = "character" | "news_clip"

export type NewsClipProductionMode = "report" | "buildup2"
export type NewsSourceSelectionMode = "single-range" | "video-summary"
export type NewsPreviewPart = "all" | "intro" | "lead" | "body" | "outro"

export type NewsChannelProfile = {
  id: string
  name: string
  language: string
  avatarUrl: string
  youtubeChannelId: string
  youtubeChannelCredentials: string
  createdAt: string
}

export type NewsSourceKind = "search" | "youtube" | "upload" | "web"

export type NewsSourceMediaType = "video" | "image"

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
  /** 원본 자료의 매체 유형. 레거시 저장본은 video로 해석한다. */
  mediaType?: NewsSourceMediaType
  /** 공개 자료 공급자와 라이선스 추적 정보. */
  provider?: string
  pageUrl?: string
  thumbnailUrl?: string
  creator?: string
  licenseName?: string
  licenseUrl?: string
  attribution?: string
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
  /** STT가 처음 만든 불변 원문. 사용자 오타 수정과 분리한다. */
  originalText?: string
  /** STT가 처음 만든 불변 단어 타임라인. */
  originalWords?: TranscriptWord[]
  /** 검수 화면에서 확정한 자막 종료 경계. 다음 구간의 시작점은 변경하지 않는다. */
  captionBoundaryAfter?: boolean
  /** 자동 전사 경계와 구분되는 사용자 확정 경계. */
  captionBoundarySource?: "automatic" | "manual"
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
  /** 원본 음성 자막이 가리키는 소스 영상의 절대 타임코드. */
  sourceStart?: number
  sourceEnd?: number
  text: string
  emphasis: string[]
  emphasisColor: "yellow" | "green"
  /** 사용자가 문구나 강조를 직접 고친 cue만 새 실측 타이밍에 다시 얹는다. */
  edited?: boolean
  /** 개별 초기화를 위해 마지막 자동 생성 문구·강조를 보관한다. */
  originalText?: string
  originalEmphasis?: string[]
  /** `다음과 합치기` 직전의 두 자막. 합치기 취소 시 시간까지 복원한다. */
  mergedFrom?: SubtitleCue[]
}

/** 보도 대본의 의미 파트. 배열 순서로 서두·본문을 추론하지 않는다. */
export type NewsReportScenePart = "lead" | "body" | "outro"

/** 장면의 기준 음성. 보도형은 tts, 빌드업 직접 발언만 original을 쓴다. */
export type NewsReportAudioMode = "tts" | "original"

/** 음성과 독립된 화면 소스의 역할. */
export type NewsReportVisualMode = "source" | "supporting" | "still" | "quote"

export type NewsMediaMotion =
  | "none"
  | "zoom-in"
  | "zoom-out"
  | "pan-left"
  | "pan-right"

export type NewsReportScene = {
  id: string
  narration: string
  /** 신규 장면은 반드시 저장하고, 없는 값은 레거시 장면으로 해석한다. */
  part?: NewsReportScenePart
  /** legacy visual과 분리된 음성 정책. */
  audioMode?: NewsReportAudioMode
  /** legacy visual과 분리된 화면 정책. */
  visualMode?: NewsReportVisualMode
  /** 레거시 프로젝트·렌더러 호환 필드. */
  visual: "source" | "quote"
  sourceId?: string
  sourceStart: number
  sourceEnd: number
  crop?: CropPosition
  /** 첨부 이미지·영상에 적용하는 약 5% 미세 화면 움직임. */
  motion?: NewsMediaMotion
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
  bodySourceText: NewsTextLayout
  sourceColor: string
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
  productionMode: NewsClipProductionMode
  /** 같은 빌드업 렌더 파이프라인에서 원본을 고르는 방식을 구분한다. */
  sourceSelectionMode: NewsSourceSelectionMode
  /** 영상 요약형에서 검수·대본 생성의 기준이 되는 원본 전체 요약. */
  sourceOverview: string
  /**
   * 빌드업형 편집 스냅샷의 일련번호. 대본·자막·구간·스타일이 바뀌면 증가한다.
   * 미리보기와 최종본은 이 번호를 저장해 예전 영상이 현재 편집본과 섞이지 않게 한다.
   */
  editorialRevision: number
  previewRevision: number
  finalRevision: number
  source: NewsSource | null
  supportingSources: NewsSource[]
  sourceIssueId: string
  selectedIssue: RecommendedNewsIssue | null
  angleOptions: NewsAngleOption[]
  selectedAngleId: string
  transcript: TranscriptSegment[]
  candidates: NewsClipCandidate[]
  selectedCandidateId: string
  title: string
  titleOptions: string[]
  reportScript: string
  supplementalContext: string
  /** 인트로·서두·본문·마무리에 공통으로 표시하는 프로젝트 출처. */
  sourceCredit: string
  reportScenes: NewsReportScene[]
  detectedSilences: RemovedRange[]
  removedRanges: RemovedRange[]
  keepRanges: KeepRange[]
  subtitles: SubtitleCue[]
  /** 미리보기 이후 확정된 자막 구간. true면 재렌더 때 start/end를 다시 나누지 않는다. */
  subtitleTimingsLocked: boolean
  crop: CropPosition
  bgmEnabled: boolean
  bgmVolume: number
  titleVolume: number
  sourceVolume: number
  quoteVolume: number
  /** 인트로 화면에 별도로 지정한 이미지·영상 소스. 비어 있으면 원본에서 자동 선택한다. */
  introSourceId: string
  introStillTimeSeconds: number | null
  introStillZoom: number
  introStillX: number
  introStillY: number
  /** 첨부 인트로 이미지·영상의 미세 화면 움직임. */
  introMotion: NewsMediaMotion
  titleCardDurationSeconds: number
  outputDurationSeconds: number
  finalPlaybackRate: number
  renderSignature: string
  outputUrl: string
  previewUrl: string
  /** 4클립 분리 미리보기. 없으면 합본 previewUrl만 쓴다. */
  previewIntroUrl: string
  previewLeadUrl: string
  previewBodyUrl: string
  previewOutroUrl: string
  previewSignature: string
  renderSettingsKey: string
  thumbnailUrl: string
  youtubeScheduledAt: string
  youtubeVideoId: string
  youtubeUploadUrl: string
  metadata: { youtubeTitle: string; description: string; tags: string[] }
}

export type NewsClipStep =
  "issue" | "source" | "angles" | "script" | "direction" | "preview" | "final"

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
  { id: "issue", label: "원본 추가", role: "YouTube URL 또는 영상 파일" },
  { id: "source", label: "원본 영상 선택", role: "보도 근거 결정" },
  {
    id: "angles",
    label: "핵심 내용 확인",
    role: "원본 근거와 사용할 논점 확정",
  },
  {
    id: "script",
    label: "내용 검수·확정",
    role: "인트로·서두·본문·마무리 내용 확정",
  },
  { id: "direction", label: "화면 연출 구성", role: "장면·음성 방식 확정" },
  {
    id: "preview",
    label: "초안 검수·수정",
    role: "실제 영상을 보며 제목·대본·자막·구간 수정",
  },
  {
    id: "final",
    label: "최종본",
    role: "720×1280 최종 렌더·품질 검사·업로드",
  },
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
  titleVoiceRate: 0,
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
  bodySourceText: {
    fontSize: 28,
    fontWeight: 500,
    letterSpacing: 0,
    x: 72,
    y: 1520,
    width: 936,
    alignment: "center",
  },
  sourceColor: "#b8bcc8",
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
    productionMode: "buildup2",
    sourceSelectionMode: "single-range",
    sourceOverview: "",
    editorialRevision: 1,
    previewRevision: 0,
    finalRevision: 0,
    source: null,
    supportingSources: [],
    sourceIssueId: "",
    selectedIssue: null,
    angleOptions: [],
    selectedAngleId: "",
    transcript: [],
    candidates: [],
    selectedCandidateId: "",
    title: "",
    titleOptions: [],
    reportScript: "",
    supplementalContext: "",
    sourceCredit: "",
    reportScenes: [],
    detectedSilences: [],
    removedRanges: [],
    keepRanges: [],
    subtitles: [],
    subtitleTimingsLocked: false,
    crop: { x: 50, y: 50, zoom: 1, faceTracking: false },
    bgmEnabled: true,
    bgmVolume: 0.12,
    titleVolume: 1,
    sourceVolume: 1,
    quoteVolume: 1,
    introSourceId: "",
    introStillTimeSeconds: null,
    introStillZoom: 1,
    introStillX: 50,
    introStillY: 50,
    introMotion: "zoom-in",
    titleCardDurationSeconds: 0,
    outputDurationSeconds: 0,
    finalPlaybackRate: 1.1,
    renderSignature: "",
    outputUrl: "",
    previewUrl: "",
    previewIntroUrl: "",
    previewLeadUrl: "",
    previewBodyUrl: "",
    previewOutroUrl: "",
    previewSignature: "",
    renderSettingsKey: "",
    thumbnailUrl: "",
    youtubeScheduledAt: nextKoreaUploadSlot(),
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
    productionMode: project.productionMode,
    sourceSelectionMode: project.sourceSelectionMode,
    youtubeScheduledAt: project.youtubeScheduledAt,
    selectedIssue,
  }
}
