import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import {
  introStillTime,
  selectIntroStillRange,
  type IntroStillRange,
} from "@/lib/news-clips/intro"
import { densifySourceKeeps } from "@/lib/news-clips/buildup"
import { prepareRenderProject } from "@/lib/news-clips/prepare-render-project"
import {
  finalPlaybackDuration,
  normalizeFinalPlaybackRate,
  retimeSubtitlesForFinalPlayback,
} from "@/lib/news-clips/final-playback"
import {
  NEWS_SOURCE_PLAYBACK_RATE,
  sourceFootageSecondsForOutput,
  sourceVideoSetpts,
} from "@/lib/news-clips/playback"
import { tightenQuoteSegment } from "@/lib/server/news-clips/quote-tighten"
import { detectAudioSilence } from "@/lib/server/news-clips/vad"
import { NEWS_SILENCE_CUT_MIN_SECONDS } from "@/lib/news-clips/vad"
import {
  NEWS_INTRO_GAP_SECONDS,
  NEWS_OUTRO_GAP_SECONDS,
  quoteTranscriptAlignment,
  applySubtitleTimingForRender,
  mergeEditedSubtitleText,
  reportCaptionPhrases,
  splitEndCtaFromScript,
} from "@/lib/news-clips/report"
import {
  partitionSubtitlesByPart,
  splitScenesByClipPart,
} from "@/lib/news-clips/clip-parts"
import { snapSubtitleCueTimes } from "@/lib/news-clips/frame-snap"
import { bodySourceCreditText } from "@/lib/news-clips/source-credit"
import { NEWS_RENDER_SCHEMA_VERSION } from "@/lib/news-clips/render-key"
import { concatNewsClips } from "@/lib/server/news-clips/concat-clips"
import {
  NEWS_PART_LOUDNORM,
  newsAudioEncodeArgs,
  newsRenderDimensions,
  newsVideoEncodeArgs,
} from "@/lib/server/news-clips/render-codec"
import { validateNewsClipOutput } from "@/lib/server/news-clips/output-validation"
import {
  normalizeKoreanRecognitionText,
  parseTranscript,
  replaceTranscriptRange,
  transcriptRangeIsReviewed,
  transcriptRangeLooksHallucinated,
  updateTranscriptSegmentText,
} from "@/lib/news-clips/transcript"
import { koreanSpeechUnits } from "@/lib/news-clips/korean-speech"
import {
  automaticSubtitleLineCharacterLimit,
  reflowSubtitleTextPreservingContent,
  layoutTimedSubtitleCues,
  resolveTextBox,
  splitIntroTitleLines,
  titleLineFits,
  titleLineRenderMetrics,
} from "@/lib/news-clips/text-layout"
import type { TypecastSpeechTiming } from "@/lib/news-clips/typecast-response"
import {
  downloadApprovedSource,
  readAnalysisCache,
  readSource,
  readStoredTranscript,
} from "@/lib/server/news-clips/source-store"
import { newsChannelId } from "@/lib/server/news-clips/channels"
import {
  newsTtsCacheIdentity,
  resolveNewsTtsProvider,
  synthesizeNewsSpeech,
  type ResolvedNewsTtsProvider,
} from "@/lib/server/news-clips/tts-provider"
import {
  transcribeRangeWithLocalWhisper,
  transcribeWithLocalWhisper,
} from "@/lib/server/news-clips/whisper"
import type {
  NewsClipProject,
  NewsClipSettings,
  NewsPreviewPart,
  NewsReportScene,
  NewsSource,
  SubtitleCue,
  TranscriptSegment,
} from "@/lib/news-clips/types"

const NEWS_RENDER_VERSION = NEWS_RENDER_SCHEMA_VERSION
const NEWS_TTS_PACING_VERSION = "ko-continuous-v3-natural-pauses"
const NEWS_TITLE_BACKGROUND = "/news-clips/news-preview-placeholder.png"

export async function renderNewsTextOverlay({
  mode,
  title,
  subtitle,
  sourceCredit = "",
  settings,
}: {
  mode: "title" | "body"
  title: string
  subtitle: string
  sourceCredit?: string
  settings: NewsClipSettings
}) {
  const folder = path.join(process.cwd(), "outputs", "news-text-preview")
  const key = digest({
    renderVersion: NEWS_RENDER_VERSION,
    mode,
    title,
    subtitle,
    sourceCredit,
    fontFamily: settings.fontFamily,
    titleCardText: settings.titleCardText,
    titleCardSecondFontSize: settings.titleCardSecondFontSize,
    titleCardLineHeightPercent: settings.titleCardLineHeightPercent,
    titleCardColor: settings.titleCardColor,
    titleCardSecondColor: settings.titleCardSecondColor,
    bodyTitleText: settings.bodyTitleText,
    bodyTitleColor: settings.bodyTitleColor,
    bodySubtitleText: settings.bodySubtitleText,
    subtitleColor: settings.subtitleColor,
    bodySourceText: settings.bodySourceText,
    sourceColor: settings.sourceColor,
    emphasisColor: settings.emphasisColor,
    safeMarginPercent: settings.safeMarginPercent,
  })
  const output = path.join(folder, `${key}.png`)
  if (await exists(output)) return readFile(output)

  await mkdir(folder, { recursive: true })
  const titleAss = path.join(folder, `${key}-title.ass`)
  const filters: string[] = ["format=rgba", "colorchannelmixer=aa=0"]
  if (mode === "title") {
    await writeFile(titleAss, titleAssText(title, 1, settings))
    filters.push(assAlphaFilter(titleAss))
  } else {
    const subtitleAss = path.join(folder, `${key}-subtitle.ass`)
    const sourceAss = path.join(folder, `${key}-source.ass`)
    await Promise.all([
      writeFile(titleAss, bodyTitleAssText(title, 1, settings)),
      writeFile(
        subtitleAss,
        subtitlesToAss(
          [
            {
              id: "preview",
              start: 0,
              end: 1,
              text: subtitle,
              emphasis: [],
              emphasisColor: "yellow",
            },
          ],
          settings
        )
      ),
      writeFile(sourceAss, bodySourceAssText(sourceCredit, 1, settings)),
    ])
    filters.push(
      assAlphaFilter(titleAss),
      assAlphaFilter(subtitleAss),
      assAlphaFilter(sourceAss)
    )
  }
  filters.push("format=rgba")
  await run(ffmpegBin(), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1080x1920:d=1:r=1",
    "-vf",
    filters.join(","),
    "-frames:v",
    "1",
    "-c:v",
    "png",
    output,
  ])
  return readFile(output)
}

export async function renderNewsFramePreview({
  mode,
  title,
  subtitle,
  sourceCredit = "",
  settings,
}: {
  mode: "title" | "body"
  title: string
  subtitle: string
  sourceCredit?: string
  settings: NewsClipSettings
}) {
  const folder = path.join(process.cwd(), "outputs", "news-frame-preview")
  const key = digest({
    renderVersion: NEWS_RENDER_VERSION,
    mode,
    title,
    subtitle,
    sourceCredit,
    titleFrameImage: settings.titleFrameImage,
    bodyFrameImage: settings.bodyFrameImage,
    videoRect: settings.videoRect,
    fontFamily: settings.fontFamily,
    titleCardText: settings.titleCardText,
    titleCardSecondFontSize: settings.titleCardSecondFontSize,
    titleCardLineHeightPercent: settings.titleCardLineHeightPercent,
    titleCardColor: settings.titleCardColor,
    titleCardSecondColor: settings.titleCardSecondColor,
    bodyTitleText: settings.bodyTitleText,
    bodyTitleColor: settings.bodyTitleColor,
    bodySubtitleText: settings.bodySubtitleText,
    subtitleColor: settings.subtitleColor,
    bodySourceText: settings.bodySourceText,
    sourceColor: settings.sourceColor,
    emphasisColor: settings.emphasisColor,
    safeMarginPercent: settings.safeMarginPercent,
  })
  const output = path.join(folder, `${key}.png`)
  if (await exists(output)) return readFile(output)

  await mkdir(folder, { recursive: true })
  const placeholder = publicFile(NEWS_TITLE_BACKGROUND)
  if (!placeholder) throw new Error("news-preview-placeholder-missing")
  const titleAss = path.join(folder, `${key}-title.ass`)
  const subtitleAss = path.join(folder, `${key}-subtitle.ass`)
  const sourceAss = path.join(folder, `${key}-source.ass`)
  const frame = publicFile(
    mode === "title" ? settings.titleFrameImage : settings.bodyFrameImage
  )

  if (mode === "title") {
    await writeFile(titleAss, titleAssText(title, 1, settings))
    const frameFilter = frame
      ? `;[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,setsar=1[title-frame];[title-bg][title-frame]overlay=0:0:format=auto[title-composed]`
      : ""
    const titleInput = frame ? "title-composed" : "title-bg"
    await run(ffmpegBin(), [
      "-y",
      "-loop",
      "1",
      "-i",
      placeholder,
      ...(frame ? ["-loop", "1", "-i", frame] : []),
      "-filter_complex",
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[title-bg]${frameFilter};[${titleInput}]${assFilter(titleAss)}[v]`,
      "-map",
      "[v]",
      "-frames:v",
      "1",
      "-c:v",
      "png",
      output,
    ])
    return readFile(output)
  }

  await Promise.all([
    writeFile(titleAss, bodyTitleAssText(title, 1, settings)),
    writeFile(
      subtitleAss,
      subtitlesToAss(
        [
          {
            id: "preview",
            start: 0,
            end: 1,
            text: subtitle,
            emphasis: [],
            emphasisColor: "yellow",
          },
        ],
        settings
      )
    ),
    writeFile(sourceAss, bodySourceAssText(sourceCredit, 1, settings)),
  ])
  const rect = settings.videoRect
  const frameFilter = frame
    ? `[1:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg]`
    : "color=c=#101114:s=1080x1920:r=1:d=1[bg]"
  const sceneWidth = Math.round(rect.width * 1.22)
  const sceneHeight = Math.round(rect.height * 1.22)
  const filter = [
    `[0:v]scale=${sceneWidth}:${sceneHeight}:force_original_aspect_ratio=increase,crop=${rect.width}:${rect.height}:x='(iw-ow)*0.42':y='if(gte(iw/ih\\,1.2)\\,0\\,(ih-oh)*0.34)',setsar=1[clip]`,
    frameFilter,
    `[bg][clip]overlay=${rect.x}:${rect.y}[framed]`,
    `[framed]${assFilter(titleAss)},${assFilter(subtitleAss)},${assFilter(sourceAss)}[v]`,
  ].join(";")
  await run(ffmpegBin(), [
    "-y",
    "-loop",
    "1",
    "-i",
    placeholder,
    ...(frame ? ["-loop", "1", "-i", frame] : []),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-frames:v",
    "1",
    "-c:v",
    "png",
    output,
  ])
  return readFile(output)
}

export async function renderNewsClip(
  project: NewsClipProject,
  settings: NewsClipSettings,
  mode: "preview" | "final" = "final",
  options: {
    force?: boolean
    onProgress?: (percent: number, label: string) => void | Promise<void>
    signal?: AbortSignal
    finalPlaybackRate?: number
    previewPart?: NewsPreviewPart
  } = {}
) {
  const progress = async (percent: number, label: string) => {
    if (options.signal?.aborted) throw new Error("render-cancelled")
    await options.onProgress?.(percent, label)
    if (options.signal?.aborted) throw new Error("render-cancelled")
  }
  await progress(2, "프로젝트 확인 중")
  const force = options.force === true
  const previewPart =
    mode === "preview" ? (options.previewPart ?? "all") : "all"
  const forceAll = force && previewPart === "all"
  const forcePart = (part: Exclude<typeof previewPart, "all">) =>
    forceAll || (force && previewPart === part)
  const finalPlaybackRate =
    mode === "final" ? normalizeFinalPlaybackRate(options.finalPlaybackRate) : 1
  if (
    mode === "final" &&
    project.previewRevision !== project.editorialRevision
  ) {
    throw new Error("preview-revision-stale")
  }
  const renderTitle = splitIntroTitleLines(
    project.title,
    settings.titleCardText
  )
    .filter(Boolean)
    .join("\n")
  project = {
    ...project,
    title: renderTitle,
    metadata: {
      ...project.metadata,
      youtubeTitle: renderTitle.replace(/\s*\n\s*/g, " "),
    },
  }
  const prepared = prepareRenderProject(project, settings, {
    lockTimeline: project.subtitleTimingsLocked,
  })
  if (prepared.reason) throw new Error(prepared.reason)
  project = prepared.project
  validateProject(project, settings)
  const sources = await resolveProjectSources(project)
  const source = sources.get(project.source!.id)
  if (!source) throw new Error("source-upload-required")
  const freshSilences = await detectAudioSilence(source.localFile).catch(
    () => project.detectedSilences
  )
  project = {
    ...project,
    detectedSilences: freshSilences,
  }
  await progress(8, "원본 확인 완료")
  const sourceFiles = new Map(
    [...sources].map(([sourceId, item]) => [sourceId, item.localFile])
  )
  const sourceTranscripts = new Map(
    await Promise.all(
      [...sources.keys()].map(async (sourceId) => {
        if (sourceId === source.id && project.transcript.length) {
          return [sourceId, project.transcript] as const
        }
        const stored = await readStoredTranscript(sourceId)
        return [sourceId, stored ? parseTranscript(stored) : []] as const
      })
    )
  )
  const refreshedTranscriptSources = await refreshUnreliableQuoteTranscripts({
    project,
    sourceFiles,
    sourceTranscripts,
  })
  const refreshedPrimaryTranscript = sourceTranscripts.get(source.id)
  if (refreshedPrimaryTranscript) {
    project = {
      ...project,
      transcript: refreshedPrimaryTranscript,
    }
  }

  const folder = path.join(
    process.cwd(),
    "public",
    "news-clips",
    "output",
    project.id
  )
  // 강제 재생성도 각 출력 파일만 덮어쓴다. 폴더를 지우면
  // 검수한 미리보기와 Typecast 음성 캐시까지 사라져 최종본에서
  // 불필요한 재호출·재비용이 발생한다.
  await mkdir(folder, { recursive: true })
  const prefix = mode === "preview" ? "preview-" : ""
  const dimensions = newsRenderDimensions(mode)
  const ttsProvider = await resolveNewsTtsProvider(settings)
  await progress(10, "음성 준비 중")
  const ttsIdentity = newsTtsCacheIdentity(ttsProvider)
  const captions = path.join(folder, "captions.srt")
  const leadCaptionsAss = path.join(folder, `${prefix}lead-captions.ass`)
  const bodyCaptionsAss = path.join(folder, `${prefix}body-captions.ass`)
  const outroCaptionsAss = path.join(folder, `${prefix}outro-captions.ass`)
  const titleAss = path.join(folder, `${prefix}title.ass`)
  const leadTitleAss = path.join(folder, `${prefix}lead-title.ass`)
  const bodyTitleAss = path.join(folder, `${prefix}body-title.ass`)
  const outroTitleAss = path.join(folder, `${prefix}outro-title.ass`)
  const titleKey = createHash("sha256")
    .update(
      JSON.stringify({
        title: project.title,
        pacing: NEWS_TTS_PACING_VERSION,
        tts: ttsIdentity,
        rate: settings.titleVoiceRate,
      })
    )
    .digest("hex")
    .slice(0, 16)
  const titleAudioRaw = path.join(folder, `title-${titleKey}-raw.wav`)
  const titleAudio = path.join(folder, `title-${titleKey}.wav`)
  const introVideo = path.join(folder, `${prefix}intro.mp4`)
  const leadVideo = path.join(folder, `${prefix}lead.mp4`)
  const bodyVideo = path.join(folder, `${prefix}body.mp4`)
  const outroVideo = path.join(folder, `${prefix}outro.mp4`)
  const joinedVideo = path.join(folder, `${prefix}joined.mp4`)
  const concatList = path.join(folder, `${prefix}concat.txt`)
  const finalVideo = path.join(
    folder,
    mode === "preview" ? "preview.mp4" : "final.mp4"
  )
  const mixedVideo =
    mode === "final" && finalPlaybackRate > 1
      ? path.join(folder, "final-mixed.mp4")
      : finalVideo
  const titleFrame = path.join(folder, `${prefix}title-frame.png`)
  const thumbnail = path.join(folder, "thumbnail.png")
  const cachePath = path.join(folder, `${prefix}render-cache.json`)

  await synthesizeSpeech(project.title, settings, titleAudioRaw, ttsProvider)
  const titleRawDurationSeconds = await mediaDuration(titleAudioRaw)
  await normalizePartAudio(titleAudioRaw, titleAudio, titleRawDurationSeconds)
  const titleSpeechDurationSeconds = await mediaDuration(titleAudio)
  const titleCardDurationSeconds = roundDuration(
    titleSpeechDurationSeconds + NEWS_INTRO_GAP_SECONDS
  )
  await progress(20, "인트로 음성 완료")

  const {
    lead: leadScenesPlanned,
    body: bodyScenesPlanned,
    outro: outroScenesPlanned,
  } = splitScenesByClipPart(project.reportScenes, project.productionMode)

  const primarySourceId = source.id
  async function synthesizePart(
    scenes: typeof leadScenesPlanned,
    part: "lead" | "body" | "outro"
  ) {
    if (!scenes.length) return null
    return synthesizeReport(
      scenes,
      settings,
      folder,
      sourceFiles,
      primarySourceId,
      project.sourceVolume,
      project.quoteVolume,
      ttsProvider,
      sourceTranscripts,
      part
    )
  }

  const leadReport = await synthesizePart(leadScenesPlanned, "lead")
  await progress(35, "도입부 음성 완료")
  const bodyReport = await synthesizePart(bodyScenesPlanned, "body")
  await progress(45, "본문 음성 완료")
  const outroReport = await synthesizePart(outroScenesPlanned, "outro")
  await progress(52, "마무리 음성 완료")
  if (!leadReport && !bodyReport) {
    throw new Error("report-scenes-required")
  }

  const leadDurationSeconds = roundDuration(leadReport?.duration ?? 0)
  const bodyDurationSeconds = roundDuration(bodyReport?.duration ?? 0)
  const outroDurationSeconds = outroReport
    ? roundDuration(outroReport.duration + NEWS_OUTRO_GAP_SECONDS)
    : 0
  const outputDurationSeconds = roundDuration(
    titleCardDurationSeconds +
      leadDurationSeconds +
      bodyDurationSeconds +
      outroDurationSeconds
  )
  const { body: bodyScript, cta: endCtaScript } = splitEndCtaFromScript(
    project.reportScript
  )
  const narrationOf = (scenes: typeof leadScenesPlanned) =>
    scenes
      .map((scene) => scene.narration.trim())
      .filter(Boolean)
      .join("\n")
  const lockedParts = partitionSubtitlesByPart(
    project.subtitles,
    leadScenesPlanned,
    bodyScenesPlanned
  )

  function partSubtitles(options: {
    planned: typeof leadScenesPlanned
    report: NonNullable<typeof leadReport> | null
    edited: typeof project.subtitles
    offsetSeconds: number
    phrases: string
  }) {
    if (!options.report || !options.planned.length) return []
    const transcriptWasRefreshed = options.planned.some((scene) =>
      refreshedTranscriptSources.has(scene.sourceId || primarySourceId)
    )
    if (
      project.subtitleTimingsLocked &&
      options.edited.length &&
      !transcriptWasRefreshed
    ) {
      // 확정한 문구·개수·시간은 보존하되, 폰트·폭 설정이 바뀌면
      // FFmpeg 실제 폭에 맞게 줄바꿈만 다시 적용한다.
      return options.edited.map((cue) => ({
        ...cue,
        start: cue.start - options.offsetSeconds,
        end: cue.end - options.offsetSeconds,
        text: reflowSubtitleTextPreservingContent(
          cue.text,
          settings.bodySubtitleText
        ),
      }))
    }
    const localEdited = options.edited.map((cue) => ({
      ...cue,
      start: Math.max(0, cue.start - options.offsetSeconds),
      end: Math.max(0.04, cue.end - options.offsetSeconds),
    }))
    const measured = snapSubtitleCueTimes(
      layoutTimedSubtitleCues(
        applySubtitleTimingForRender(
          localEdited,
          options.planned,
          options.report.scenes,
          {
            lockTimings:
              project.subtitleTimingsLocked && !transcriptWasRefreshed,
            captionPhrases: reportCaptionPhrases(options.phrases),
            transcript: project.transcript,
            maxCaptionCharacters:
              automaticSubtitleLineCharacterLimit(settings.bodySubtitleText) *
              2,
          }
        ),
        settings.bodySubtitleText
      )
    )
    return transcriptWasRefreshed
      ? mergeEditedSubtitleText(measured, localEdited)
      : measured
  }

  const leadSubtitles = partSubtitles({
    planned: leadScenesPlanned,
    report: leadReport,
    edited: lockedParts.lead,
    offsetSeconds: 0,
    phrases: narrationOf(leadScenesPlanned) || bodyScript,
  })
  const bodySubtitles = partSubtitles({
    planned: bodyScenesPlanned,
    report: bodyReport,
    edited: lockedParts.body,
    offsetSeconds: leadDurationSeconds,
    phrases: narrationOf(bodyScenesPlanned) || bodyScript,
  })
  const outroSubtitlesLocal = partSubtitles({
    planned: outroScenesPlanned,
    report: outroReport,
    edited: lockedParts.outro,
    offsetSeconds: leadDurationSeconds + bodyDurationSeconds,
    phrases: endCtaScript,
  })
  const combinedSubtitles = snapSubtitleCueTimes([
    ...leadSubtitles,
    ...bodySubtitles.map((cue) => ({
      ...cue,
      start: roundDuration(cue.start + leadDurationSeconds),
      end: roundDuration(cue.end + leadDurationSeconds),
    })),
    ...outroSubtitlesLocal.map((cue) => ({
      ...cue,
      start: roundDuration(
        cue.start + leadDurationSeconds + bodyDurationSeconds
      ),
      end: roundDuration(cue.end + leadDurationSeconds + bodyDurationSeconds),
    })),
  ])
  const exportSubtitles = combinedSubtitles.map((cue) => ({
    ...cue,
    start: roundDuration(cue.start + titleCardDurationSeconds),
    end: roundDuration(cue.end + titleCardDurationSeconds),
  }))

  const effectiveProject: NewsClipProject = {
    ...project,
    subtitles: combinedSubtitles,
    titleCardDurationSeconds,
    outputDurationSeconds,
  }
  const titleStillRange = selectIntroStillRange(effectiveProject)
  const titleStillSource =
    sourceFiles.get(titleStillRange.sourceId) ?? source.localFile
  const titleStill = await extractTitleStill(
    titleStillSource,
    titleStillRange,
    folder
  )
  await progress(56, "화면 구성 완료")
  const renderCache = await readRenderCache(cachePath)
  const saveRenderStage = async (patch: RenderCache) => {
    Object.assign(renderCache, patch)
    await writeRenderCache(cachePath, renderCache)
  }
  const introVideoSignature = digest({
    renderVersion: NEWS_RENDER_VERSION,
    part: "intro",
    title: effectiveProject.title,
    titleVolume: effectiveProject.titleVolume,
    introStillZoom: effectiveProject.introStillZoom,
    introStillX: effectiveProject.introStillX,
    introStillY: effectiveProject.introStillY,
    titleCardDurationSeconds,
    titleFrameImage: settings.titleFrameImage,
    titleBackgroundImage: {
      source: titleStillSource,
      range: titleStillRange,
    },
    tts: ttsIdentity,
    titleVoiceRate: settings.titleVoiceRate,
    fontFamily: settings.fontFamily,
    titleCardText: settings.titleCardText,
    titleCardSecondFontSize: settings.titleCardSecondFontSize,
    titleCardLineHeightPercent: settings.titleCardLineHeightPercent,
    titleCardColor: settings.titleCardColor,
    titleCardSecondColor: settings.titleCardSecondColor,
    safeMarginPercent: settings.safeMarginPercent,
    dimensions,
  })
  function contentPartSignature(
    part: "lead" | "body" | "outro",
    report: NonNullable<typeof leadReport>,
    subtitles: typeof leadSubtitles,
    durationSeconds: number
  ) {
    return digest({
      renderVersion: NEWS_RENDER_VERSION,
      part,
      sources: [...sourceFiles],
      reportScenes: report.scenes,
      reportAudio: report.signature,
      sourcePlaybackRate: NEWS_SOURCE_PLAYBACK_RATE,
      subtitles,
      title: effectiveProject.title,
      crop: effectiveProject.crop,
      sourceVolume: effectiveProject.sourceVolume,
      quoteVolume: effectiveProject.quoteVolume,
      durationSeconds,
      bodyFrameImage: settings.bodyFrameImage,
      videoRect: settings.videoRect,
      fontFamily: settings.fontFamily,
      bodyTitleText: settings.bodyTitleText,
      bodyTitleColor: settings.bodyTitleColor,
      bodySubtitleText: settings.bodySubtitleText,
      bodySourceText: settings.bodySourceText,
      sourceColor: settings.sourceColor,
      sourceCredit: bodySourceCreditText(source),
      emphasisColor: settings.emphasisColor,
      subtitleColor: settings.subtitleColor,
      safeMarginPercent: settings.safeMarginPercent,
      dimensions,
    })
  }
  const leadVideoSignature = leadReport
    ? contentPartSignature(
        "lead",
        leadReport,
        leadSubtitles,
        leadDurationSeconds
      )
    : "none"
  const bodyVideoSignature = bodyReport
    ? contentPartSignature(
        "body",
        bodyReport,
        bodySubtitles,
        bodyDurationSeconds
      )
    : "none"
  const outroVideoSignature = outroReport
    ? contentPartSignature(
        "outro",
        outroReport,
        outroSubtitlesLocal,
        outroDurationSeconds
      )
    : "none"
  const joinedSignature = digest({
    introVideoSignature,
    leadVideoSignature,
    bodyVideoSignature,
    outroVideoSignature,
  })
  const outputSignature = digest({
    joinedSignature,
    bgmEnabled: effectiveProject.bgmEnabled,
    bgmVolume: effectiveProject.bgmVolume,
    bgmFile: settings.bgmFile,
    finalPlaybackRate,
  })
  const leadSourceAss = path.join(folder, `${prefix}lead-source.ass`)
  const bodySourceAss = path.join(folder, `${prefix}body-source.ass`)
  const outroSourceAss = path.join(folder, `${prefix}outro-source.ass`)
  const sourceCredit = bodySourceCreditText(source)

  const exportCaptionCues =
    mode === "final"
      ? retimeSubtitlesForFinalPlayback(exportSubtitles, finalPlaybackRate)
      : exportSubtitles
  await Promise.all([
    writeFile(captions, subtitlesToSrt(exportCaptionCues)),
    writeFile(leadCaptionsAss, subtitlesToAss(leadSubtitles, settings)),
    writeFile(bodyCaptionsAss, subtitlesToAss(bodySubtitles, settings)),
    writeFile(outroCaptionsAss, subtitlesToAss(outroSubtitlesLocal, settings)),
    writeFile(
      titleAss,
      titleAssText(effectiveProject.title, titleCardDurationSeconds, settings)
    ),
    writeFile(
      leadTitleAss,
      bodyTitleAssText(
        effectiveProject.title,
        Math.max(0.1, leadDurationSeconds),
        settings
      )
    ),
    writeFile(
      leadSourceAss,
      bodySourceAssText(
        sourceCredit,
        Math.max(0.1, leadDurationSeconds),
        settings
      )
    ),
    writeFile(
      bodyTitleAss,
      bodyTitleAssText(
        effectiveProject.title,
        Math.max(0.1, bodyDurationSeconds),
        settings
      )
    ),
    writeFile(
      bodySourceAss,
      bodySourceAssText(
        sourceCredit,
        Math.max(0.1, bodyDurationSeconds),
        settings
      )
    ),
    writeFile(
      outroTitleAss,
      bodyTitleAssText(
        effectiveProject.title,
        Math.max(0.1, outroDurationSeconds),
        settings
      )
    ),
    writeFile(
      outroSourceAss,
      bodySourceAssText(
        sourceCredit,
        Math.max(0.1, outroDurationSeconds),
        settings
      )
    ),
    writeFile(
      path.join(folder, "manifest.json"),
      `${JSON.stringify(manifestOf(effectiveProject, sources, dimensions), null, 2)}\n`
    ),
    writeFile(
      path.join(folder, "youtube-metadata.json"),
      `${JSON.stringify(effectiveProject.metadata, null, 2)}\n`
    ),
  ])
  await progress(60, "자막 준비 완료")

  if (
    forcePart("intro") ||
    renderCache.introVideoSignature !== introVideoSignature ||
    !(await exists(introVideo))
  ) {
    await makeTitleVideo(
      settings,
      titleStill,
      effectiveProject.introStillZoom,
      effectiveProject.introStillX,
      effectiveProject.introStillY,
      effectiveProject.titleVolume,
      titleAss,
      titleAudio,
      introVideo,
      dimensions,
      titleCardDurationSeconds
    )
  }
  await saveRenderStage({ introVideoSignature })
  await progress(69, "인트로 영상 완료")
  if (
    leadReport &&
    (forcePart("lead") ||
      renderCache.leadVideoSignature !== leadVideoSignature ||
      !(await exists(leadVideo)))
  ) {
    await makeBodyVideo(
      effectiveProject,
      settings,
      sourceFiles,
      source.id,
      leadReport.audio,
      leadReport.scenes,
      leadCaptionsAss,
      leadTitleAss,
      leadSourceAss,
      leadVideo,
      dimensions,
      leadDurationSeconds
    )
  }
  await saveRenderStage({ leadVideoSignature })
  await progress(78, "도입부 영상 완료")
  if (
    bodyReport &&
    (forcePart("body") ||
      renderCache.bodyVideoSignature !== bodyVideoSignature ||
      !(await exists(bodyVideo)))
  ) {
    await makeBodyVideo(
      effectiveProject,
      settings,
      sourceFiles,
      source.id,
      bodyReport.audio,
      bodyReport.scenes,
      bodyCaptionsAss,
      bodyTitleAss,
      bodySourceAss,
      bodyVideo,
      dimensions,
      bodyDurationSeconds
    )
  }
  await saveRenderStage({ bodyVideoSignature })
  await progress(87, "본문 영상 완료")
  if (
    outroReport &&
    (forcePart("outro") ||
      renderCache.outroVideoSignature !== outroVideoSignature ||
      !(await exists(outroVideo)))
  ) {
    await makeBodyVideo(
      effectiveProject,
      settings,
      sourceFiles,
      source.id,
      outroReport.audio,
      outroReport.scenes,
      outroCaptionsAss,
      outroTitleAss,
      outroSourceAss,
      outroVideo,
      dimensions,
      outroDurationSeconds
    )
  }
  await saveRenderStage({ outroVideoSignature })
  await progress(92, "마무리 영상 완료")
  if (
    forceAll ||
    renderCache.joinedSignature !== joinedSignature ||
    !(await exists(joinedVideo))
  ) {
    const parts = [
      introVideo,
      ...(leadReport ? [leadVideo] : []),
      ...(bodyReport ? [bodyVideo] : []),
      ...(outroReport ? [outroVideo] : []),
    ]
    await concatNewsClips(parts, joinedVideo, concatList, run)
  }
  await saveRenderStage({ joinedSignature })
  await progress(96, "영상 합치기 완료")
  if (
    forceAll ||
    renderCache.outputSignature !== outputSignature ||
    !(await exists(finalVideo))
  ) {
    await applyBgm(effectiveProject, settings, joinedVideo, mixedVideo)
    if (mode === "final" && finalPlaybackRate > 1) {
      await applyFinalPlaybackRate(
        mixedVideo,
        finalVideo,
        finalPlaybackRate,
        dimensions
      )
    }
  }
  await progress(98, "음향 적용 완료")
  const renderedOutputDurationSeconds =
    mode === "final"
      ? finalPlaybackDuration(outputDurationSeconds, finalPlaybackRate)
      : outputDurationSeconds
  await validateNewsClipOutput(
    finalVideo,
    dimensions,
    renderedOutputDurationSeconds
  )
  await saveRenderStage({ outputSignature })
  if (mode === "final") {
    await run(ffmpegBin(), [
      "-y",
      "-ss",
      "0.15",
      "-i",
      introVideo,
      "-frames:v",
      "1",
      titleFrame,
    ])
    await copyFile(titleFrame, thumbnail)
  }
  await progress(100, "완료")

  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        project: effectiveProject,
        settings,
        mode,
        finalPlaybackRate,
      })
    )
    .digest("hex")
  const base = `/news-clips/output/${project.id}`
  if (mode === "preview") {
    const previewVersion = force
      ? `${signature.slice(0, 12)}-${Date.now().toString(36)}`
      : signature.slice(0, 12)
    return {
      signature,
      previewUrl: `${base}/preview.mp4?v=${previewVersion}`,
      previewIntroUrl: `${base}/preview-intro.mp4?v=${previewVersion}`,
      previewLeadUrl: leadReport
        ? `${base}/preview-lead.mp4?v=${previewVersion}`
        : "",
      previewBodyUrl: bodyReport
        ? `${base}/preview-body.mp4?v=${previewVersion}`
        : "",
      previewOutroUrl: outroReport
        ? `${base}/preview-outro.mp4?v=${previewVersion}`
        : "",
      titleCardDurationSeconds,
      outputDurationSeconds,
      subtitles: effectiveProject.subtitles,
      reportScenes: effectiveProject.reportScenes,
      transcript: effectiveProject.transcript,
    }
  }
  const outputVersion = force
    ? `${signature.slice(0, 12)}-${Date.now().toString(36)}`
    : signature.slice(0, 12)
  return {
    signature,
    outputUrl: `${base}/final.mp4?v=${outputVersion}`,
    previewIntroUrl: `${base}/intro.mp4?v=${outputVersion}`,
    previewLeadUrl: leadReport ? `${base}/lead.mp4?v=${outputVersion}` : "",
    previewBodyUrl: bodyReport ? `${base}/body.mp4?v=${outputVersion}` : "",
    previewOutroUrl: outroReport ? `${base}/outro.mp4?v=${outputVersion}` : "",
    thumbnailUrl: `${base}/thumbnail.png?v=${outputVersion}`,
    captionsUrl: `${base}/captions.srt`,
    titleFrameUrl: `${base}/title-frame.png`,
    manifestUrl: `${base}/manifest.json`,
    titleCardDurationSeconds,
    outputDurationSeconds: renderedOutputDurationSeconds,
    finalPlaybackRate,
    subtitles: effectiveProject.subtitles,
    reportScenes: effectiveProject.reportScenes,
    transcript: effectiveProject.transcript,
  }
}

/**
 * 예전 YouTube 롤링 자막은 서로 겹친 문장 구간만 있고 실제 단어 신뢰도가 없다.
 * 직접 발언으로 쓰는 범위만 원본 음성에서 다시 전사해 자막 시작·끝을 실제 발화에
 * 맞춘다. 이미 로컬 Whisper 단어 시간이 있는 범위는 다시 처리하지 않는다.
 */
async function refreshUnreliableQuoteTranscripts({
  project,
  sourceFiles,
  sourceTranscripts,
}: {
  project: NewsClipProject
  sourceFiles: Map<string, string>
  sourceTranscripts: Map<string, TranscriptSegment[]>
}) {
  const primarySourceId = project.source!.id
  const rangesBySource = new Map<
    string,
    Array<{ start: number; end: number }>
  >()
  for (const scene of project.reportScenes) {
    if (
      scene.visual !== "quote" ||
      !Number.isFinite(scene.sourceStart) ||
      !Number.isFinite(scene.sourceEnd) ||
      scene.sourceEnd <= scene.sourceStart
    ) {
      continue
    }
    const sourceId = scene.sourceId || primarySourceId
    const ranges = rangesBySource.get(sourceId) ?? []
    ranges.push({ start: scene.sourceStart, end: scene.sourceEnd })
    rangesBySource.set(sourceId, ranges)
  }

  const refreshed = new Set<string>()
  for (const [sourceId, rawRanges] of rangesBySource) {
    const sourceFile = sourceFiles.get(sourceId)
    if (!sourceFile) continue
    let transcript = sourceTranscripts.get(sourceId) ?? []
    for (const range of mergeTimeRanges(rawRanges)) {
      // 검수 화면에 올라온 자동 구간과 사용자 수정본은 단일 진실 원본이다.
      // 반복 문구처럼 보여도 분석 캐시나 Whisper 결과로 절대 덮어쓰지 않는다.
      if (transcriptRangeIsReviewed(transcript, range)) continue
      if (
        transcriptRangeHasReliableWords(transcript, range) &&
        !transcriptRangeLooksHallucinated(transcript, range)
      ) {
        continue
      }

      let replacement: TranscriptSegment[] | null = null
      try {
        // 분석 단계에서 확정한 전사는 선택 구간과 함께 검수된 결과다.
        // 미리보기 재생성 중 생긴 환각보다 이 스냅샷을 가장 먼저 복구한다.
        const cached = await readAnalysisCache(sourceId)
        const cachedTranscript =
          cached &&
          typeof cached === "object" &&
          Array.isArray((cached as { transcript?: unknown }).transcript)
            ? (cached as { transcript: unknown[] }).transcript
            : []
        if (cachedTranscript.length) {
          const analyzed = normalizeWhisperTranscript(
            JSON.stringify({ segments: cachedTranscript }),
            sourceId,
            range,
            "analysis"
          )
          if (usableWhisperReplacement(analyzed, range)) {
            replacement = analyzed
          }
        }
      } catch {
        // 분석 스냅샷이 없으면 전체 원본 전사로 복구한다.
      }
      if (!replacement) {
        try {
          // 전체 원본 전사는 앞뒤 음성 문맥을 유지하므로 긴 구간 단독 전사보다
          // 반복 환각이 훨씬 적다. 이미 분석 때 만든 캐시를 우선 재사용한다.
          const full = normalizeWhisperTranscript(
            await transcribeWithLocalWhisper(sourceFile, sourceId),
            sourceId,
            range,
            "full"
          )
          if (usableWhisperReplacement(full, range)) replacement = full
        } catch {
          // 전체 전사 캐시가 없거나 읽지 못하면 아래 구간 전사를 시도한다.
        }
      }
      if (!replacement) {
        try {
          const ranged = normalizeWhisperTranscript(
            await transcribeRangeWithLocalWhisper(sourceFile, sourceId, range),
            sourceId,
            range,
            "range"
          )
          if (usableWhisperReplacement(ranged, range)) replacement = ranged
        } catch {
          // 로컬 Whisper를 사용할 수 없는 환경에서는 기존 전사를 유지한다.
        }
      }
      if (replacement?.length) {
        const reviewedBoundaries = transcript.some(
          (segment) =>
            segment.captionBoundaryAfter === true &&
            segment.captionBoundarySource === "manual" &&
            segment.end > range.start &&
            segment.start < range.end
        )
        if (reviewedBoundaries) {
          replacement = replacement.map((segment) =>
            segment.end > range.start && segment.start < range.end
              ? {
                  ...segment,
                  captionBoundaryAfter: true,
                  captionBoundarySource: "manual",
                }
              : segment
          )
        }
        transcript = replaceTranscriptRange(transcript, replacement, range)
        refreshed.add(sourceId)
      }
    }
    sourceTranscripts.set(sourceId, transcript)
  }
  return refreshed
}

function usableWhisperReplacement(
  transcript: TranscriptSegment[],
  range: { start: number; end: number }
) {
  return (
    transcriptRangeHasReliableWords(transcript, range) &&
    !transcriptRangeLooksHallucinated(transcript, range)
  )
}

function normalizeWhisperTranscript(
  raw: string,
  sourceId: string,
  range: { start: number; end: number },
  scope: "analysis" | "full" | "range"
) {
  return parseTranscript(raw).map((segment, index) => {
    const normalized = normalizeKoreanRecognitionText(segment.text)
    const corrected = updateTranscriptSegmentText(segment, normalized)
    return {
      ...corrected,
      id: `local-${digest({ sourceId, range, scope, index }).slice(0, 16)}`,
    }
  })
}

function transcriptRangeHasReliableWords(
  transcript: TranscriptSegment[],
  range: { start: number; end: number }
) {
  const segments = transcript.filter(
    (segment) => segment.end > range.start && segment.start < range.end
  )
  const words = segments.flatMap((segment) =>
    segment.words.filter(
      (word) => word.end > range.start && word.start < range.end
    )
  )
  // 검수 화면에서 실제 단어 시간으로 만든 짧은 호흡 구간은 confidence가
  // 없는 SRT 원본이어도 다시 전사해 경계를 잃지 않는다.
  const reviewedTimeline =
    segments.length > 0 &&
    segments.every((segment) => segment.captionBoundarySource !== undefined)
  if (reviewedTimeline && words.length >= 3) return true
  return (
    words.length >= 3 &&
    words.filter((word) => Number.isFinite(word.confidence)).length /
      words.length >=
      0.7
  )
}

function mergeTimeRanges(ranges: Array<{ start: number; end: number }>) {
  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges
    .map((item) => ({
      start: Math.min(item.start, item.end),
      end: Math.max(item.start, item.end),
    }))
    .sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end + 0.25) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

function validateProject(project: NewsClipProject, settings: NewsClipSettings) {
  const reason = invalidProjectReason(project, settings)
  if (reason) throw new Error(reason)
}

function invalidProjectReason(
  project: NewsClipProject,
  settings: NewsClipSettings
) {
  const [firstTitleLine, secondTitleLine] = splitIntroTitleLines(
    project.title,
    settings.titleCardText
  )
  const secondTitleLayout = {
    ...settings.titleCardText,
    fontSize: settings.titleCardSecondFontSize,
  }
  if (project.type !== "news_clip") return "invalid-project"
  if (!newsChannelId(project.profileId)) return "invalid-channel"
  if (!/^[0-9a-f-]{36}$/i.test(project.id)) return "invalid-project-id"
  if (!project.source?.approved) return "source-not-approved"
  if (!project.title.trim()) return "title-required"
  if (!secondTitleLine) return "title-second-line-required"
  if (!titleLineFits(firstTitleLine, settings.titleCardText)) {
    return "title-first-line-overflow"
  }
  if (!titleLineFits(secondTitleLine, secondTitleLayout)) {
    return "title-second-line-overflow"
  }
  if (!project.reportScript.trim()) return "report-script-required"
  if (project.reportScenes.length === 0) return "report-scenes-required"
  // quote 무음컷(…-cut-2 이후)은 원본 음성만 쓰므로 narration이 비어 있을 수 있다.
  const brokenScene = project.reportScenes.find((scene) => {
    if (scene.visual === "quote") {
      return (
        !Number.isFinite(scene.sourceStart) ||
        !Number.isFinite(scene.sourceEnd) ||
        scene.sourceEnd <= scene.sourceStart
      )
    }
    return !scene.narration.trim()
  })
  if (brokenScene) {
    return brokenScene.visual === "quote"
      ? "report-scene-quote-range-invalid"
      : "report-scene-narration-required"
  }
  return ""
}

async function resolveProjectSources(project: NewsClipProject) {
  const primarySourceId = project.source?.id ?? ""
  const selectedSourceIds = new Set([
    primarySourceId,
    ...project.reportScenes.map((scene) => scene.sourceId || primarySourceId),
  ])
  const resolved = new Map<string, NewsSource>()
  for (const sourceId of selectedSourceIds) {
    if (!sourceId) continue
    let source = await readSource(sourceId)
    if (source?.requiresUpload && source.originalUrl) {
      source = (await downloadApprovedSource(sourceId)) ?? source
    }
    if (!source?.approved || !source.localFile) {
      throw new Error("source-upload-required")
    }
    await access(source.localFile).catch(() => {
      throw new Error("source-upload-required")
    })
    resolved.set(sourceId, source)
  }
  return resolved
}

async function synthesizeSpeech(
  text: string,
  settings: NewsClipSettings,
  output: string,
  provider: ResolvedNewsTtsProvider
) {
  const timingOutput = `${output}.timestamps.json`
  try {
    await access(output)
    const timing = await readSpeechTiming(timingOutput)
    // Typecast는 단어 타임스탬프가 자막 기준. 음성만 있고 타이밍 없으면 다시 만든다.
    if (timing || provider.id === "free") return timing
  } catch {
    // Cache miss: synthesize this text and voice setting once.
  }

  // Typecast가 문장 전체의 문맥을 보고 한국어 억양과 호흡을 만들도록 한 번만
  // 요청한다. 쉼표/마침표마다 별도 합성하면 매 구간에서 운율이 초기화되어
  // 한국어 전용 음성도 단어를 끊어 읽는 듯한 억양이 생긴다.
  if (provider.id === "typecast") {
    await synthesizeNewsSpeech(
      text,
      settings.titleVoiceRate,
      output,
      provider,
      timingOutput
    )
    const timing = await readSpeechTiming(timingOutput)
    if (!timing) throw new Error("typecast-failed")
    return timing
  }

  const units = koreanSpeechUnits(text)
  if (!units.length) throw new Error("report-scene-narration-required")
  const chunks: Array<{
    path: string
    duration: number
    pauseAfterSeconds: number
  }> = []
  const words: TypecastSpeechTiming["words"] = []
  const characters: TypecastSpeechTiming["characters"] = []
  let cursor = 0
  for (const [index, unit] of units.entries()) {
    const chunkPath = `${output}.unit-${index + 1}.wav`
    const chunkTimingPath = `${chunkPath}.timestamps.json`
    let timing = await readSpeechTiming(chunkTimingPath)
    const chunkExists = await exists(chunkPath)
    if (!chunkExists) {
      await synthesizeNewsSpeech(
        unit.text,
        settings.titleVoiceRate,
        chunkPath,
        provider,
        chunkTimingPath
      )
      timing = await readSpeechTiming(chunkTimingPath)
    }
    const duration = await mediaDuration(chunkPath)
    const appendTiming = (
      target: TypecastSpeechTiming["words"],
      source: TypecastSpeechTiming["words"]
    ) => {
      for (const segment of scaleSpeechWordsToDuration(
        source,
        duration,
        timing?.audioDuration
      )) {
        target.push({
          ...segment,
          start: roundDuration(segment.start + cursor),
          end: roundDuration(segment.end + cursor),
        })
      }
    }
    appendTiming(words, timing?.words ?? [])
    appendTiming(characters, timing?.characters ?? [])
    chunks.push({
      path: chunkPath,
      duration,
      pauseAfterSeconds: unit.pauseAfterSeconds,
    })
    cursor += duration + unit.pauseAfterSeconds
  }
  await concatPacedSpeech(chunks, output)
  const combinedTiming: TypecastSpeechTiming = {
    audioDuration: roundDuration(cursor),
    words,
    characters,
  }
  await writeFile(timingOutput, JSON.stringify(combinedTiming))
  return combinedTiming
}

async function concatPacedSpeech(
  chunks: Array<{
    path: string
    duration: number
    pauseAfterSeconds: number
  }>,
  output: string
) {
  const filters: string[] = []
  const streams: string[] = []
  chunks.forEach((chunk, index) => {
    const audioLabel = `speech-${index}`
    filters.push(
      `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${Math.max(0.1, chunk.duration)},asetpts=PTS-STARTPTS[${audioLabel}]`
    )
    streams.push(`[${audioLabel}]`)
    if (chunk.pauseAfterSeconds > 0) {
      const pauseLabel = `pause-${index}`
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${chunk.pauseAfterSeconds},asetpts=PTS-STARTPTS[${pauseLabel}]`
      )
      streams.push(`[${pauseLabel}]`)
    }
  })
  await run(ffmpegBin(), [
    "-y",
    ...chunks.flatMap((chunk) => ["-i", chunk.path]),
    "-filter_complex",
    `${filters.join(";")};${streams.join("")}concat=n=${streams.length}:v=0:a=1[a]`,
    "-map",
    "[a]",
    "-c:a",
    "pcm_s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    output,
  ])
}

type TimedReportScene = NewsReportScene & {
  start: number
  end: number
  duration: number
  alignment: TypecastSpeechTiming["words"]
  tightVideoPath?: string
}

async function synthesizeReport(
  scenes: NewsReportScene[],
  settings: NewsClipSettings,
  folder: string,
  sources: Map<string, string>,
  primarySourceId: string,
  ttsVolume: number,
  quoteVolume: number,
  provider: ResolvedNewsTtsProvider,
  transcripts: Map<string, TranscriptSegment[]>,
  part: "lead" | "body" | "outro" = "body"
) {
  if (!scenes.length) {
    throw new Error("report-scenes-required")
  }
  const audioFiles: {
    path: string
    volume: number
    duration: number
  }[] = []
  const durations: number[] = []
  const alignments: TypecastSpeechTiming["words"][] = []
  const tightVideoPaths: Array<string | undefined> = []
  for (const [index, scene] of scenes.entries()) {
    if (scene.visual === "quote") {
      const source =
        sources.get(scene.sourceId || primarySourceId) ??
        sources.get(primarySourceId)
      if (!source) throw new Error("source-upload-required")
      const key = digest({
        source,
        start: scene.sourceStart,
        end: scene.sourceEnd,
        // v7: 원배속. 이전 1.2배 캐시와 분리한다.
        tighten: "v7-accurate-seek-rate-1",
        playbackRate: NEWS_SOURCE_PLAYBACK_RATE,
      }).slice(0, 16)
      const tightened = await tightenQuoteSegment({
        source,
        start: scene.sourceStart,
        end: scene.sourceEnd,
        folder,
        key: `${part}-${index + 1}-${key}`,
      })
      audioFiles.push({
        path: tightened.audioPath,
        volume: quoteVolume,
        duration: tightened.duration,
      })
      durations.push(tightened.duration)
      alignments.push(
        quoteTranscriptAlignment(
          scene,
          transcripts.get(scene.sourceId || primarySourceId) ?? []
        ).map((word) => ({
          ...word,
          // 인코더 패딩 때문에 추출 영상 길이가 수십 ms 달라도 단어 시간을
          // 전체 길이에 비례 확대하지 않는다. 실제 원본 단어 시각을 유지한다.
          start: roundDuration(Math.min(tightened.duration, word.start)),
          end: roundDuration(Math.min(tightened.duration, word.end)),
        }))
      )
      tightVideoPaths.push(tightened.videoPath)
      continue
    }

    const narration = scene.narration.trim()
    if (!narration) {
      throw new Error("report-scene-narration-required")
    }
    const key = digest({
      narration,
      pacing: NEWS_TTS_PACING_VERSION,
      tts: newsTtsCacheIdentity(provider),
      rate: settings.titleVoiceRate,
    }).slice(0, 16)
    const audio = path.join(folder, `report-${part}-${index + 1}-${key}.wav`)
    const timing = await synthesizeSpeech(narration, settings, audio, provider)
    const duration = await mediaDuration(audio)
    audioFiles.push({
      path: audio,
      volume: ttsVolume,
      duration,
    })
    durations.push(duration)
    alignments.push(
      scaleSpeechWordsToDuration(
        timing?.words ?? [],
        duration,
        timing?.audioDuration
      )
    )
    tightVideoPaths.push(undefined)
  }

  const signature = digest({
    part,
    audioFiles,
    durations,
    // 파트별 loudnorm 후 길이를 원본에 고정. concat 단계에는 필터 없음.
    concatAudio: "v4-part-loudnorm-lock-duration",
  })
  const audioRaw = path.join(
    folder,
    `report-${part}-${signature.slice(0, 16)}-raw.m4a`
  )
  const audio = path.join(
    folder,
    `report-${part}-${signature.slice(0, 16)}.m4a`
  )
  if (!(await exists(audioRaw))) {
    await concatAudio(audioFiles, audioRaw)
  }
  const rawDuration = durations.reduce((sum, value) => sum + value, 0)
  if (!(await exists(audio))) {
    // loudnorm이 길이를 늘리/줄여도 장면·quote 영상 타임라인은 고정이므로
    // 정규화 후 원본 길이에 맞춰 잘라/패딩한다. 스케일하면 quote 영상과 자막이 어긋난다.
    await normalizePartAudio(audioRaw, audio, rawDuration)
  }
  let cursor = 0
  const timedScenes = scenes.map((scene, index) => {
    const start = cursor
    cursor += durations[index] ?? 0
    const alignment = alignments[index] ?? []
    return {
      ...scene,
      start: roundDuration(start),
      end: roundDuration(cursor),
      duration: roundDuration(durations[index] ?? 0),
      alignment,
      tightVideoPath: tightVideoPaths[index],
    } satisfies TimedReportScene
  })
  return {
    audio,
    signature,
    scenes: timedScenes,
    narrationDuration: roundDuration(cursor),
    duration: roundDuration(cursor),
  }
}

/** 파트 개별 loudnorm. 길이는 targetDuration으로 고정해 영상·자막 타임라인을 지킨다. */
async function normalizePartAudio(
  input: string,
  output: string,
  targetDuration?: number
) {
  const probed =
    typeof targetDuration === "number" && Number.isFinite(targetDuration)
      ? targetDuration
      : await mediaDuration(input)
  const safeDuration = Math.max(0.1, probed)
  const lockDuration = `apad=whole_dur=${safeDuration},atrim=0:${safeDuration},asetpts=PTS-STARTPTS`
  try {
    await run(ffmpegBin(), [
      "-y",
      "-i",
      input,
      "-af",
      `${NEWS_PART_LOUDNORM},${lockDuration}`,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      String(safeDuration),
      output,
    ])
  } catch {
    // loudnorm이 PTS를 흔들면 볼륨만 복사하고 길이만 고정한다.
    await run(ffmpegBin(), [
      "-y",
      "-i",
      input,
      "-af",
      `volume=1,${lockDuration}`,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      String(safeDuration),
      output,
    ])
  }
}

async function readSpeechTiming(filePath: string) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const timing = parsed as Partial<TypecastSpeechTiming>
    if (!Array.isArray(timing.words)) return null
    return timing as TypecastSpeechTiming
  } catch {
    return null
  }
}

/** API 보고 길이와 실제 wav 길이가 다르면 단어 시간을 wav에 맞게 스케일한다. */
function scaleSpeechWordsToDuration(
  words: TypecastSpeechTiming["words"],
  mediaSeconds: number,
  reportedSeconds?: number
) {
  if (!words.length) return []
  const reported =
    typeof reportedSeconds === "number" &&
    Number.isFinite(reportedSeconds) &&
    reportedSeconds > 0.05
      ? reportedSeconds
      : Math.max(
          mediaSeconds,
          ...words.map((word) => (Number.isFinite(word.end) ? word.end : 0))
        )
  const target = Math.max(0.1, mediaSeconds)
  if (reported <= 0.05 || Math.abs(reported - target) < 0.04) {
    return words.map((word) => ({
      ...word,
      start: roundDuration(Math.max(0, Math.min(target, word.start))),
      end: roundDuration(
        Math.max(word.start + 0.04, Math.min(target, word.end))
      ),
    }))
  }
  const scale = target / reported
  return words.map((word) => {
    const start = Math.max(0, word.start * scale)
    const end = Math.max(start + 0.04, word.end * scale)
    return {
      ...word,
      start: roundDuration(Math.min(target, start)),
      end: roundDuration(Math.min(target, end)),
    }
  })
}

async function concatAudio(
  inputs: {
    path: string
    volume: number
    duration: number
  }[],
  output: string
) {
  const inputArgs = inputs.flatMap((input) => ["-i", input.path])
  // loudnorm을 filter_complex에 넣으면 PTS/길이가 깨져 자막·입모양 싱크가 밀린다.
  // 볼륨만 맞추고 장면별 실측 duration으로 잘라 타임라인을 유지한다.
  const normalized = inputs.map((input, index) => {
    return `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${Math.max(0, Math.min(2, input.volume))},apad,atrim=duration=${Math.max(0.1, input.duration)},asetpts=PTS-STARTPTS[audio${index}]`
  })
  const streams = inputs.map((_, index) => `[audio${index}]`).join("")
  await run(ffmpegBin(), [
    "-y",
    ...inputArgs,
    "-filter_complex",
    `${normalized.join(";")};${streams}concat=n=${inputs.length}:v=0:a=1[a]`,
    "-map",
    "[a]",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    output,
  ])
}

async function extractTitleStill(
  source: string,
  range: IntroStillRange,
  folder: string
) {
  const key = digest({
    renderVersion: NEWS_RENDER_VERSION,
    source,
    range,
  }).slice(0, 16)
  const output = path.join(folder, `title-still-${key}.png`)
  if (await exists(output)) return output
  const seek = introStillTime(range)
  await run(ffmpegBin(), [
    "-y",
    "-ss",
    String(Math.max(0, seek)),
    "-i",
    source,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-compression_level",
    "6",
    output,
  ])
  return output
}

async function makeTitleVideo(
  settings: NewsClipSettings,
  backgroundImage: string,
  introStillZoom: number,
  introStillX: number,
  introStillY: number,
  titleVolume: number,
  assPath: string,
  audioPath: string,
  output: string,
  dimensions: RenderDimensions,
  titleCardDurationSeconds: number
) {
  const background = backgroundImage || publicFile(NEWS_TITLE_BACKGROUND)
  const frame = publicFile(settings.titleFrameImage)
  const backgroundInput = background
    ? ["-loop", "1", "-i", background]
    : [
        "-f",
        "lavfi",
        "-i",
        `color=c=#101114:s=${dimensions.width}x${dimensions.height}:r=30`,
      ]
  const frameInput = frame ? ["-loop", "1", "-i", frame] : []
  const audioIndex = frame ? 2 : 1
  const titleFrameCount = Math.max(1, Math.ceil(titleCardDurationSeconds * 30))
  const zoomProgressFrames = Math.max(1, titleFrameCount - 1)
  const introZoomStart = Number.isFinite(introStillZoom)
    ? Math.max(1, Math.min(1.8, introStillZoom))
    : 1
  const introZoomDelta = introZoomStart * 0.05
  const introFocusX = Number.isFinite(introStillX)
    ? Math.max(0, Math.min(100, introStillX)) / 100
    : 0.5
  const introFocusY = Number.isFinite(introStillY)
    ? Math.max(0, Math.min(100, introStillY)) / 100
    : 0.5
  // FFmpeg 6 crop에는 eval=frame이 없다. 고해상도로 맞춘 뒤 zoompan으로 확대한다.
  const maxIntroZoom = introZoomStart + introZoomDelta
  const oversample = Math.min(6, Math.max(3, Math.ceil(maxIntroZoom * 2)))
  const baseWidth = dimensions.width * oversample
  const baseHeight = dimensions.height * oversample
  const zoomExpr = `${introZoomStart.toFixed(6)}+${introZoomDelta.toFixed(6)}*on/${zoomProgressFrames}`
  const baseFilter = [
    `[0:v]scale=${baseWidth}:${baseHeight}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${baseWidth}:${baseHeight}`,
    "setsar=1",
    `zoompan=z='${zoomExpr}':x='(iw-iw/zoom)*${introFocusX.toFixed(4)}':y='(ih-ih/zoom)*${introFocusY.toFixed(4)}':d=${titleFrameCount}:s=${dimensions.width}x${dimensions.height}:fps=30`,
    "setsar=1[title-bg]",
  ].join(",")
  const frameFilter = frame
    ? `;[1:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,setsar=1[title-frame];[title-bg][title-frame]overlay=0:0:format=auto[title-composed]`
    : ""
  const titleInput = frame ? "title-composed" : "title-bg"
  const titleFilter = `${baseFilter}${frameFilter};[${titleInput}]${assFilter(assPath)}[v]`
  await run(ffmpegBin(), [
    "-y",
    ...backgroundInput,
    ...frameInput,
    "-i",
    audioPath,
    "-t",
    String(titleCardDurationSeconds),
    "-filter_complex",
    titleFilter,
    "-map",
    "[v]",
    "-map",
    `${audioIndex}:a`,
    ...newsVideoEncodeArgs(dimensions),
    ...newsAudioEncodeArgs(),
    "-af",
    `volume=${Math.max(0, Math.min(2, titleVolume))},apad`,
    "-shortest",
    output,
  ])
}

async function makeBodyVideo(
  project: NewsClipProject,
  settings: NewsClipSettings,
  sources: Map<string, string>,
  primarySourceId: string,
  reportAudio: string,
  scenes: TimedReportScene[],
  captionsAss: string,
  bodyTitleAss: string,
  bodySourceAss: string,
  output: string,
  dimensions: RenderDimensions,
  requestedBodyDurationSeconds: number
) {
  const rect = settings.videoRect
  const narrationDurationSeconds = Math.max(0.1, scenes.at(-1)?.end ?? 0.1)
  // 파트 길이는 요청값·나레이션만 본다. 합본 자막 timeline으로 늘리면
  // intro/body/outro 분리 시 다른 파트 길이가 섞인다.
  const bodyDurationSeconds = Math.max(
    requestedBodyDurationSeconds,
    narrationDurationSeconds
  )
  const endCardDuration = Math.max(
    0,
    bodyDurationSeconds - narrationDurationSeconds
  )
  const sourceInputs = [...sources.entries()]
  const tightClipPaths = scenes
    .map((scene) => scene.tightVideoPath)
    .filter((value): value is string => Boolean(value))
  const uniqueTightClips = [...new Set(tightClipPaths)]
  const tightClipIndexes = new Map(
    uniqueTightClips.map((clipPath, index) => [
      clipPath,
      sourceInputs.length + index,
    ])
  )
  const sourceInputIndexes = new Map(
    sourceInputs.map(([sourceId], index) => [sourceId, index])
  )
  const sourceDurations = new Map(
    await Promise.all(
      sourceInputs.map(
        async ([sourceId, sourceFile]) =>
          [sourceId, await mediaDuration(sourceFile)] as const
      )
    )
  )
  const scaledRect = {
    x: Math.round(rect.x * dimensions.scale),
    y: Math.round(rect.y * dimensions.scale),
    width: Math.round(rect.width * dimensions.scale),
    height: Math.round(rect.height * dimensions.scale),
  }
  const background = publicFile(settings.bodyFrameImage)
  const backgroundIndex = background
    ? sourceInputs.length + uniqueTightClips.length
    : -1
  const reportAudioIndex =
    sourceInputs.length + uniqueTightClips.length + (background ? 1 : 0)
  const silences = project.detectedSilences
  const sceneFilters = scenes.map((scene, index) => {
    const sceneSourceId = scene.sourceId || primarySourceId
    const sourceInputIndex =
      sourceInputIndexes.get(sceneSourceId) ??
      sourceInputIndexes.get(primarySourceId) ??
      0
    const sourceDurationSeconds =
      sourceDurations.get(sceneSourceId) ??
      sourceDurations.get(primarySourceId) ??
      0.1
    const duration = Math.max(0.1, scene.duration)
    const renderDuration =
      duration + (index === scenes.length - 1 ? endCardDuration : 0)
    const crop = scene.crop ?? project.crop
    const sceneZoom = Math.max(1.02, Math.min(1.8, crop.zoom))
    const sceneCropX = `(iw-ow)*${Math.max(0, Math.min(100, crop.x)) / 100}`
    const sceneCropY = `(ih-oh)*${Math.max(0, Math.min(100, crop.y)) / 100}`
    const sceneWidth = Math.round(scaledRect.width * sceneZoom)
    const sceneHeight = Math.round(scaledRect.height * sceneZoom)
    const scaleCrop = `scale=${sceneWidth}:${sceneHeight}:force_original_aspect_ratio=increase,crop=${scaledRect.width}:${scaledRect.height}:x='${sceneCropX}':y='${sceneCropY}',setsar=1`
    // 원본 푸티지 원배속. fps만 고정해 타임라인을 안정적으로 맞춘다.
    const speed = `${sourceVideoSetpts(NEWS_SOURCE_PLAYBACK_RATE)},fps=30`
    const finish = `tpad=stop_mode=clone:stop_duration=${renderDuration},trim=duration=${renderDuration},setpts=PTS-STARTPTS[scene${index}]`
    if (scene.visual === "quote") {
      const tightIndex = scene.tightVideoPath
        ? tightClipIndexes.get(scene.tightVideoPath)
        : undefined
      if (tightIndex !== undefined) {
        // quote-tighten 단계에서 이미 컷·원배속 적용됨
        return `[${tightIndex}:v]setpts=PTS-STARTPTS,${scaleCrop},${finish}`
      }
      const baseSourceRange = fitSceneSourceRange(
        scene,
        sourceFootageSecondsForOutput(duration),
        sourceDurationSeconds
      )
      return `[${sourceInputIndex}:v]trim=start=${baseSourceRange.start}:end=${baseSourceRange.end},setpts=PTS-STARTPTS,${speed},${scaleCrop},${finish}`
    }
    const footageNeed = sourceFootageSecondsForOutput(renderDuration)
    const baseSourceRange = fitSceneSourceRange(
      scene,
      footageNeed,
      sourceDurationSeconds
    )
    const packed = densifySourceKeeps(
      baseSourceRange.start,
      Math.max(baseSourceRange.end, baseSourceRange.start + footageNeed),
      silences,
      footageNeed,
      sourceDurationSeconds,
      NEWS_SILENCE_CUT_MIN_SECONDS,
      project.transcript
    )
    if (packed.length <= 1) {
      const only = packed[0] ?? baseSourceRange
      return `[${sourceInputIndex}:v]trim=start=${only.start}:end=${only.end},setpts=PTS-STARTPTS,${speed},${scaleCrop},${finish}`
    }
    const pieces = packed.map((keep, pieceIndex) => {
      const label = `s${index}p${pieceIndex}`
      return `[${sourceInputIndex}:v]trim=start=${keep.start}:end=${keep.end},setpts=PTS-STARTPTS,${speed},${scaleCrop}[${label}]`
    })
    const concatLabels = packed
      .map((_, pieceIndex) => `[s${index}p${pieceIndex}]`)
      .join("")
    return `${pieces.join(";")};${concatLabels}concat=n=${packed.length}:v=1:a=0,${finish}`
  })
  const concatInputs = scenes.map((_, index) => `[scene${index}]`).join("")
  const backgroundFilter = background
    ? `[${backgroundIndex}:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=increase,crop=${dimensions.width}:${dimensions.height},setsar=1[bg]`
    : `color=c=#101114:s=${dimensions.width}x${dimensions.height}:r=30:d=${bodyDurationSeconds}[bg]`
  const filter = [
    ...sceneFilters,
    `${concatInputs}concat=n=${scenes.length}:v=1:a=0[clip]`,
    backgroundFilter,
    `[bg][clip]overlay=${scaledRect.x}:${scaledRect.y}[framed];[framed]${assFilter(bodyTitleAss)},${assFilter(captionsAss)},${assFilter(bodySourceAss)}[vout]`,
    `[${reportAudioIndex}:a]apad,atrim=duration=${bodyDurationSeconds},alimiter=limit=0.95[aout]`,
  ].join(";")
  await run(ffmpegBin(), [
    "-y",
    ...sourceInputs.flatMap(([, sourceFile]) => ["-i", sourceFile]),
    ...uniqueTightClips.flatMap((clipPath) => ["-i", clipPath]),
    ...(background ? ["-loop", "1", "-i", background] : []),
    "-i",
    reportAudio,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    ...newsVideoEncodeArgs(dimensions),
    ...newsAudioEncodeArgs(),
    "-t",
    String(bodyDurationSeconds),
    "-shortest",
    output,
  ])
}

type RenderDimensions = {
  width: number
  height: number
  scale: number
  preset: string
}

async function applyFinalPlaybackRate(
  input: string,
  output: string,
  rate: number,
  dimensions: RenderDimensions
) {
  const safeRate = normalizeFinalPlaybackRate(rate)
  await run(ffmpegBin(), [
    "-y",
    "-i",
    input,
    "-filter_complex",
    `[0:v]setpts=PTS/${safeRate},fps=30[v];[0:a]atempo=${safeRate}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    ...newsVideoEncodeArgs(dimensions),
    ...newsAudioEncodeArgs(),
    "-movflags",
    "+faststart",
    "-shortest",
    output,
  ])
}

async function applyBgm(
  project: NewsClipProject,
  settings: NewsClipSettings,
  input: string,
  output: string
) {
  const bgm = project.bgmEnabled ? publicFile(settings.bgmFile) : ""
  if (!bgm) {
    await copyFile(input, output)
    return
  }
  await run(ffmpegBin(), [
    "-y",
    "-i",
    input,
    "-stream_loop",
    "-1",
    "-i",
    bgm,
    "-filter_complex",
    `[1:a]volume=${project.bgmVolume},afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0, project.outputDurationSeconds - 0.5)}:d=0.5[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`,
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    output,
  ])
}

function subtitlesToSrt(cues: SubtitleCue[]) {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`
    )
    .join("\n")
}

function titleAssText(
  title: string,
  duration: number,
  settings: NewsClipSettings
) {
  const layout = settings.titleCardText
  const [firstLine, secondLine] = splitIntroTitleLines(title, layout)
  const firstMetrics = titleLineRenderMetrics(firstLine, layout, 0.35)
  const secondLayout = {
    ...layout,
    fontSize: settings.titleCardSecondFontSize,
  }
  const secondMetrics = titleLineRenderMetrics(secondLine, secondLayout, 0.35)
  const anchor = textAnchor(layout, settings.safeMarginPercent)
  const secondY =
    layout.y +
    Math.round(
      firstMetrics.fontSize * (settings.titleCardLineHeightPercent / 100)
    )
  const events = [
    assSingleLineEvent(
      firstLine,
      duration,
      layout,
      firstMetrics.fontSize,
      firstMetrics.scaleX,
      settings.titleCardColor,
      anchor.x,
      layout.y,
      anchor.alignment
    ),
    secondLine
      ? assSingleLineEvent(
          secondLine,
          duration,
          layout,
          secondMetrics.fontSize,
          secondMetrics.scaleX,
          settings.titleCardSecondColor,
          anchor.x,
          secondY,
          anchor.alignment
        )
      : "",
  ]
    .filter(Boolean)
    .join("\n")
  return assSingleLineDocument(
    assFontFamily(settings.fontFamily, layout.fontWeight),
    firstMetrics.fontSize,
    events
  )
}

function bodyTitleAssText(
  title: string,
  duration: number,
  settings: NewsClipSettings
) {
  const layout = settings.bodyTitleText
  const bodyTitle = title.replace(/\s+/g, " ").trim()
  const metrics = titleLineRenderMetrics(bodyTitle, layout, 0.35)
  const anchor = textAnchor(layout, settings.safeMarginPercent)
  const event = assSingleLineEvent(
    bodyTitle,
    duration,
    layout,
    metrics.fontSize,
    metrics.scaleX,
    settings.bodyTitleColor,
    anchor.x,
    layout.y,
    anchor.alignment
  )
  return assSingleLineDocument(
    assFontFamily(settings.fontFamily, layout.fontWeight),
    metrics.fontSize,
    event
  )
}

function bodySourceAssText(
  sourceCredit: string,
  duration: number,
  settings: NewsClipSettings
) {
  const layout = settings.bodySourceText
  const text = sourceCredit.replace(/\s+/g, " ").trim()
  if (!text) {
    return assSingleLineDocument(
      assFontFamily(settings.fontFamily, layout.fontWeight),
      layout.fontSize,
      ""
    )
  }
  const metrics = titleLineRenderMetrics(text, layout, 0.35)
  const anchor = textAnchor(layout, settings.safeMarginPercent)
  const event = assSingleLineEvent(
    text,
    duration,
    layout,
    metrics.fontSize,
    metrics.scaleX,
    settings.sourceColor,
    anchor.x,
    layout.y,
    anchor.alignment
  )
  return assSingleLineDocument(
    assFontFamily(settings.fontFamily, layout.fontWeight),
    metrics.fontSize,
    event
  )
}

function assSingleLineDocument(
  fontFamily: string,
  fontSize: number,
  events: string
) {
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: SingleLine,${fontFamily},${fontSize},&H00FFFFFF,&H000000FF,&HFF101010,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`
}

function assSingleLineEvent(
  text: string,
  duration: number,
  layout: NewsClipSettings["titleCardText"],
  fontSize: number,
  scaleX: number,
  color: string,
  x: number,
  y: number,
  alignment: number
) {
  return `Dialogue: 0,0:00:00.00,${assTime(duration)},SingleLine,,0,0,0,,{\\an${alignment}\\pos(${x},${y})\\q2\\bord0\\shad0\\fs${fontSize}\\fscx${Math.round(scaleX * 100)}\\fsp${layout.letterSpacing}\\b${layout.fontWeight}\\c${hexToAss(color)}}${assText(text)}`
}

function textAnchor(
  layout: NewsClipSettings["titleCardText"],
  safeMarginPercent: number
) {
  const box = resolveTextBox(layout, safeMarginPercent)
  if (layout.alignment === "left") {
    return { x: Math.round(box.x), alignment: 7 }
  }
  if (layout.alignment === "right") {
    return { x: Math.round(box.x + box.width), alignment: 9 }
  }
  return { x: Math.round(box.x + box.width / 2), alignment: 8 }
}

function subtitlesToAss(cues: SubtitleCue[], settings: NewsClipSettings) {
  const layout = settings.bodySubtitleText
  const primary = hexToAss(settings.subtitleColor)
  const highlight =
    settings.emphasisColor === "#5ee28b" ? "&H008BE25E&" : "&H004DD8FF&"
  const anchor = textAnchor(layout, settings.safeMarginPercent)
  const events = cues
    .map((cue) => {
      let text = assText(cue.text.trim())
      for (const word of cue.emphasis) {
        const escapedWord = assText(word)
        if (!escapedWord) continue
        text = text.replaceAll(
          escapedWord,
          `{\\c${highlight}}${escapedWord}{\\c${primary}}`
        )
      }
      return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Subtitle,,0,0,0,,{\\an${anchor.alignment}\\pos(${anchor.x},${layout.y})\\q2\\bord0\\shad0\\b${layout.fontWeight}\\c${primary}}${text}`
    })
    .join("\n")
  const { left, right } = textMargins(layout, settings.safeMarginPercent)
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Subtitle,${assFontFamily(settings.fontFamily, layout.fontWeight)},${layout.fontSize},${primary},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,${layout.letterSpacing},0,1,0,0,${assAlignment(layout.alignment)},${left},${right},${layout.y},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`
}

function assFontFamily(
  family: NewsClipSettings["fontFamily"],
  weight: NewsClipSettings["titleCardText"]["fontWeight"]
) {
  if (family === "Black Han Sans") return family
  if (weight >= 900) return "Pretendard Black"
  if (weight >= 800) return "Pretendard ExtraBold"
  if (weight >= 700) return "Pretendard Bold"
  if (weight >= 600) return "Pretendard SemiBold"
  if (weight >= 500) return "Pretendard Medium"
  return "Pretendard"
}

function textMargins(
  layout: NewsClipSettings["titleCardText"],
  safeMarginPercent: number
) {
  const box = resolveTextBox(layout, safeMarginPercent)
  return {
    left: Math.round(box.x),
    right: Math.max(0, Math.round(1080 - box.x - box.width)),
  }
}

function assAlignment(value: NewsClipSettings["titleCardText"]["alignment"]) {
  return value === "left" ? 7 : value === "right" ? 9 : 8
}

function hexToAss(value: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value)
  return match
    ? `&H00${match[3].toUpperCase()}${match[2].toUpperCase()}${match[1].toUpperCase()}`
    : "&H00FFFFFF"
}

function assText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/\r?\n/g, "\\N")
}

function assTime(value: number) {
  const centis = Math.max(0, Math.round(value * 100))
  const hours = Math.floor(centis / 360_000)
  const minutes = Math.floor((centis % 360_000) / 6_000)
  const seconds = Math.floor((centis % 6_000) / 100)
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${String(centis % 100).padStart(2, "0")}`
}

function manifestOf(
  project: NewsClipProject,
  sources: Map<string, NewsSource>,
  dimensions: RenderDimensions
) {
  const candidate = project.candidates.find(
    (item) => item.id === project.selectedCandidateId
  )
  return {
    projectType: "news_clip",
    originalUrl: project.source
      ? (sources.get(project.source.id)?.originalUrl ??
        project.source.originalUrl)
      : "",
    sources: [...sources.values()].map((source) => ({
      id: source.id,
      role: source.id === project.source?.id ? "primary" : "supporting",
      title: source.title,
      channel: source.channel,
      originalUrl: source.originalUrl,
    })),
    sourceTimecode: candidate
      ? { start: candidate.sourceStart, end: candidate.sourceEnd }
      : null,
    removedRanges: project.removedRanges,
    candidateScores: candidate?.scores ?? null,
    candidateReason: candidate?.reason ?? "",
    title: project.title,
    reportScript: project.reportScript,
    reportScenes: project.reportScenes.map((scene) => ({
      visual: scene.visual,
      narration: scene.narration,
      sourceId: scene.sourceId || project.source?.id || "",
      sourceUrl:
        sources.get(scene.sourceId || project.source?.id || "")?.originalUrl ??
        "",
      sourceTimecode: { start: scene.sourceStart, end: scene.sourceEnd },
    })),
    output: {
      width: dimensions.width,
      height: dimensions.height,
      video: "H.264",
      audio: "AAC",
    },
  }
}

function publicFile(value: string) {
  if (!value.startsWith("/news-clips/")) return ""
  const resolved = path.resolve(process.cwd(), "public", value.slice(1))
  const root = path.resolve(process.cwd(), "public", "news-clips")
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : ""
}

function filterPath(value: string) {
  return `'${value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}'`
}

function assFilter(assPath: string) {
  const fonts = path.resolve(process.cwd(), "public", "fonts")
  return `subtitles=${filterPath(assPath)}:fontsdir=${filterPath(fonts)}`
}

function assAlphaFilter(assPath: string) {
  return `${assFilter(assPath)}:alpha=1`
}

function srtTime(value: number) {
  const millis = Math.max(0, Math.round(value * 1000))
  const hours = Math.floor(millis / 3_600_000)
  const minutes = Math.floor((millis % 3_600_000) / 60_000)
  const seconds = Math.floor((millis % 60_000) / 1000)
  const remainder = millis % 1000
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(remainder).padStart(3, "0")}`
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function run(bin: string, args: string[]) {
  return runWithRetry(bin, args, 2)
}

async function runWithRetry(bin: string, args: string[], attempts: number) {
  let lastError: unknown = new Error("ffmpeg-failed")
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runOnce(bin, args)
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }
  throw lastError
}

function runOnce(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-12_000)
    })
    child.on("error", () => reject(new Error("ffmpeg-failed")))
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      console.error("FFmpeg failed", stderr.slice(-4_000))
      reject(new Error("ffmpeg-failed"))
    })
  })
}

function mediaDuration(input: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      ffmpegBin(),
      ["-hide_banner", "-i", input, "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] }
    )
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on("error", () => reject(new Error("ffmpeg-failed")))
    child.on("exit", () => {
      const match = stderr.match(
        /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/
      )
      if (!match) {
        reject(new Error("ffmpeg-failed"))
        return
      }
      const duration =
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("ffmpeg-failed"))
        return
      }
      resolve(roundDuration(duration))
    })
  })
}

function roundDuration(value: number) {
  return Math.round(value * 1000) / 1000
}

function fitSceneSourceRange(
  scene: NewsReportScene,
  sceneDuration: number,
  sourceDuration: number
) {
  const maximumStart = Math.max(0, sourceDuration - 0.1)
  const originalStart = Math.max(
    0,
    Math.min(
      maximumStart,
      Number.isFinite(scene.sourceStart) ? scene.sourceStart : 0
    )
  )
  const originalEnd = Math.max(
    originalStart + 0.1,
    Math.min(
      sourceDuration,
      Number.isFinite(scene.sourceEnd) ? scene.sourceEnd : originalStart + 0.5
    )
  )
  if (scene.visual === "quote") {
    return {
      start: roundDuration(originalStart),
      end: roundDuration(originalEnd),
    }
  }

  const targetDuration = Math.min(sourceDuration, Math.max(0.5, sceneDuration))
  const center = originalStart + (originalEnd - originalStart) / 2
  const start = Math.max(
    0,
    Math.min(sourceDuration - targetDuration, center - targetDuration / 2)
  )
  return {
    start: roundDuration(start),
    end: roundDuration(Math.min(sourceDuration, start + targetDuration)),
  }
}

type RenderCache = {
  introVideoSignature?: string
  titleVideoSignature?: string
  leadVideoSignature?: string
  bodyVideoSignature?: string
  outroVideoSignature?: string
  joinedSignature?: string
  outputSignature?: string
}

async function readRenderCache(value: string): Promise<RenderCache> {
  try {
    return JSON.parse(await readFile(value, "utf8")) as RenderCache
  } catch {
    return {}
  }
}

async function writeRenderCache(value: string, cache: RenderCache) {
  await writeFile(value, `${JSON.stringify(cache, null, 2)}\n`)
}

async function exists(value: string) {
  try {
    await access(value)
    return true
  } catch {
    return false
  }
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
