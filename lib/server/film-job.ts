import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"

import {
  buildLayoutAss,
  buildTimedSrt,
  frameVideoFilter,
} from "@/lib/frame-render"
import {
  titleCharacterLimit,
  titleWithinCharacterLimit,
} from "@/lib/frame-layout"
import {
  groupClipPrompt,
  insertStillPrompt,
  roomStillPrompt,
  type FilmScene,
} from "@/lib/film-plan"
import { videoGroups } from "@/lib/film-groups"
import { readProfile } from "@/lib/server/profiles"
import { readVoiceId } from "@/lib/server/voice"
import { bgmFilePath } from "@/lib/server/bgm"
import { getCharacterLibrary, readCharacterImage } from "@/lib/server/character"
import { readFrameLayout } from "@/lib/server/frame-layout"
import { attachHistoryVideo } from "@/lib/server/history"
import {
  downloadFile,
  generateMedia,
  uploadBytes,
} from "@/lib/server/higgsfield"
import { generateNarration, type NarrationClip } from "@/lib/server/tts"
import { uploadYoutubeShort } from "@/lib/server/youtube-upload"
import { readVideoSettings } from "@/lib/server/video-settings"
import { isAiVideoMode, productionUsage } from "@/lib/scene-production"
import { videoSettingsKey, type VideoSettings } from "@/lib/video-settings"
import { videoSecondsForAudio, type WordTiming } from "@/lib/voice-timing"

const outputDir = path.join(process.cwd(), "outputs")
const statusPath = path.join(outputDir, "film-status.json")
const clipDir = path.join(outputDir, "clips")
const clipStatusPath = path.join(outputDir, "clip-status.json")
const clipManifestPath = path.join(clipDir, "manifest.json")
const roomStillMetaPath = path.join(clipDir, "room-still.json")
const finalPath = path.join(outputDir, "final_shorts.mp4")

export type FilmState = "idle" | "running" | "done" | "error"

export type FilmStatus = {
  state: FilmState
  message: string
  sceneIndex: number
  sceneCount: number
  fileReady: boolean
  signature: string
}

type FilmRequest = {
  topic: string
  profileId: string
  autoUpload: boolean
  scheduledAt: string
  youtube: {
    enabled: boolean
    title: string
    description: string
    tags: string
  }
  placeEn: string
  anchor: string
  outfitId: string | null
  bgmId: string
  signature: string
  historyId: string
  scenes: FilmScene[]
  groupId?: string
}

type StoredClip = {
  id: string
  sceneIds: string[]
  file: string
  key: string
  durations: number[]
  words?: WordTiming[][]
  ready: boolean
}

type ClipManifest = {
  signature: string
  voiceId?: string
  videoSettings?: VideoSettings
  groups: StoredClip[]
}

export type ClipGroupStatus = {
  id: string
  sceneIds: string[]
  ready: boolean
  seconds: number
}

export type ClipJobStatus = {
  state: FilmState
  message: string
  signature: string
  groups: ClipGroupStatus[]
}

let active = false

export async function readFilmStatus(): Promise<FilmStatus> {
  const stored = await readStored()
  if (stored.state === "running" && !active) {
    return {
      ...stored,
      state: "error",
      message: "생성이 중단되었습니다. 영상 만들기를 다시 누르세요.",
      fileReady: false,
    }
  }
  return stored
}

export function finalFilmPath() {
  return finalPath
}

export async function startFilm(request: FilmRequest) {
  if (active) {
    return { ok: false as const, message: "이미 영상을 만들고 있습니다." }
  }
  if (!request.topic.trim()) {
    return { ok: false as const, message: "영문 주제가 없습니다." }
  }
  const layout = await readFrameLayout(request.profileId)
  if (!titleWithinCharacterLimit(request.topic.trim(), layout.titleSize)) {
    return {
      ok: false as const,
      message: `현재 제목 크기에서는 영문 제목을 ${titleCharacterLimit(layout.titleSize)}자 이내로 줄여야 합니다.`,
    }
  }
  if (
    !request.placeEn.trim() ||
    !request.anchor.trim() ||
    request.scenes.length === 0 ||
    request.scenes.some(
      (scene) => !scene.scriptTarget.trim() || !scene.sceneDescription.trim()
    )
  ) {
    return { ok: false as const, message: "장소와 씬이 준비되지 않았습니다." }
  }
  const scenes = request.scenes
  active = true
  try {
    await writeStatus({
      state: "running",
      message: "준비를 시작합니다",
      sceneIndex: 0,
      sceneCount: scenes.length,
      fileReady: false,
      signature: request.signature,
    })
  } catch {
    active = false
    return { ok: false as const, message: "영상을 시작하지 못했습니다." }
  }
  void run({ ...request, scenes }).catch((error: unknown) =>
    fail(messageFor(error))
  )
  return { ok: true as const }
}

export async function readClipJob(signature: string): Promise<ClipJobStatus> {
  const status = await readClipStatus()
  const manifest = await readClipManifest()
  const matches = manifest?.signature === signature ? manifest.groups : []
  if (status.state === "running" && !active) {
    return {
      ...status,
      state: "error",
      message: "씬 영상 만들기가 중단되었습니다. 다시 누르세요.",
      groups: matches.map(groupStatus),
    }
  }
  return { ...status, groups: matches.map(groupStatus) }
}

export async function readClipFile(groupId: string) {
  if (!/^clip-\d{2}$/.test(groupId)) {
    return null
  }
  const manifest = await readClipManifest()
  const group = manifest?.groups.find(
    (item) => item.id === groupId && item.ready
  )
  if (!group || group.file !== `${groupId}.mp4`) {
    return null
  }
  const filePath = path.resolve(clipDir, group.file)
  if (!filePath.startsWith(`${path.resolve(clipDir)}${path.sep}`)) {
    return null
  }
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

export async function startSceneClips(request: FilmRequest) {
  if (active) {
    return { ok: false as const, message: "이미 영상을 만들고 있습니다." }
  }
  if (
    !request.placeEn.trim() ||
    !request.anchor.trim() ||
    request.scenes.length === 0 ||
    request.scenes.some(
      (scene) => !scene.scriptTarget.trim() || !scene.sceneDescription.trim()
    )
  ) {
    return { ok: false as const, message: "장소와 씬이 준비되지 않았습니다." }
  }
  const groups = videoGroups(request.scenes)
  const videoSettings = await readVideoSettings(request.profileId)
  const usage = productionUsage(request.scenes)
  if (
    usage.aiSceneCount > videoSettings.maxAiVideoScenes ||
    usage.aiSeconds > videoSettings.maxAiVideoSeconds
  ) {
    return {
      ok: false as const,
      message: "AI 영상 씬 수 또는 생성 시간이 채널 설정의 상한을 넘습니다.",
    }
  }
  if (
    videoSettings.estimatedCostPerSecondUsd > 0 &&
    videoSettings.maxEstimatedCostUsd > 0 &&
    usage.aiSeconds * videoSettings.estimatedCostPerSecondUsd >
      videoSettings.maxEstimatedCostUsd
  ) {
    return {
      ok: false as const,
      message: "예상 AI 영상 비용이 채널 설정의 상한을 넘습니다.",
    }
  }
  if (
    request.groupId &&
    !groups.some((group) => group.id === request.groupId)
  ) {
    return { ok: false as const, message: "다시 만들 영상을 찾지 못했습니다." }
  }
  active = true
  try {
    await writeClipStatus({
      state: "running",
      message: "씬 영상을 준비하는 중",
      signature: request.signature,
    })
  } catch {
    active = false
    return { ok: false as const, message: "씬 영상을 시작하지 못했습니다." }
  }
  const previous = await readClipManifest()
  const groupId =
    previous?.signature === request.signature ? request.groupId : undefined
  void renderSceneClips({ ...request, groupId }, groups).catch(
    (error: unknown) => failClips(messageFor(error))
  )
  return { ok: true as const }
}

async function run(request: FilmRequest) {
  await mkdir(outputDir, { recursive: true })
  const bin = ffmpegBin()
  await mkdir(clipDir, { recursive: true })
  const profile = await readProfile(request.profileId)
  const manifest = await readClipManifest()
  if (
    !manifest ||
    manifest.signature !== request.signature ||
    manifest.groups.some((group) => !group.ready)
  ) {
    throw new Error("no-clips")
  }
  const clipPaths = manifest.groups.map((group) =>
    path.join(clipDir, group.file)
  )
  const narrationDuration = manifest.groups.reduce(
    (sum, group) =>
      sum + group.durations.reduce((inner, value) => inner + value, 0),
    0
  )
  await writeStatus({
    state: "running",
    message: "영상을 이어 붙이는 중",
    sceneIndex: request.scenes.length,
    sceneCount: request.scenes.length,
    fileReady: false,
    signature: request.signature,
  })
  const listPath = path.join(clipDir, "concat.txt")
  await writeFile(
    listPath,
    clipPaths
      .map((file) => `file '${file.replaceAll("'", "'\\''")}'`)
      .join("\n")
  )
  const assembledPath = path.join(outputDir, "assembled_shorts.mp4")
  await runBin(bin, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    assembledPath,
  ])
  const layout = await readFrameLayout(request.profileId)
  const assPath = path.join(clipDir, "layout.ass")
  const timedSubtitles = request.scenes.map((scene) => ({
    subtitle: scene.subtitle.trim() || scene.scriptTarget,
    duration: durationForScene(manifest, scene.id),
    words: wordsForScene(manifest, scene.id),
  }))
  await writeFile(
    assPath,
    buildLayoutAss(layout, request.topic, timedSubtitles)
  )
  const captionsPath = path.join(clipDir, "captions.srt")
  await writeFile(captionsPath, buildTimedSrt(timedSubtitles))
  const bgmPath = await bgmFilePath(request.bgmId)
  const duration = narrationDuration.toFixed(3)
  if (bgmPath) {
    await runBin(bin, [
      "-y",
      "-i",
      assembledPath,
      "-stream_loop",
      "-1",
      "-i",
      bgmPath,
      "-filter_complex",
      `[0:v]${frameVideoFilter(layout)},ass=outputs/clips/layout.ass:fontsdir=public/fonts[v];[1:a]volume=${profile.youtube_bgm_volume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      duration,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      finalPath,
    ])
  } else {
    await runBin(bin, [
      "-y",
      "-i",
      assembledPath,
      "-vf",
      `${frameVideoFilter(layout)},ass=outputs/clips/layout.ass:fontsdir=public/fonts`,
      "-t",
      duration,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      finalPath,
    ])
  }
  try {
    await attachHistoryVideo(
      request.historyId,
      finalPath,
      request.signature,
      captionsPath,
      {
        profile: {
          id: profile.id,
          name: profile.name,
          systemPrompt: profile.system_prompt,
          imageStyleAnchor: profile.image_style_anchor,
        },
        voiceId: manifest.voiceId ?? "",
        video: manifest.videoSettings ?? null,
        frame: layout,
        bgm: {
          id: request.bgmId,
          volume: profile.youtube_bgm_volume,
        },
        timing: "tts-audio-duration-with-estimated-word-boundaries",
      }
    )
  } catch {
    throw new Error("save-failed")
  }
  let uploadMessage = ""
  if (request.autoUpload && request.youtube.enabled) {
    await writeStatus({
      state: "running",
      message: "유튜브에 예약 업로드하는 중",
      sceneIndex: request.scenes.length,
      sceneCount: request.scenes.length,
      fileReady: true,
      signature: request.signature,
    })
    try {
      await uploadYoutubeShort({
        profileId: request.profileId,
        historyId: request.historyId,
        title: request.youtube.title,
        description: request.youtube.description,
        tags: request.youtube.tags,
        scheduledAt: request.scheduledAt,
      })
      uploadMessage = " 유튜브 예약 업로드도 마쳤습니다."
    } catch {
      uploadMessage =
        " 영상은 저장했지만 유튜브 자동 업로드는 실패했습니다. 업로드 화면에서 다시 시도하세요."
    }
  }
  active = false
  await writeStatus({
    state: "done",
    message: bgmPath
      ? `고정 음성, 자막, 배경음악까지 합쳤습니다.${uploadMessage}`
      : `고정 음성과 자막을 합쳤습니다. 배경음악 파일은 없습니다.${uploadMessage}`,
    sceneIndex: request.scenes.length,
    sceneCount: request.scenes.length,
    fileReady: true,
    signature: request.signature,
  })
}

async function renderSceneClips(
  request: FilmRequest,
  groups: ReturnType<typeof videoGroups>
) {
  await mkdir(clipDir, { recursive: true })
  const bin = ffmpegBin()
  const voiceId = await readVoiceId(request.profileId)
  const videoSettings = await readVideoSettings(request.profileId)
  const previous = await readClipManifest()
  const kept = previous?.signature === request.signature ? previous.groups : []
  const stored: StoredClip[] = []
  let generatedSeconds = 0
  let roomUrl = ""
  let roomCast = ""
  for (const [index, group] of groups.entries()) {
    const key = clipKey(request, group.scenes, voiceId, videoSettings)
    const existing = kept.find(
      (item) => item.id === group.id && item.key === key && item.ready
    )
    const forced = request.groupId === group.id
    if (existing && !forced) {
      stored.push(existing)
      continue
    }
    if (request.groupId && request.groupId !== group.id && existing) {
      stored.push(existing)
      continue
    }
    if (request.groupId && request.groupId !== group.id) {
      stored.push(
        existing ?? {
          id: group.id,
          sceneIds: group.sceneIds,
          file: `${group.id}.mp4`,
          key,
          durations: [],
          words: [],
          ready: false,
        }
      )
      continue
    }
    const label = `${index + 1}/${groups.length}`
    await writeClipStatus({
      state: "running",
      message: `영상 ${label} 음성을 만드는 중`,
      signature: request.signature,
    })
    const narration = await generateNarration(
      group.scenes.map((scene) => ({ id: scene.id, text: scene.scriptTarget })),
      voiceId,
      path.join(clipDir, group.id)
    )
    const audioPath = path.join(clipDir, `${group.id}.wav`)
    await concatAudio(
      bin,
      narration.map((clip) => clip.filePath),
      audioPath
    )
    const words = offsetWords(narration)
    const duration = narration.reduce((sum, clip) => sum + clip.duration, 0)
    const insert = group.scenes[0]?.shot === "insert"
    const aiVideo = isAiVideoMode(
      group.scenes[0]?.productionMode ?? "character_motion"
    )
    const castIds = [
      ...new Set(
        group.scenes
          .filter((scene) => scene.shot !== "insert")
          .flatMap((scene) => scene.castIds)
      ),
    ]
    let imageUrl = roomUrl
    if (insert) {
      await writeClipStatus({
        state: "running",
        message: `영상 ${label} 그림을 만드는 중`,
        signature: request.signature,
      })
      imageUrl = await generateMedia("xai/grok-imagine-image-2.0", {
        prompt: insertStillPrompt(group.scenes[0]?.sceneDescription ?? ""),
        resolution: "1k",
        aspect_ratio: "3:4",
        quality: "low",
      })
    } else {
      const castKey = [...castIds].sort().join(",")
      if (!roomUrl || roomCast !== castKey) {
        roomUrl = await roomPicture(request, castIds)
        roomCast = castKey
      }
      imageUrl = roomUrl
    }
    await writeClipStatus({
      state: "running",
      message: aiVideo
        ? `영상 ${label} Seedance 장면을 만드는 중`
        : `영상 ${label} 로컬 2D 모션을 만드는 중`,
      signature: request.signature,
    })
    const clipPath = path.join(clipDir, `${group.id}.mp4`)
    if (aiVideo) {
      const generationSeconds = videoSecondsForAudio(duration)
      assertWithinAiLimits(
        generatedSeconds + generationSeconds,
        videoSettings
      )
      const videoUrl = await generateAiVideo(
        videoSettings,
        {
          prompt: groupClipPrompt(
            group.scenes,
            insert ? "insert" : "start",
            words
          ),
          image_url: imageUrl,
          duration: generationSeconds,
          resolution: videoSettings.resolution,
          aspect_ratio: videoSettings.aspectRatio,
          generate_audio: false,
        }
      )
      generatedSeconds += generationSeconds
      const generatedPath = path.join(clipDir, `${group.id}-raw.mp4`)
      await writeFile(generatedPath, await downloadFile(videoUrl))
      await syncNarration(bin, generatedPath, audioPath, clipPath, duration)
    } else {
      const stillPath = path.join(clipDir, `${group.id}-still.jpg`)
      await writeFile(stillPath, await downloadFile(imageUrl))
      await localMotion(
        bin,
        stillPath,
        audioPath,
        clipPath,
        duration,
        videoSettings.resolution
      )
    }
    stored.push({
      id: group.id,
      sceneIds: group.sceneIds,
      file: `${group.id}.mp4`,
      key,
      durations: narration.map((clip) => clip.duration),
      words: narration.map((clip) => clip.words),
      ready: true,
    })
  }
  await writeClipManifest({
    signature: request.signature,
    voiceId,
    videoSettings,
    groups: stored,
  })
  active = false
  await writeClipStatus({
    state: "done",
    message: "씬 영상을 만들었습니다. 각각 확인한 뒤 하나로 합치세요.",
    signature: request.signature,
  })
}

function clipKey(
  request: FilmRequest,
  scenes: FilmScene[],
  voiceId: string,
  videoSettings: VideoSettings
) {
  return createHash("sha256")
    .update(
      [
        voiceId,
        videoSettingsKey(videoSettings),
        request.placeEn,
        request.anchor,
        request.outfitId ?? "",
        ...scenes.map(
          (scene) =>
            `${scene.id}|${scene.shot}|${scene.productionMode}|${scene.scriptTarget}|${scene.sceneDescription}|${scene.castIds.join(",")}`
        ),
      ].join("\n")
    )
    .digest("hex")
    .slice(0, 16)
}

function offsetWords(clips: NarrationClip[]): WordTiming[] {
  let offset = 0
  const words: WordTiming[] = []
  for (const clip of clips) {
    words.push(
      ...clip.words.map((word) => ({
        word: word.word,
        start: word.start + offset,
        end: word.end + offset,
      }))
    )
    offset += clip.duration
  }
  return words
}

async function concatAudio(bin: string, files: string[], outputPath: string) {
  if (files.length === 1 && files[0]) {
    await copyFile(files[0], outputPath)
    return
  }
  const listPath = `${outputPath}.txt`
  await writeFile(
    listPath,
    files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n")
  )
  await runBin(bin, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath,
  ])
}

function groupStatus(group: StoredClip): ClipGroupStatus {
  return {
    id: group.id,
    sceneIds: group.sceneIds,
    ready: group.ready,
    seconds: group.durations.reduce((sum, value) => sum + value, 0),
  }
}

function durationForScene(manifest: ClipManifest, sceneId: string) {
  for (const group of manifest.groups) {
    const index = group.sceneIds.indexOf(sceneId)
    if (index >= 0) {
      return group.durations[index] ?? 0
    }
  }
  return 0
}

function wordsForScene(manifest: ClipManifest, sceneId: string) {
  for (const group of manifest.groups) {
    const index = group.sceneIds.indexOf(sceneId)
    if (index >= 0) {
      return group.words?.[index] ?? []
    }
  }
  return []
}

function assertWithinAiLimits(
  generatedSeconds: number,
  settings: VideoSettings
) {
  if (generatedSeconds > settings.maxAiVideoSeconds) {
    throw new Error("ai-limit")
  }
  if (
    settings.estimatedCostPerSecondUsd <= 0 ||
    settings.maxEstimatedCostUsd <= 0
  ) {
    return
  }
  const estimated = generatedSeconds * settings.estimatedCostPerSecondUsd
  if (estimated > settings.maxEstimatedCostUsd) {
    throw new Error("cost-limit")
  }
}

async function generateAiVideo(
  settings: VideoSettings,
  input: Record<string, unknown>
) {
  let error: unknown = new Error("generate-failed")
  for (let attempt = 0; attempt <= settings.maxRetriesPerScene; attempt += 1) {
    try {
      return await generateMedia(settings.model, input)
    } catch (caught) {
      error = caught
      const code = caught instanceof Error ? caught.message : ""
      if (code === "no-key" || code === "no-credit") {
        throw caught
      }
    }
  }
  throw error
}

async function readClipManifest() {
  try {
    return JSON.parse(await readFile(clipManifestPath, "utf8")) as ClipManifest
  } catch {
    return null
  }
}

async function writeClipManifest(manifest: ClipManifest) {
  await mkdir(clipDir, { recursive: true })
  await writeFile(clipManifestPath, JSON.stringify(manifest))
}

async function readClipStatus(): Promise<Omit<ClipJobStatus, "groups">> {
  try {
    const parsed = JSON.parse(
      await readFile(clipStatusPath, "utf8")
    ) as Partial<Omit<ClipJobStatus, "groups">>
    return {
      state:
        parsed.state === "running" ||
        parsed.state === "done" ||
        parsed.state === "error"
          ? parsed.state
          : "idle",
      message: typeof parsed.message === "string" ? parsed.message : "",
      signature: typeof parsed.signature === "string" ? parsed.signature : "",
    }
  } catch {
    return { state: "idle", message: "", signature: "" }
  }
}

async function writeClipStatus(status: Omit<ClipJobStatus, "groups">) {
  await mkdir(outputDir, { recursive: true })
  await writeFile(clipStatusPath, JSON.stringify(status))
}

async function failClips(message: string) {
  active = false
  const stored = await readClipStatus()
  await writeClipStatus({ ...stored, state: "error", message })
}

async function roomPicture(request: FilmRequest, castIds: string[]) {
  const files = await characterFiles(request.profileId, castIds)
  const key = createHash("sha256")
    .update(
      [
        request.placeEn.trim(),
        request.anchor.trim(),
        ...files.map((file) => file.id),
      ].join("\n")
    )
    .digest("hex")
  const saved = await loadRoomStill(key)
  if (saved) {
    await writeClipStatus({
      state: "running",
      message: "같은 캐릭터 그림을 쓰는 중",
      signature: request.signature,
    })
    return uploadBytes(saved, "image/jpeg")
  }
  await writeClipStatus({
    state: "running",
    message: "장소 그림을 만드는 중",
    signature: request.signature,
  })
  const references: string[] = []
  for (const file of files) {
    references.push(
      await uploadBytes(
        file.bytes,
        file.type === "image/jpg" ? "image/jpeg" : file.type
      )
    )
  }
  const url = await generateMedia("xai/grok-imagine-image-2.0", {
    prompt: roomStillPrompt(
      request.anchor,
      request.placeEn,
      castIds.length > 0
    ),
    resolution: "1k",
    aspect_ratio: "3:4",
    quality: "low",
    image_urls: references,
  })
  await storeRoomStill(key, await downloadFile(url))
  return url
}

async function loadRoomStill(key: string) {
  try {
    const meta = JSON.parse(await readFile(roomStillMetaPath, "utf8")) as {
      key?: string
      stills?: { key?: string; file?: string }[]
    }
    const stored = meta.stills?.find((item) => item.key === key && item.file)
    const file = stored?.file ?? (meta.key === key ? "room-still.jpg" : "")
    if (
      !file ||
      (file !== "room-still.jpg" && !/^room-[\w.-]+\.jpg$/.test(file))
    ) {
      return null
    }
    return await readFile(path.join(clipDir, file))
  } catch {
    return null
  }
}

async function storeRoomStill(key: string, bytes: Buffer) {
  await mkdir(clipDir, { recursive: true })
  const file = `room-${key.slice(0, 16)}.jpg`
  await writeFile(path.join(clipDir, file), bytes)
  let stills: { key: string; file: string }[] = []
  try {
    const meta = JSON.parse(await readFile(roomStillMetaPath, "utf8")) as {
      stills?: { key?: string; file?: string }[]
    }
    stills = (meta.stills ?? []).flatMap((item) =>
      item.key && item.file ? [{ key: item.key, file: item.file }] : []
    )
  } catch {
    stills = []
  }
  const next = stills.filter((item) => item.key !== key)
  next.push({ key, file })
  await writeFile(roomStillMetaPath, JSON.stringify({ stills: next }))
}

async function characterFiles(profileId: string, castIds: string[]) {
  const library = await getCharacterLibrary(profileId)
  const host =
    library.outfits.find((item) => item.id === library.hostId) ??
    library.outfits[0]
  const support = library.outfits.filter(
    (item) => item.id !== host?.id && item.active && castIds.includes(item.id)
  )
  const pools = [host, ...support]
    .filter((outfit): outfit is NonNullable<typeof outfit> => Boolean(outfit))
    .map((outfit) => {
      const preferred = ["three-quarter-face", "front-body"]
      const preferredIds = preferred.map(
        (key) => outfit.angles.find((angle) => angle.key === key)?.image?.id
      )
      const remaining = outfit.angles
        .filter((angle) => !preferred.includes(angle.key))
        .map((angle) => angle.image?.id)
      return [outfit.front?.id, ...preferredIds, ...remaining].filter(
        (id): id is string => Boolean(id)
      )
    })
  const ids: string[] = []
  for (let index = 0; ids.length < 10; index += 1) {
    let found = false
    for (const pool of pools) {
      const id = pool[index]
      if (id) {
        ids.push(id)
        found = true
        if (ids.length === 10) break
      }
    }
    if (!found) break
  }
  const files: { id: string; bytes: Buffer; type: string }[] = []
  for (const id of ids) {
    const image = await readCharacterImage(id, profileId)
    if (!image) {
      continue
    }
    files.push({ id, bytes: image.bytes, type: image.type })
  }
  if (files.length === 0) {
    throw new Error("no-character")
  }
  return files
}

async function fail(message: string) {
  active = false
  const stored = await readStored()
  await writeStatus({ ...stored, state: "error", message, fileReady: false })
}

async function readStored(): Promise<FilmStatus> {
  try {
    const parsed = JSON.parse(
      await readFile(statusPath, "utf8")
    ) as Partial<FilmStatus>
    return {
      state:
        parsed.state === "running" ||
        parsed.state === "done" ||
        parsed.state === "error"
          ? parsed.state
          : "idle",
      message: typeof parsed.message === "string" ? parsed.message : "",
      sceneIndex: typeof parsed.sceneIndex === "number" ? parsed.sceneIndex : 0,
      sceneCount: typeof parsed.sceneCount === "number" ? parsed.sceneCount : 0,
      fileReady: parsed.fileReady === true,
      signature: typeof parsed.signature === "string" ? parsed.signature : "",
    }
  } catch {
    return {
      state: "idle",
      message: "",
      sceneIndex: 0,
      sceneCount: 0,
      fileReady: false,
      signature: "",
    }
  }
}

async function writeStatus(status: FilmStatus) {
  await mkdir(outputDir, { recursive: true })
  await writeFile(statusPath, JSON.stringify(status))
}

function messageFor(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  if (code === "no-key") {
    return "힉스필드 키가 없습니다."
  }
  if (code === "no-credit") {
    return "힉스필드 잔액이 부족합니다."
  }
  if (code === "no-character") {
    return "진행자 사진이 없습니다."
  }
  if (code === "no-ffmpeg") {
    return "영상 합치기 도구가 없습니다."
  }
  if (code === "save-failed") {
    return "영상을 저장하지 못했습니다."
  }
  if (code === "no-clips") {
    return "씬 영상이 없습니다. 대본에서 씬 영상을 먼저 만드세요."
  }
  if (code === "voice-failed") {
    return "고정 목소리를 만들지 못했습니다."
  }
  if (code === "cost-limit") {
    return "예상 영상 생성 비용이 설정한 상한을 넘습니다. 영상 설정에서 단가나 상한을 확인하세요."
  }
  if (code === "ai-limit") {
    return "AI 영상 생성 시간이 채널 설정의 상한을 넘습니다. 대본에서 제작 방식을 확인하세요."
  }
  return "영상을 만들지 못했습니다."
}

function syncNarration(
  bin: string,
  videoPath: string,
  audioPath: string,
  outputPath: string,
  duration: number
) {
  const seconds = Math.max(0.1, duration).toFixed(3)
  return runBin(bin, [
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-filter_complex",
    `[0:v]tpad=stop_mode=clone:stop_duration=30,trim=duration=${seconds},setpts=PTS-STARTPTS[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a:0",
    "-t",
    seconds,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ])
}

function localMotion(
  bin: string,
  imagePath: string,
  audioPath: string,
  outputPath: string,
  duration: number,
  resolution: VideoSettings["resolution"]
) {
  const [width, height] = localFrameSize(resolution)
  const seconds = Math.max(0.1, duration).toFixed(3)
  return runBin(bin, [
    "-y",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-i",
    audioPath,
    "-filter_complex",
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.00035,1.06)':d=1:s=${width}x${height}:fps=24,format=yuv420p[v]`,
    "-map",
    "[v]",
    "-map",
    "1:a:0",
    "-t",
    seconds,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ])
}

function localFrameSize(resolution: VideoSettings["resolution"]) {
  if (resolution === "480p") return [480, 640] as const
  if (resolution === "1080p") return [1080, 1440] as const
  return [720, 960] as const
}

function runBin(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" })
    child.on("error", () => reject(new Error("no-ffmpeg")))
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("no-ffmpeg"))
    )
  })
}
