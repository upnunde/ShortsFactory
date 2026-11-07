"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Button, ScrollShadow, Separator } from "@heroui/react"
import { ArrowLeftRight, Home } from "lucide-react"
import { ChannelHub } from "@/components/studio/channel-hub"
import { DirectionStep } from "@/components/studio/direction-step"
import { FilmStep } from "@/components/studio/film-step"
import { HistoryPanel } from "@/components/studio/history-panel"
import { ScenesStep } from "@/components/studio/scenes-step"
import { ScriptStep } from "@/components/studio/script-step"
import { SettingsPanel } from "@/components/studio/settings-panel"
import { TopicStep } from "@/components/studio/topic-step"
import { UploadStep } from "@/components/studio/upload-step"
import { isHistoryId } from "@/lib/history"
import { normalizeProductionMode } from "@/lib/scene-production"
import {
  directionReady,
  filmSignature,
  narrationSignature,
  scriptBlocked,
} from "@/lib/scene-status"
import { defaultSubtitle } from "@/lib/timing"
import { applyYoutubeCopy, scheduleForUpload } from "@/lib/youtube-metadata"
import { STORAGE_KEY, sampleStudio } from "@/lib/sample-project"
import type { AccountPlatform, AccountStatus } from "@/lib/server/accounts"
import {
  STEPS,
  type ChannelProfile,
  type Project,
  type Scene,
  type SocialPost,
  type StepId,
  type StudioState,
  type YoutubeMeta,
} from "@/lib/types"

function isScene(value: unknown): value is Scene {
  if (!value || typeof value !== "object") {
    return false
  }
  const scene = value as Scene
  return (
    typeof scene.id === "string" &&
    typeof scene.scriptKo === "string" &&
    typeof scene.approvedKo === "string" &&
    typeof scene.scriptTarget === "string" &&
    (scene.productionMode === undefined ||
      typeof scene.productionMode === "string") &&
    typeof scene.sceneDescription === "string" &&
    typeof scene.visualDescription === "string" &&
    typeof scene.voiceScript === "string"
  )
}

function freshStudio(profile: ChannelProfile): StudioState {
  return {
    ...sampleStudio,
    project: {
      ...sampleStudio.project,
      profileId: profile.id,
      bgmId: profile.default_bgm_id,
      historyId: crypto.randomUUID(),
    },
  }
}

function storageKey(profileId: string) {
  return `${STORAGE_KEY}.${profileId}`
}

function loadStudio(profile: ChannelProfile): StudioState {
  if (typeof window === "undefined") {
    return sampleStudio
  }
  try {
    const raw = window.localStorage.getItem(storageKey(profile.id))
    if (!raw) {
      return freshStudio(profile)
    }
    const parsed = JSON.parse(raw) as StudioState
    if (
      !parsed.project?.scenes?.every(isScene) ||
      !STEPS.some((step) => step.id === parsed.step) ||
      typeof parsed.project.autoUpload !== "boolean" ||
      typeof parsed.project.finalSignature !== "string"
    ) {
      return freshStudio(profile)
    }
    return {
      ...parsed,
      project: {
        ...normalizeProject(parsed.project),
        profileId: profile.id,
      },
    }
  } catch {
    return freshStudio(profile)
  }
}

function normalizeProject(project: Project): Project {
  const stored = project.youtube as YoutubeMeta & { scheduledAt?: string }
  const fallbackCaption = [stored.title, stored.description]
    .filter(Boolean)
    .join("\n\n")
  return {
    ...project,
    scheduledAt: scheduleForUpload(
      project.scheduledAt || stored.scheduledAt || ""
    ),
    outfitId:
      typeof project.outfitId === "string" && project.outfitId
        ? project.outfitId
        : null,
    bgmId:
      typeof project.bgmId === "string" && project.bgmId
        ? project.bgmId
        : "stella-waltz",
    titleKo: typeof project.titleKo === "string" ? project.titleKo : "",
    topicEn: typeof project.topicEn === "string" ? project.topicEn : "",
    overviewKo:
      typeof project.overviewKo === "string" ? project.overviewKo : "",
    overviewEn:
      typeof project.overviewEn === "string" ? project.overviewEn : "",
    placeKo: typeof project.placeKo === "string" ? project.placeKo : "",
    placeEn: typeof project.placeEn === "string" ? project.placeEn : "",
    placeApprovedKo:
      typeof project.placeApprovedKo === "string"
        ? project.placeApprovedKo
        : "",
    historyId: isHistoryId(project.historyId)
      ? project.historyId
      : crypto.randomUUID(),
    directionSignature:
      typeof project.directionSignature === "string"
        ? project.directionSignature
        : "",
    voicePreviewKey:
      typeof project.voicePreviewKey === "string"
        ? project.voicePreviewKey
        : "",
    sceneDurations:
      project.sceneDurations && typeof project.sceneDurations === "object"
        ? project.sceneDurations
        : {},
    sceneWordTimings:
      project.sceneWordTimings && typeof project.sceneWordTimings === "object"
        ? project.sceneWordTimings
        : {},
    youtube: {
      enabled: stored.enabled ?? true,
      ...applyYoutubeCopy({
        title: stored.title ?? "",
        description: stored.description ?? "",
        tags: stored.tags ?? "",
      }),
    },
    instagram: normalizePost(project.instagram, fallbackCaption),
    tiktok: normalizePost(project.tiktok, fallbackCaption),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      shot: scene.shot === "insert" ? "insert" : "room",
      productionMode: normalizeProductionMode(
        scene.productionMode,
        scene.shot === "insert" ? "insert" : "room"
      ),
      subtitle:
        typeof scene.subtitle === "string"
          ? scene.subtitle
          : defaultSubtitle(scene.scriptTarget),
      castIds: Array.isArray(scene.castIds)
        ? scene.castIds.filter((id): id is string => typeof id === "string")
        : [],
      actionBeats: Array.isArray(scene.actionBeats)
        ? scene.actionBeats.filter(
            (beat) =>
              beat &&
              typeof beat.trigger === "string" &&
              typeof beat.action === "string"
          )
        : [
            {
              trigger: scene.scriptTarget.split(/\s+/)[0] || "",
              action: scene.sceneDescription,
            },
          ],
    })),
  }
}

function normalizePost(
  post: SocialPost | undefined,
  fallbackCaption: string
): SocialPost {
  if (
    !post ||
    typeof post.caption !== "string" ||
    typeof post.enabled !== "boolean"
  ) {
    return { enabled: true, caption: fallbackCaption }
  }
  return post
}

function filmBody(project: Project, profile: ChannelProfile) {
  return {
    topic: project.topicEn.trim(),
    profileId: project.profileId,
    placeEn: project.placeEn,
    anchor: profile.image_style_anchor,
    outfitId: project.outfitId,
    bgmId: project.bgmId,
    signature: filmSignature(project),
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      shot: scene.shot === "insert" ? "insert" : "room",
      productionMode: scene.productionMode,
      sceneDescription: scene.sceneDescription,
      scriptTarget: scene.scriptTarget,
      subtitle: scene.subtitle,
      actionBeats: scene.actionBeats,
      castIds: scene.castIds ?? [],
      duration: project.sceneDurations[scene.id],
    })),
  }
}

export function StudioApp({
  initialAccounts,
  initialProfiles,
}: {
  initialAccounts: Record<AccountPlatform, AccountStatus>
  initialProfiles: ChannelProfile[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profiles, setProfiles] = useState(initialProfiles)
  const channelId = searchParams.get("channel")
  const profile = profiles.find((item) => item.id === channelId)
  const view = searchParams.get("view")
  const showHistory = view === "history"
  const showSettings =
    !showHistory &&
    (view === "settings" || view === "accounts" || view === "character")
  const showSide = showSettings || showHistory
  const [studio, setStudio] = useState<StudioState>(sampleStudio)
  const [ready, setReady] = useState(false)
  const [scriptBusy, setScriptBusy] = useState("")
  const [scriptError, setScriptError] = useState("")
  const [filmNote, setFilmNote] = useState("")
  const placesOnce = useRef(false)

  useEffect(() => {
    if (!profile) {
      return
    }
    void Promise.resolve().then(() => {
      setStudio(loadStudio(profile))
      placesOnce.current = false
      setReady(true)
    })
  }, [profile])

  useEffect(() => {
    if (!ready || !profile) {
      return
    }
    window.localStorage.setItem(storageKey(profile.id), JSON.stringify(studio))
  }, [profile, ready, studio])

  useEffect(() => {
    if (!ready || !isHistoryId(studio.project.historyId)) {
      return
    }
    const snapshot = studio
    const timer = window.setTimeout(() => {
      void fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      })
        .then(async (response) => {
          const body = (await response.json()) as { frozen?: boolean }
          if (!response.ok) {
            return
          }
          if (body.frozen) {
            setStudio((current) => {
              if (current.project.historyId !== snapshot.project.historyId) {
                return current
              }
              return {
                ...current,
                project: {
                  ...current.project,
                  historyId: crypto.randomUUID(),
                  finalSignature: "",
                },
              }
            })
          }
        })
        .catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [ready, studio])

  useEffect(() => {
    if (!ready || placesOnce.current || studio.project.placeKo.trim() !== "") {
      return
    }
    if (
      studio.project.topic.trim() === "" ||
      studio.project.scenes.length < 5
    ) {
      return
    }
    placesOnce.current = true
    const project = studio.project
    const ids = project.scenes.map((scene) => scene.id)
    void Promise.resolve().then(() => {
      setScriptBusy("places")
      setScriptError("")
    })
    void fetch("/api/script", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "places",
        topic: project.topic,
        profileId: project.profileId,
        scenes: project.scenes.map((scene) => ({
          id: scene.id,
          scriptKo: scene.scriptKo,
          scriptTarget: scene.scriptTarget,
        })),
      }),
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          message?: string
          placeKo?: string
          placeEn?: string
          scenes?: {
            shot?: string
            productionMode?: string
            sceneDescription?: string
            castIds?: string[]
          }[]
        }
        if (!response.ok || !body.placeKo || !body.placeEn || !body.scenes) {
          setScriptError(body.message || "화면 기준을 만들지 못했습니다.")
          return
        }
        const planned = body.scenes
        setStudio((current) => {
          const same =
            current.project.scenes.length === ids.length &&
            current.project.scenes.every(
              (scene, index) => scene.id === ids[index]
            )
          if (!same || !planned || planned.length !== ids.length) {
            return current
          }
          return {
            ...current,
            project: {
              ...current.project,
              placeKo: body.placeKo ?? "",
              placeEn: body.placeEn ?? "",
              placeApprovedKo: body.placeKo ?? "",
              finalSignature: "",
              scenes: current.project.scenes.map((scene, index) => ({
                ...scene,
                shot: planned[index]?.shot === "insert" ? "insert" : "room",
                productionMode: normalizeProductionMode(
                  planned[index]?.productionMode,
                  planned[index]?.shot === "insert" ? "insert" : "room"
                ),
                sceneDescription:
                  planned[index]?.sceneDescription || scene.sceneDescription,
                castIds: planned[index]?.castIds ?? scene.castIds ?? [],
                visualDescription: "",
              })),
            },
          }
        })
      })
      .catch(() => setScriptError("화면 기준을 만들지 못했습니다."))
      .finally(() => setScriptBusy(""))
  }, [ready, studio.project])

  function goTo(step: StepId) {
    setStudio((current) => ({ ...current, step }))
    if (showSide) {
      router.replace(
        `/studio/character?channel=${encodeURIComponent(studio.project.profileId)}`
      )
    }
  }

  function updateProject(patch: Partial<Project>) {
    setStudio((current) => ({
      ...current,
      project: { ...current.project, ...patch },
    }))
  }

  function updateScene(sceneId: string, patch: Partial<Scene>) {
    const narrationChanged =
      patch.scriptKo !== undefined ||
      patch.scriptTarget !== undefined ||
      patch.approvedKo !== undefined
    setStudio((current) => ({
      ...current,
      project: {
        ...current.project,
        ...(narrationChanged
          ? {
              directionSignature: "",
              voicePreviewKey: "",
              sceneDurations: {},
              sceneWordTimings: {},
              finalSignature: "",
            }
          : {}),
        finalSignature: "",
        scenes: current.project.scenes.map((scene) =>
          scene.id === sceneId ? { ...scene, ...patch } : scene
        ),
      },
    }))
  }

  function makeScenes() {
    setStudio((current) => ({
      ...current,
      step: "scenes",
      project: {
        ...current.project,
        finalSignature: "",
        scenes: current.project.scenes.map((scene) => ({
          ...scene,
          visualDescription: scene.sceneDescription,
          voiceScript: scene.scriptTarget,
        })),
      },
    }))
  }

  async function writeOutline() {
    const topic = studio.project.topic.trim()
    const profileId = studio.project.profileId
    setScriptError("")
    setScriptBusy("outline")
    try {
      const response = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "outline", topic, profileId }),
      })
      const body = (await response.json()) as {
        message?: string
        titleKo?: string
        topicEn?: string
        overviewKo?: string
        overviewEn?: string
        placeKo?: string
        placeEn?: string
      }
      if (
        !response.ok ||
        !body.titleKo ||
        !body.topicEn ||
        !body.overviewKo ||
        !body.overviewEn ||
        !body.placeKo ||
        !body.placeEn
      ) {
        setScriptError(body.message || "전체 내용을 쓰지 못했습니다.")
        return
      }
      setStudio((current) => ({
        ...current,
        step: "topic",
        project: {
          ...current.project,
          topic,
          titleKo: body.titleKo ?? "",
          topicEn: body.topicEn ?? "",
          scriptTopic: topic,
          overviewKo: body.overviewKo ?? "",
          overviewEn: body.overviewEn ?? "",
          placeKo: body.placeKo ?? "",
          placeEn: body.placeEn ?? "",
          placeApprovedKo: body.placeKo ?? "",
          finalSignature: "",
          scenes: [],
        },
      }))
      if (showSide) {
        router.replace(
          `/studio/character?channel=${encodeURIComponent(profile?.id ?? "default")}`
        )
      }
    } catch {
      setScriptError("전체 내용을 쓰지 못했습니다.")
    } finally {
      setScriptBusy("")
    }
  }

  async function rewritePlaceNote(note: string) {
    const project = studio.project
    setScriptError("")
    setScriptBusy("place")
    try {
      const response = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "place-note",
          topic: project.topic,
          profileId: project.profileId,
          overviewKo: project.overviewKo,
          placeKo: project.placeKo,
          note,
        }),
      })
      const body = (await response.json()) as {
        message?: string
        placeKo?: string
        placeEn?: string
      }
      if (!response.ok || !body.placeKo || !body.placeEn) {
        setScriptError(body.message || "진행 자리를 다시 쓰지 못했습니다.")
        return false
      }
      setStudio((current) => ({
        ...current,
        project: {
          ...current.project,
          placeKo: body.placeKo ?? "",
          placeEn: body.placeEn ?? "",
          placeApprovedKo: body.placeKo ?? "",
          finalSignature: "",
        },
      }))
      return true
    } catch {
      setScriptError("진행 자리를 다시 쓰지 못했습니다.")
      return false
    } finally {
      setScriptBusy("")
    }
  }

  async function applyOutline() {
    const project = studio.project
    setScriptError("")
    setScriptBusy("apply")
    try {
      const response = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "apply",
          topic: project.topic,
          profileId: project.profileId,
          overviewKo: project.overviewKo,
          overviewEn: project.overviewEn,
          placeKo: project.placeKo,
        }),
      })
      const body = (await response.json()) as {
        message?: string
        placeKo?: string
        placeEn?: string
        scenes?: Project["scenes"]
        youtube?: Project["youtube"]
        instagram?: Project["instagram"]
        tiktok?: Project["tiktok"]
      }
      if (
        !response.ok ||
        !body.placeEn ||
        !body.scenes ||
        !body.youtube ||
        !body.instagram ||
        !body.tiktok
      ) {
        setScriptError(body.message || "대본을 적용하지 못했습니다.")
        return
      }
      setStudio((current) => ({
        ...current,
        step: "script",
        project: {
          ...current.project,
          placeKo: body.placeKo || current.project.placeKo,
          placeEn: body.placeEn ?? "",
          placeApprovedKo: body.placeKo || current.project.placeKo,
          finalSignature: "",
          scenes: body.scenes ?? [],
          directionSignature: "",
          voicePreviewKey: "",
          sceneDurations: {},
          sceneWordTimings: {},
          youtube: { ...current.project.youtube, ...body.youtube },
          instagram: {
            ...current.project.instagram,
            caption: body.instagram?.caption ?? "",
          },
          tiktok: {
            ...current.project.tiktok,
            caption: body.tiktok?.caption ?? "",
          },
        },
      }))
    } catch {
      setScriptError("대본을 적용하지 못했습니다.")
    } finally {
      setScriptBusy("")
    }
  }

  async function rewriteScene(sceneId: string) {
    const scene = studio.project.scenes.find((item) => item.id === sceneId)
    if (!scene) {
      return
    }
    setScriptError("")
    setScriptBusy(sceneId)
    try {
      const response = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "scene",
          topic: studio.project.topic,
          profileId: studio.project.profileId,
          changedSceneId: sceneId,
          titleKo: studio.project.titleKo,
          topicEn: studio.project.topicEn,
          scenes: studio.project.scenes,
        }),
      })
      const body = (await response.json()) as {
        message?: string
        titleKo?: string
        topicEn?: string
        overviewKo?: string
        overviewEn?: string
        scenes?: Project["scenes"]
        youtube?: Project["youtube"]
        instagram?: Project["instagram"]
        tiktok?: Project["tiktok"]
      }
      if (
        !response.ok ||
        !body.titleKo ||
        !body.topicEn ||
        !body.scenes ||
        !body.youtube ||
        !body.instagram ||
        !body.tiktok
      ) {
        setScriptError(body.message || "연결된 내용을 맞추지 못했습니다.")
        return
      }
      setStudio((current) => ({
        ...current,
        project: {
          ...current.project,
          titleKo: body.titleKo ?? current.project.titleKo,
          topicEn: body.topicEn ?? current.project.topicEn,
          overviewKo: body.overviewKo ?? current.project.overviewKo,
          overviewEn: body.overviewEn ?? current.project.overviewEn,
          scenes: body.scenes ?? current.project.scenes,
          youtube: { ...current.project.youtube, ...body.youtube },
          instagram: {
            ...current.project.instagram,
            caption:
              body.instagram?.caption ?? current.project.instagram.caption,
          },
          tiktok: {
            ...current.project.tiktok,
            caption: body.tiktok?.caption ?? current.project.tiktok.caption,
          },
          finalSignature: "",
          directionSignature: "",
          voicePreviewKey: "",
          sceneDurations: {},
          sceneWordTimings: {},
        },
      }))
    } catch {
      setScriptError("연결된 내용을 맞추지 못했습니다.")
    } finally {
      setScriptBusy("")
    }
  }

  async function makeSceneVideos() {
    setScriptError("")
    if (!directionReady(studio.project)) {
      setScriptError("대본과 TTS에 맞는 화면 연출을 먼저 만들어야 합니다.")
      return
    }
    const response = await fetch("/api/film/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filmBody(studio.project, profile!)),
    })
    const body = (await response.json()) as { message?: string }
    if (!response.ok) {
      setScriptError(body.message || "씬 영상을 시작하지 못했습니다.")
      return
    }
    makeScenes()
  }

  async function makeDirection(preview: {
    key: string
    clips: {
      id: string
      duration: number
      text: string
      words: { word: string; start: number; end: number }[]
    }[]
  }) {
    const project = studio.project
    setScriptError("")
    setScriptBusy("direction")
    try {
      const settingsResponse = await fetch(
        `/api/video?profileId=${encodeURIComponent(project.profileId)}`
      )
      const settings = (await settingsResponse.json()) as {
        targetDurationSeconds?: number
        durationToleranceSeconds?: number
      }
      const target = settings.targetDurationSeconds ?? 40
      const tolerance = settings.durationToleranceSeconds ?? 5
      const minimum = target - tolerance
      const maximum = target + tolerance
      let workingScenes = project.scenes
      let workingPreview = preview
      let fitted:
        | {
            overviewKo?: string
            overviewEn?: string
            youtube?: Project["youtube"]
            instagram?: Project["instagram"]
            tiktok?: Project["tiktok"]
          }
        | undefined

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const measured = workingPreview.clips.reduce(
          (sum, clip) => sum + clip.duration,
          0
        )
        if (measured >= minimum && measured <= maximum) break
        const fitResponse = await fetch("/api/script", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "fit-duration",
            topic: project.topic,
            profileId: project.profileId,
            measuredSeconds: measured,
            scenes: workingScenes,
          }),
        })
        const fitBody = (await fitResponse.json()) as {
          message?: string
          scenes?: Project["scenes"]
          overviewKo?: string
          overviewEn?: string
          youtube?: Project["youtube"]
          instagram?: Project["instagram"]
          tiktok?: Project["tiktok"]
        }
        if (!fitResponse.ok || !fitBody.scenes) {
          setScriptError(
            fitBody.message || "대본 길이를 자동으로 맞추지 못했습니다."
          )
          return
        }
        workingScenes = fitBody.scenes
        fitted = fitBody
        const voiceResponse = await fetch("/api/voice/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            profileId: project.profileId,
            scenes: workingScenes.map((scene) => ({
              id: scene.id,
              text: scene.scriptTarget,
            })),
          }),
        })
        const voiceBody = (await voiceResponse.json()) as typeof preview & {
          message?: string
        }
        if (!voiceResponse.ok || !voiceBody.key || !voiceBody.clips) {
          setScriptError(
            voiceBody.message || "수정된 대본의 음성을 측정하지 못했습니다."
          )
          return
        }
        workingPreview = voiceBody
      }

      const measured = workingPreview.clips.reduce(
        (sum, clip) => sum + clip.duration,
        0
      )
      if (measured < minimum || measured > maximum) {
        setScriptError(
          `자동 조정 후 음성이 ${measured.toFixed(1)}초입니다. 대본에서 직접 조정해 주세요.`
        )
        return
      }
      const durations = Object.fromEntries(
        workingPreview.clips.map((clip) => [clip.id, clip.duration])
      )
      const words = Object.fromEntries(
        workingPreview.clips.map((clip) => [clip.id, clip.words])
      )
      const response = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "direction",
          topic: project.topic,
          profileId: project.profileId,
          scenes: workingScenes,
          durations,
          words,
        }),
      })
      const body = (await response.json()) as {
        message?: string
        scenes?: Project["scenes"]
      }
      if (!response.ok || !body.scenes) {
        setScriptError(body.message || "화면 연출을 만들지 못했습니다.")
        return
      }
      setStudio((current) => ({
        step: "direction",
        project: {
          ...current.project,
          scenes: body.scenes ?? current.project.scenes,
          overviewKo: fitted?.overviewKo ?? current.project.overviewKo,
          overviewEn: fitted?.overviewEn ?? current.project.overviewEn,
          youtube: fitted?.youtube
            ? { ...current.project.youtube, ...fitted.youtube }
            : current.project.youtube,
          instagram: fitted?.instagram
            ? { ...current.project.instagram, ...fitted.instagram }
            : current.project.instagram,
          tiktok: fitted?.tiktok
            ? { ...current.project.tiktok, ...fitted.tiktok }
            : current.project.tiktok,
          voicePreviewKey: workingPreview.key,
          sceneDurations: durations,
          sceneWordTimings: words,
          directionSignature: narrationSignature(
            body.scenes ?? current.project.scenes,
            workingPreview.key
          ),
          finalSignature: "",
        },
      }))
    } catch {
      setScriptError("화면 연출을 만들지 못했습니다.")
    } finally {
      setScriptBusy("")
    }
  }

  async function redoSceneClip(groupId: string) {
    setFilmNote("")
    await fetch("/api/film/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...filmBody(studio.project, profile!), groupId }),
    })
  }

  async function makeFilm() {
    const source = studio.project
    const project = source.finalSignature
      ? { ...source, historyId: crypto.randomUUID(), finalSignature: "" }
      : source
    const next: StudioState = {
      step: "film",
      project: { ...project, finalSignature: "" },
    }
    setFilmNote("")
    setStudio(next)
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      const response = await fetch("/api/film", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...filmBody(project, profile!),
          autoUpload: project.autoUpload,
          scheduledAt: project.scheduledAt,
          youtube: project.youtube,
          historyId: next.project.historyId,
        }),
      })
      const body = (await response.json()) as { message?: string }
      if (!response.ok) {
        setFilmNote(body.message || "영상을 시작하지 못했습니다.")
      }
    } catch {
      setFilmNote("영상을 시작하지 못했습니다.")
    }
  }

  async function openHistory(id: string) {
    try {
      const response = await fetch(`/api/history/${id}`)
      const body = (await response.json()) as {
        studio?: StudioState
        hasVideo?: boolean
        signature?: string
      }
      const saved = body.studio
      if (
        !response.ok ||
        !saved ||
        !STEPS.some((step) => step.id === saved.step)
      ) {
        return
      }
      const project = normalizeProject(saved.project)
      if (
        body.hasVideo &&
        body.signature &&
        filmSignature(project) === body.signature
      ) {
        project.finalSignature = body.signature
      }
      setStudio({ step: saved.step, project })
      router.push(
        `/studio/character?channel=${encodeURIComponent(project.profileId)}`
      )
    } catch {
      setScriptError("작업을 불러오지 못했습니다.")
    }
  }

  const markFilmReady = useCallback(() => {
    setStudio((current) => {
      const signature = filmSignature(current.project)
      if (current.project.finalSignature === signature) {
        return current
      }
      return {
        ...current,
        step: "upload",
        project: { ...current.project, finalSignature: signature },
      }
    })
  }, [])

  if (!profile) {
    return (
      <ChannelHub
        profiles={profiles}
        onOpen={(profileId) =>
          router.push(
            `/studio/character?channel=${encodeURIComponent(profileId)}`
          )
        }
        onCreated={(created) => {
          setProfiles((current) => [...current, created])
          router.push(
            `/studio/character?channel=${encodeURIComponent(created.id)}`
          )
        }}
        onDeleted={(profileId) => {
          setProfiles((current) =>
            current.filter((profile) => profile.id !== profileId)
          )
        }}
        onBack={() => router.push("/")}
      />
    )
  }

  return (
    <div className="flex h-svh bg-background text-foreground">
      <aside className="sticky top-0 flex h-svh w-56 shrink-0 flex-col border-r border-separator bg-surface">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs tracking-wide text-muted">캐릭터·AI 생성형</p>
            <h1 className="mt-1 truncate text-base font-medium">
              {profile.name}
            </h1>
          </div>
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="캐릭터 채널 변경"
            className="shrink-0"
            onPress={() => router.push("/studio/character")}
          >
            <ArrowLeftRight className="size-4" />
          </Button>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {STEPS.map((step, index) => {
            const active = step.id === studio.step && !showSide
            return (
              <Button
                key={step.id}
                variant={active ? "secondary" : "ghost"}
                fullWidth
                onPress={() => goTo(step.id)}
              >
                <span className="flex w-full items-center justify-start gap-2">
                  <span className="text-muted">{index + 1}</span>
                  <span>{step.label}</span>
                </span>
              </Button>
            )
          })}
        </nav>
        <div className="flex flex-col gap-2 p-3">
          <Button
            variant={showHistory ? "secondary" : "ghost"}
            fullWidth
            onPress={() =>
              router.push(
                `/studio/character?channel=${encodeURIComponent(profile.id)}&view=history`
              )
            }
          >
            <span className="flex w-full items-center justify-start">
              히스토리
            </span>
          </Button>
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            fullWidth
            onPress={() =>
              router.push(
                `/studio/character?channel=${encodeURIComponent(profile.id)}&view=settings`
              )
            }
          >
            <span className="flex w-full items-center justify-start">
              채널 설정
            </span>
          </Button>
          <Button variant="ghost" fullWidth onPress={() => router.push("/")}>
            <span className="flex w-full items-center gap-2 text-left">
              <Home className="size-4" /> 홈
            </span>
          </Button>
        </div>
      </aside>

      <ScrollShadow className="h-svh min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          {showHistory ? (
            <HistoryPanel
              currentId={studio.project.historyId}
              profileId={profile.id}
              onOpen={(id) => void openHistory(id)}
            />
          ) : showSettings ? (
            <SettingsPanel
              initialTab={settingsTab(view, searchParams.get("tab"))}
              accountNotice={accountNotice(searchParams)}
              initialAccounts={initialAccounts}
              profile={profile}
              onProfileSaved={(saved) =>
                setProfiles((current) =>
                  current.map((item) => (item.id === saved.id ? saved : item))
                )
              }
            />
          ) : (
            <>
              {studio.step === "topic" ? (
                <TopicStep
                  topic={studio.project.topic}
                  profileId={profile.id}
                  titleKo={studio.project.titleKo}
                  topicEn={studio.project.topicEn}
                  overviewKo={studio.project.overviewKo}
                  overviewEn={studio.project.overviewEn}
                  placeKo={studio.project.placeKo}
                  planReady={
                    studio.project.overviewKo.trim() !== "" &&
                    studio.project.topic.trim() ===
                      studio.project.scriptTopic.trim()
                  }
                  onTopicChange={(topic) => updateProject({ topic })}
                  onTitleKoChange={(titleKo) => updateProject({ titleKo })}
                  onTopicEnChange={(topicEn) => updateProject({ topicEn })}
                  onOverviewChange={(overviewKo) =>
                    updateProject({ overviewKo })
                  }
                  onOverviewEnChange={(overviewEn) =>
                    updateProject({ overviewEn })
                  }
                  onPlaceChange={(placeKo) => updateProject({ placeKo })}
                  onWrite={() => void writeOutline()}
                  onApply={() => void applyOutline()}
                  onRewritePlace={rewritePlaceNote}
                  writeBusy={scriptBusy === "outline"}
                  applyBusy={scriptBusy === "apply"}
                  placeBusy={scriptBusy === "place"}
                  error={scriptError}
                />
              ) : null}

              {studio.step === "script" ? (
                <ScriptStep
                  project={studio.project}
                  onKoreanChange={(sceneId, scriptKo) =>
                    updateScene(sceneId, { scriptKo })
                  }
                  onSubtitleChange={(sceneId, subtitle) =>
                    updateScene(sceneId, { subtitle })
                  }
                  onRevertKorean={(sceneId) => {
                    const scene = studio.project.scenes.find(
                      (item) => item.id === sceneId
                    )
                    if (scene) {
                      updateScene(sceneId, { scriptKo: scene.approvedKo })
                    }
                  }}
                  onBack={() => goTo("topic")}
                  onComplete={(preview) => void makeDirection(preview)}
                  busy={scriptBusy}
                  error={scriptError}
                  onRewriteScene={(sceneId) => void rewriteScene(sceneId)}
                />
              ) : null}

              {studio.step === "direction" ? (
                <DirectionStep
                  project={studio.project}
                  busy={scriptBusy !== ""}
                  error={scriptError}
                  onBack={() => goTo("script")}
                  onMake={() => void makeSceneVideos()}
                  onPictureChange={(sceneId, sceneDescription) =>
                    updateScene(sceneId, {
                      sceneDescription,
                      visualDescription: "",
                    })
                  }
                  onProductionModeChange={(sceneId, productionMode) =>
                    updateScene(sceneId, {
                      productionMode,
                      visualDescription: "",
                    })
                  }
                  onCastEnter={(characterId, fromIndex) =>
                    setStudio((current) => ({
                      ...current,
                      project: {
                        ...current.project,
                        scenes: current.project.scenes.map((scene, index) => {
                          const ids = new Set(scene.castIds ?? [])
                          if (
                            scene.shot === "insert" ||
                            fromIndex === null ||
                            index < fromIndex
                          ) {
                            ids.delete(characterId)
                          } else {
                            ids.add(characterId)
                          }
                          return { ...scene, castIds: [...ids] }
                        }),
                        finalSignature: "",
                      },
                    }))
                  }
                />
              ) : null}

              {studio.step === "scenes" ? (
                <ScenesStep
                  scenes={studio.project.scenes}
                  bgmId={studio.project.bgmId}
                  signature={filmSignature(studio.project)}
                  onBgmChange={(bgmId) => updateProject({ bgmId })}
                  blockedNote={scriptBlocked(studio.project)}
                  onBack={() => goTo("direction")}
                  onNext={() => goTo("film")}
                  onRedoClip={(groupId) => void redoSceneClip(groupId)}
                />
              ) : null}

              {studio.step === "film" ? (
                <FilmStep
                  project={studio.project}
                  note={filmNote}
                  onAssemble={() => void makeFilm()}
                  onReady={markFilmReady}
                />
              ) : null}

              {studio.step === "upload" ? (
                <UploadStep
                  project={studio.project}
                  coverAnchor={profile.image_style_anchor}
                  youtubeCredentials={profile.youtube_channel_credentials}
                  youtubeBgm={{
                    track: profile.youtube_bgm_track,
                    artist: profile.youtube_bgm_artist,
                    volume: profile.youtube_bgm_volume,
                  }}
                  instagramCredentials={profile.instagram_credentials}
                  tiktokCredentials={profile.tiktok_credentials}
                  onYoutubeChange={(youtube) => updateProject({ youtube })}
                  onInstagramChange={(instagram) =>
                    updateProject({ instagram })
                  }
                  onTiktokChange={(tiktok) => updateProject({ tiktok })}
                  onScheduledAt={(scheduledAt) =>
                    updateProject({ scheduledAt })
                  }
                  onAutoUpload={(autoUpload) => updateProject({ autoUpload })}
                  onBack={() => goTo("film")}
                />
              ) : null}
            </>
          )}
        </main>
      </ScrollShadow>
    </div>
  )
}

function settingsTab(view: string | null, tab: string | null) {
  if (view === "character" || tab === "character") {
    return "character" as const
  }
  if (view === "accounts" || tab === "accounts") {
    return "accounts" as const
  }
  if (tab === "frame") return tab
  return "frame" as const
}

function accountNotice(searchParams: { get: (name: string) => string | null }) {
  const connected = searchParams.get("connected")
  if (connected) {
    return { kind: "connected" as const, platform: connected }
  }
  if (searchParams.get("error")) {
    return {
      kind: "error" as const,
      platform: searchParams.get("platform") || "",
    }
  }
  return null
}
