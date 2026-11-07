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
  retimeSubtitleCuesToScenes,
} from "@/lib/news-clips/report"
import { bodySourceCreditText } from "@/lib/news-clips/source-credit"
import { NEWS_RENDER_SCHEMA_VERSION } from "@/lib/news-clips/render-key"
import { parseTranscript } from "@/lib/news-clips/transcript"
import {
  layoutTimedSubtitleCues,
  resolveTextBox,
  splitIntroTitleLines,
  titleLineFits,
  titleLineRenderMetrics,
} from "@/lib/news-clips/text-layout"
import type { TypecastSpeechTiming } from "@/lib/news-clips/typecast-response"
import {
  downloadApprovedSource,
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
import type {
  NewsClipProject,
  NewsClipSettings,
  NewsReportScene,
  NewsSource,
  SubtitleCue,
  TranscriptSegment,
} from "@/lib/news-clips/types"

const NEWS_RENDER_VERSION = NEWS_RENDER_SCHEMA_VERSION
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
  options: { force?: boolean } = {}
) {
  const force = options.force === true
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
  const prepared = prepareRenderProject(project, settings)
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

  const folder = path.join(
    process.cwd(),
    "public",
    "news-clips",
    "output",
    project.id
  )
  await mkdir(folder, { recursive: true })
  const prefix = mode === "preview" ? "preview-" : ""
  const dimensions =
    mode === "preview"
      ? { width: 360, height: 640, scale: 360 / 1080, preset: "ultrafast" }
      : {
          width: 720,
          height: 1280,
          scale: 720 / 1080,
          preset: "medium",
        }
  const ttsProvider = await resolveNewsTtsProvider(settings)
  const ttsIdentity = newsTtsCacheIdentity(ttsProvider)
  const captions = path.join(folder, "captions.srt")
  const captionsAss = path.join(folder, `${prefix}captions.ass`)
  const titleAss = path.join(folder, `${prefix}title.ass`)
  const bodyTitleAss = path.join(folder, `${prefix}body-title.ass`)
  const titleKey = createHash("sha256")
    .update(
      JSON.stringify({
        title: project.title,
        tts: ttsIdentity,
        rate: settings.titleVoiceRate,
      })
    )
    .digest("hex")
    .slice(0, 16)
  const titleAudio = path.join(folder, `title-${titleKey}.wav`)
  const titleVideo = path.join(folder, `${prefix}title.mp4`)
  const bodyVideo = path.join(folder, `${prefix}body.mp4`)
  const joinedVideo = path.join(folder, `${prefix}joined.mp4`)
  const finalVideo = path.join(
    folder,
    mode === "preview" ? "preview.mp4" : "final.mp4"
  )
  const titleFrame = path.join(folder, `${prefix}title-frame.png`)
  const thumbnail = path.join(folder, "thumbnail.png")
  const cachePath = path.join(folder, `${prefix}render-cache.json`)
  await synthesizeSpeech(project.title, settings, titleAudio, ttsProvider)
  const titleSpeechDurationSeconds = await mediaDuration(titleAudio)
  const titleCardDurationSeconds = roundDuration(
    titleSpeechDurationSeconds + NEWS_INTRO_GAP_SECONDS
  )
  const report = await synthesizeReport(
    project.reportScenes,
    settings,
    folder,
    sourceFiles,
    source.id,
    project.sourceVolume,
    project.quoteVolume,
    ttsProvider,
    sourceTranscripts
  )
  const bodyDurationSeconds = roundDuration(
    report.duration + NEWS_OUTRO_GAP_SECONDS
  )
  const outputDurationSeconds = roundDuration(
    titleCardDurationSeconds + bodyDurationSeconds
  )
  const effectiveProject: NewsClipProject = {
    ...project,
    // 실측 장면 길이에 맞춘 뒤, 줄바꿈만 적용한다(merge/재타이밍으로 싱크를 깨지 않음).
    subtitles: layoutTimedSubtitleCues(
      retimeSubtitleCuesToScenes(
        project.subtitles,
        project.reportScenes,
        report.scenes
      ),
      settings.bodySubtitleText
    ),
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
  const renderCache = await readRenderCache(cachePath)
  const titleVideoSignature = digest({
    renderVersion: NEWS_RENDER_VERSION,
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
  const bodyVideoSignature = digest({
    renderVersion: NEWS_RENDER_VERSION,
    sources: [...sourceFiles],
    reportScript: effectiveProject.reportScript,
    reportScenes: report.scenes,
    reportAudio: report.signature,
    sourcePlaybackRate: NEWS_SOURCE_PLAYBACK_RATE,
    subtitles: effectiveProject.subtitles,
    title: effectiveProject.title,
    crop: effectiveProject.crop,
    sourceVolume: effectiveProject.sourceVolume,
    quoteVolume: effectiveProject.quoteVolume,
    bodyDurationSeconds,
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
  const joinedSignature = digest({ titleVideoSignature, bodyVideoSignature })
  const outputSignature = digest({
    joinedSignature,
    bgmEnabled: effectiveProject.bgmEnabled,
    bgmVolume: effectiveProject.bgmVolume,
    bgmFile: settings.bgmFile,
  })
  const bodySourceAss = path.join(folder, `${prefix}body-source.ass`)
  const sourceCredit = bodySourceCreditText(source)

  await Promise.all([
    writeFile(captions, subtitlesToSrt(effectiveProject.subtitles)),
    writeFile(
      captionsAss,
      subtitlesToAss(effectiveProject.subtitles, settings)
    ),
    writeFile(
      titleAss,
      titleAssText(effectiveProject.title, titleCardDurationSeconds, settings)
    ),
    writeFile(
      bodyTitleAss,
      bodyTitleAssText(effectiveProject.title, bodyDurationSeconds, settings)
    ),
    writeFile(
      bodySourceAss,
      bodySourceAssText(sourceCredit, bodyDurationSeconds, settings)
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

  if (
    force ||
    renderCache.titleVideoSignature !== titleVideoSignature ||
    !(await exists(titleVideo))
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
      titleVideo,
      dimensions,
      titleCardDurationSeconds
    )
  }
  if (
    force ||
    renderCache.bodyVideoSignature !== bodyVideoSignature ||
    !(await exists(bodyVideo))
  ) {
    await makeBodyVideo(
      effectiveProject,
      settings,
      sourceFiles,
      source.id,
      report.audio,
      report.scenes,
      captionsAss,
      bodyTitleAss,
      bodySourceAss,
      bodyVideo,
      dimensions,
      bodyDurationSeconds
    )
  }
  if (
    force ||
    renderCache.joinedSignature !== joinedSignature ||
    !(await exists(joinedVideo))
  ) {
    await concatVideos(titleVideo, bodyVideo, joinedVideo, dimensions.preset)
  }
  if (
    force ||
    renderCache.outputSignature !== outputSignature ||
    !(await exists(finalVideo))
  ) {
    await applyBgm(effectiveProject, settings, joinedVideo, finalVideo)
  }
  if (mode === "final") {
    await run(ffmpegBin(), [
      "-y",
      "-ss",
      "0.15",
      "-i",
      titleVideo,
      "-frames:v",
      "1",
      titleFrame,
    ])
    await copyFile(titleFrame, thumbnail)
  }
  await writeFile(
    cachePath,
    `${JSON.stringify(
      {
        titleVideoSignature,
        bodyVideoSignature,
        joinedSignature,
        outputSignature,
      },
      null,
      2
    )}\n`
  )

  const signature = createHash("sha256")
    .update(JSON.stringify({ project: effectiveProject, settings, mode }))
    .digest("hex")
  const base = `/news-clips/output/${project.id}`
  if (mode === "preview") {
    const previewVersion = force
      ? `${signature.slice(0, 12)}-${Date.now().toString(36)}`
      : signature.slice(0, 12)
    return {
      signature,
      previewUrl: `${base}/preview.mp4?v=${previewVersion}`,
      titleCardDurationSeconds,
      outputDurationSeconds,
      subtitles: effectiveProject.subtitles,
      reportScenes: effectiveProject.reportScenes,
    }
  }
  const outputVersion = force
    ? `${signature.slice(0, 12)}-${Date.now().toString(36)}`
    : signature.slice(0, 12)
  return {
    signature,
    outputUrl: `${base}/final.mp4?v=${outputVersion}`,
    thumbnailUrl: `${base}/thumbnail.png?v=${outputVersion}`,
    captionsUrl: `${base}/captions.srt`,
    titleFrameUrl: `${base}/title-frame.png`,
    manifestUrl: `${base}/manifest.json`,
    titleCardDurationSeconds,
    outputDurationSeconds,
    subtitles: effectiveProject.subtitles,
    reportScenes: effectiveProject.reportScenes,
  }
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
    return await readSpeechTiming(timingOutput)
  } catch {
    // Cache miss: synthesize this text and voice setting once.
  }
  await synthesizeNewsSpeech(
    text,
    settings.titleVoiceRate,
    output,
    provider,
    timingOutput
  )
  return readSpeechTiming(timingOutput)
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
  transcripts: Map<string, TranscriptSegment[]>
) {
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
        // v5: 무음컷 없이 1.2배만. 배속/캐시 버전 변경 시 키 분리.
        tighten: "v5-rate-1.2",
        playbackRate: NEWS_SOURCE_PLAYBACK_RATE,
      }).slice(0, 16)
      const tightened = await tightenQuoteSegment({
        source,
        start: scene.sourceStart,
        end: scene.sourceEnd,
        folder,
        key: `${index + 1}-${key}`,
      })
      audioFiles.push({
        path: tightened.audioPath,
        volume: quoteVolume,
        duration: tightened.duration,
      })
      durations.push(tightened.duration)
      const rawQuoteSeconds = Math.max(
        0.1,
        scene.sourceEnd - scene.sourceStart
      )
      const alignmentScale = tightened.duration / rawQuoteSeconds
      alignments.push(
        quoteTranscriptAlignment(
          scene,
          transcripts.get(scene.sourceId || primarySourceId) ?? []
        ).map((word) => ({
          ...word,
          start: roundDuration(word.start * alignmentScale),
          end: roundDuration(word.end * alignmentScale),
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
      tts: newsTtsCacheIdentity(provider),
      rate: settings.titleVoiceRate,
    }).slice(0, 16)
    const audio = path.join(folder, `report-${index + 1}-${key}.wav`)
    const timing = await synthesizeSpeech(
      narration,
      settings,
      audio,
      provider
    )
    const duration = await mediaDuration(audio)
    audioFiles.push({
      path: audio,
      volume: ttsVolume,
      duration,
    })
    durations.push(duration)
    alignments.push(timing?.words ?? [])
    tightVideoPaths.push(undefined)
  }

  const signature = digest({
    audioFiles,
    durations,
    // loudnorm 제거 후 캐시 분리
    concatAudio: "v2-volume-atrim",
  })
  const audio = path.join(folder, `report-${signature.slice(0, 16)}.m4a`)
  if (!(await exists(audio))) {
    await concatAudio(audioFiles, audio)
  }
  let cursor = 0
  const timedScenes = scenes.map((scene, index) => {
    const start = cursor
    cursor += durations[index]
    return {
      ...scene,
      start: roundDuration(start),
      end: roundDuration(cursor),
      duration: roundDuration(durations[index]),
      alignment: alignments[index],
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
  const baseFilter = `[0:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=increase,crop=${dimensions.width}:${dimensions.height},zoompan=z='${introZoomStart.toFixed(4)}+${introZoomDelta.toFixed(4)}*on/${zoomProgressFrames}':x='(iw-iw/zoom)*${introFocusX.toFixed(4)}':y='(ih-ih/zoom)*${introFocusY.toFixed(4)}':d=${titleFrameCount}:s=${dimensions.width}x${dimensions.height}:fps=30,setsar=1[title-bg]`
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
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    dimensions.preset,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
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
  const bodyDurationSeconds = Math.max(
    requestedBodyDurationSeconds,
    narrationDurationSeconds,
    project.subtitles.at(-1)?.end ?? narrationDurationSeconds
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
    // 원본 푸티지 공통 1.2배. fps를 고정해 setpts 배속이 프레임 타임라인에 안정적으로 반영되게 한다.
    const speed = `${sourceVideoSetpts(NEWS_SOURCE_PLAYBACK_RATE)},fps=30`
    const finish = `tpad=stop_mode=clone:stop_duration=${renderDuration},trim=duration=${renderDuration},setpts=PTS-STARTPTS[scene${index}]`
    if (scene.visual === "quote") {
      const tightIndex = scene.tightVideoPath
        ? tightClipIndexes.get(scene.tightVideoPath)
        : undefined
      if (tightIndex !== undefined) {
        // quote-tighten 단계에서 이미 배속 적용됨
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
      Math.max(
        baseSourceRange.end,
        baseSourceRange.start + footageNeed
      ),
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
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    dimensions.preset,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-t",
    String(bodyDurationSeconds),
    "-shortest",
    output,
  ])
}

async function concatVideos(
  title: string,
  body: string,
  output: string,
  preset: string
) {
  await run(ffmpegBin(), [
    "-y",
    "-i",
    title,
    "-i",
    body,
    "-filter_complex",
    "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    output,
  ])
}

type RenderDimensions = {
  width: number
  height: number
  scale: number
  preset: string
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

function extendSourceRangeEnd(
  range: { start: number; end: number },
  targetDuration: number,
  sourceDuration: number
) {
  const end = Math.min(sourceDuration, range.start + targetDuration)
  const start = Math.max(0, Math.min(range.start, end - targetDuration))
  return {
    start: roundDuration(start),
    end: roundDuration(end),
  }
}

type RenderCache = {
  titleVideoSignature?: string
  bodyVideoSignature?: string
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
