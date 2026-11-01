"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Button, ScrollShadow, Separator } from "@heroui/react"
import { FilmStep } from "@/components/studio/film-step"
import { HistoryPanel } from "@/components/studio/history-panel"
import { ScenesStep } from "@/components/studio/scenes-step"
import { ScriptStep } from "@/components/studio/script-step"
import { SettingsPanel } from "@/components/studio/settings-panel"
import { TopicStep } from "@/components/studio/topic-step"
import { UploadStep } from "@/components/studio/upload-step"
import { isHistoryId } from "@/lib/history"
import { filmSignature, scriptBlocked } from "@/lib/scene-status"
import { defaultSubtitle } from "@/lib/timing"
import { applyYoutubeCopy, scheduleForUpload } from "@/lib/youtube-metadata"
import { getProfile } from "@/lib/profiles"
import { STORAGE_KEY, sampleStudio } from "@/lib/sample-project"
import type { AccountPlatform, AccountStatus } from "@/lib/server/accounts"
import {
  STEPS,
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
    typeof scene.sceneDescription === "string" &&
    typeof scene.visualDescription === "string" &&
    typeof scene.voiceScript === "string"
  )
}

function loadStudio(): StudioState {
  if (typeof window === "undefined") {
    return sampleStudio
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return sampleStudio
    }
    const parsed = JSON.parse(raw) as StudioState
    if (
      !parsed.project?.scenes?.every(isScene) ||
      !STEPS.some((step) => step.id === parsed.step) ||
      typeof parsed.project.autoUpload !== "boolean" ||
      typeof parsed.project.finalSignature !== "string"
    ) {
      return sampleStudio
    }
    return { ...parsed, project: normalizeProject(parsed.project) }
  } catch {
    return sampleStudio
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

function filmBody(project: Project) {
  return {
    topic: project.topicEn.trim(),
    profileId: project.profileId,
    placeEn: project.placeEn,
    anchor: getProfile(project.profileId).image_style_anchor,
    outfitId: project.outfitId,
    bgmId: project.bgmId,
    signature: filmSignature(project),
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      shot: scene.shot === "insert" ? "insert" : "room",
      sceneDescription: scene.sceneDescription,
      scriptTarget: scene.scriptTarget,
      subtitle: scene.subtitle,
      actionBeats: scene.actionBeats,
      castIds: scene.castIds ?? [],
    })),
  }
}

export function StudioApp({
  initialAccounts,
}: {
  initialAccounts: Record<AccountPlatform, AccountStatus>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
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
  const placesOnce = useRef(false)

  useEffect(() => {
    setStudio(loadStudio())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) {
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(studio))
  }, [ready, studio])

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
            setDiskSaved(false)
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
            return
          }
          setDiskSaved(true)
        })
        .catch(() => setDiskSaved(false))
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
    setScriptBusy("places")
    setScriptError("")
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
          scenes?: { shot?: string; sceneDescription?: string }[]
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
                sceneDescription:
                  planned[index]?.sceneDescription || scene.sceneDescription,
                visualDescription: "",
              })),
            },
          }
        })
      })
      .catch(() => setScriptError("화면 기준을 만들지 못했습니다."))
      .finally(() => setScriptBusy(""))
  }, [ready, studio.project])

  const profile = getProfile(studio.project.profileId)
  const stepIndex = STEPS.findIndex((step) => step.id === studio.step)

  function goTo(step: StepId) {
    setStudio((current) => ({ ...current, step }))
    if (showSide) {
      router.replace("/")
    }
  }

  function updateProject(patch: Partial<Project>) {
    setStudio((current) => ({
      ...current,
      project: { ...current.project, ...patch },
    }))
  }

  function updateScene(sceneId: string, patch: Partial<Scene>) {
    setStudio((current) => ({
      ...current,
      project: {
        ...current.project,
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
        router.replace("/")
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
          scriptKo: scene.scriptKo,
          sceneDescription: scene.sceneDescription,
          neighbors: studio.project.scenes
            .filter((item) => item.id !== sceneId)
            .map((item) => ({
              scriptKo: item.scriptKo,
              scriptTarget: item.scriptTarget,
            })),
        }),
      })
      const body = (await response.json()) as {
        message?: string
        scriptTarget?: string
      }
      if (!response.ok || !body.scriptTarget) {
        setScriptError(body.message || "영어를 맞추지 못했습니다.")
        return
      }
      updateScene(sceneId, {
        scriptTarget: body.scriptTarget,
        approvedKo: scene.scriptKo,
        subtitle: defaultSubtitle(body.scriptTarget),
      })
    } catch {
      setScriptError("영어를 맞추지 못했습니다.")
    } finally {
      setScriptBusy("")
    }
  }

  const [filmNote, setFilmNote] = useState("")
  const [diskSaved, setDiskSaved] = useState(false)

  async function makeSceneVideos() {
    setScriptError("")
    const response = await fetch("/api/film/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filmBody(studio.project)),
    })
    const body = (await response.json()) as { message?: string }
    if (!response.ok) {
      setScriptError(body.message || "씬 영상을 시작하지 못했습니다.")
      return
    }
    makeScenes()
  }

  async function redoSceneClip(groupId: string) {
    setFilmNote("")
    await fetch("/api/film/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...filmBody(studio.project), groupId }),
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
          ...filmBody(project),
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
      router.push("/")
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

  return (
    <div className="flex h-svh bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-separator bg-surface">
        <div className="px-4 py-5">
          <p className="text-xs tracking-wide text-muted">로컬 작업실</p>
          <h1 className="mt-1 text-base font-medium">쇼츠 스튜디오</h1>
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
            onPress={() => router.push("/?view=history")}
          >
            <span className="flex w-full items-center justify-start">
              히스토리
            </span>
          </Button>
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            fullWidth
            onPress={() => router.push("/?view=settings")}
          >
            <span className="flex w-full items-center justify-start">설정</span>
          </Button>
          <Button
            variant="outline"
            fullWidth
            onPress={() =>
              setStudio({
                ...sampleStudio,
                project: {
                  ...sampleStudio.project,
                  historyId: crypto.randomUUID(),
                },
              })
            }
          >
            샘플로 되돌리기
          </Button>
        </div>
      </aside>

      <ScrollShadow className="h-svh min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          {showHistory ? (
            <HistoryPanel
              currentId={studio.project.historyId}
              onOpen={(id) => void openHistory(id)}
            />
          ) : showSettings ? (
            <SettingsPanel
              initialTab={settingsTab(view, searchParams.get("tab"))}
              accountNotice={accountNotice(searchParams)}
              initialAccounts={initialAccounts}
            />
          ) : (
            <>
              {studio.step === "topic" ? (
                <TopicStep
                  topic={studio.project.topic}
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
                  onMake={() => void makeSceneVideos()}
                  busy={scriptBusy}
                  error={scriptError}
                  onRewriteScene={(sceneId) => void rewriteScene(sceneId)}
                  onPictureChange={(sceneId, sceneDescription) =>
                    updateScene(sceneId, {
                      sceneDescription,
                      visualDescription: sceneDescription,
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
                      },
                    }))
                  }
                />
              ) : null}

              {studio.step === "scenes" ? (
                <ScenesStep
                  scenes={studio.project.scenes}
                  topic={studio.project.topicEn}
                  bgmId={studio.project.bgmId}
                  signature={filmSignature(studio.project)}
                  onBgmChange={(bgmId) => updateProject({ bgmId })}
                  blockedNote={scriptBlocked(studio.project)}
                  onBack={() => goTo("script")}
                  onNext={() => goTo("film")}
                  onRedoClip={(groupId) => void redoSceneClip(groupId)}
                  outfitId={studio.project.outfitId}
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

          {showSide ? null : (
            <p className="text-xs text-muted">
              {stepIndex + 1} / {STEPS.length}
              {ready
                ? diskSaved
                  ? " · 이 컴퓨터에 저장됨"
                  : " · 이 브라우저에 저장됨"
                : ""}
            </p>
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
  if (tab === "keys" || tab === "frame") {
    return tab
  }
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
