"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Button, ScrollShadow, Separator } from "@heroui/react"
import { CharacterPanel } from "@/components/studio/character-panel"
import { FilmStep } from "@/components/studio/film-step"
import { ScenesStep } from "@/components/studio/scenes-step"
import { ScriptStep } from "@/components/studio/script-step"
import { SettingsPanel } from "@/components/studio/settings-panel"
import { TopicStep } from "@/components/studio/topic-step"
import { UploadStep } from "@/components/studio/upload-step"
import { filmSignature } from "@/lib/scene-status"
import { defaultSubtitle } from "@/lib/timing"
import { applyYoutubeCopy, scheduleForUpload } from "@/lib/youtube-metadata"
import { getProfile } from "@/lib/profiles"
import { STORAGE_KEY, sampleStudio } from "@/lib/sample-project"
import type { AccountPlatform, AccountStatus } from "@/lib/server/accounts"
import { STEPS, type Project, type Scene, type SocialPost, type StepId, type StudioState, type YoutubeMeta } from "@/lib/types"

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
  const fallbackCaption = [stored.title, stored.description].filter(Boolean).join("\n\n")
  return {
    ...project,
    scheduledAt: scheduleForUpload(project.scheduledAt || stored.scheduledAt || ""),
    outfitId: typeof project.outfitId === "string" && project.outfitId ? project.outfitId : null,
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
      subtitle: typeof scene.subtitle === "string" ? scene.subtitle : defaultSubtitle(scene.scriptTarget),
    })),
  }
}

function normalizePost(post: SocialPost | undefined, fallbackCaption: string): SocialPost {
  if (!post || typeof post.caption !== "string" || typeof post.enabled !== "boolean") {
    return { enabled: true, caption: fallbackCaption }
  }
  return post
}

export function StudioApp({
  initialAccounts,
}: {
  initialAccounts: Record<AccountPlatform, AccountStatus>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = searchParams.get("view")
  const showCharacter = view === "character"
  const showSettings = view === "settings" || view === "accounts"
  const showSide = showCharacter || showSettings
  const [studio, setStudio] = useState<StudioState>(sampleStudio)
  const [ready, setReady] = useState(false)
  const [scriptBusy, setScriptBusy] = useState("")
  const [scriptError, setScriptError] = useState("")

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
          scene.id === sceneId ? { ...scene, ...patch } : scene,
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

  function regenVisual(sceneId: string) {
    setStudio((current) => ({
      ...current,
      project: {
        ...current.project,
        finalSignature: "",
        scenes: current.project.scenes.map((scene) =>
          scene.id === sceneId ? { ...scene, visualDescription: scene.sceneDescription } : scene,
        ),
      },
    }))
  }

  function regenVoice(sceneId: string) {
    setStudio((current) => ({
      ...current,
      project: {
        ...current.project,
        finalSignature: "",
        scenes: current.project.scenes.map((scene) =>
          scene.id === sceneId ? { ...scene, voiceScript: scene.scriptTarget } : scene,
        ),
      },
    }))
  }

  async function writeDraft(topic: string, profileId: string) {
    setScriptError("")
    setScriptBusy("draft")
    try {
      const response = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "draft", topic, profileId }),
      })
      const body = (await response.json()) as {
        message?: string
        scenes?: Project["scenes"]
        youtube?: Project["youtube"]
        instagram?: Project["instagram"]
        tiktok?: Project["tiktok"]
      }
      if (!response.ok || !body.scenes || !body.youtube || !body.instagram || !body.tiktok) {
        setScriptError(body.message || "대본을 쓰지 못했습니다.")
        return
      }
      setStudio((current) => ({
        ...current,
        step: "script",
        project: {
          ...current.project,
          scriptTopic: topic.trim(),
          finalSignature: "",
          scenes: body.scenes ?? current.project.scenes,
          youtube: { ...current.project.youtube, ...body.youtube },
          instagram: { ...current.project.instagram, caption: body.instagram?.caption ?? "" },
          tiktok: { ...current.project.tiktok, caption: body.tiktok?.caption ?? "" },
        },
      }))
      if (showSide) {
        router.replace("/")
      }
    } catch {
      setScriptError("대본을 쓰지 못했습니다.")
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
            .map((item) => ({ scriptKo: item.scriptKo, scriptTarget: item.scriptTarget })),
        }),
      })
      const body = (await response.json()) as { message?: string; scriptTarget?: string }
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

  function makeFilm() {
    setStudio((current) => ({
      ...current,
      step: "film",
      project: {
        ...current.project,
        finalSignature: filmSignature(current.project.scenes),
      },
    }))
  }

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
            variant={showCharacter ? "secondary" : "ghost"}
            fullWidth
            onPress={() => router.push("/?view=character")}
          >
            <span className="flex w-full items-center justify-start">캐릭터</span>
          </Button>
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            fullWidth
            onPress={() => router.push("/?view=settings")}
          >
            <span className="flex w-full items-center justify-start">설정</span>
          </Button>
          <Button variant="outline" fullWidth onPress={() => setStudio(sampleStudio)}>
            샘플로 되돌리기
          </Button>
        </div>
      </aside>

      <ScrollShadow className="h-svh min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          {showCharacter ? (
            <CharacterPanel />
          ) : showSettings ? (
            <SettingsPanel
              initialTab={view === "accounts" || searchParams.get("tab") === "accounts" ? "accounts" : "frame"}
              accountNotice={accountNotice(searchParams)}
              initialAccounts={initialAccounts}
            />
          ) : (
            <>
          {studio.step === "topic" ? (
            <TopicStep
              topic={studio.project.topic}
              profileId={studio.project.profileId}
              onTopicChange={(topic) => updateProject({ topic })}
              onProfileChange={(profileId) => updateProject({ profileId })}
              busy={scriptBusy === "draft"}
              error={scriptError}
              onNext={() => {
                const topic = studio.project.topic.trim()
                if (topic === studio.project.scriptTopic.trim() && studio.project.scenes.length > 0) {
                  setScriptError("")
                  goTo("script")
                  return
                }
                void writeDraft(topic, studio.project.profileId)
              }}
            />
          ) : null}

          {studio.step === "script" ? (
            <ScriptStep
              project={studio.project}
              onKoreanChange={(sceneId, scriptKo) => updateScene(sceneId, { scriptKo })}
              onSubtitleChange={(sceneId, subtitle) => updateScene(sceneId, { subtitle })}
              onDescriptionChange={(sceneId, sceneDescription) =>
                updateScene(sceneId, { sceneDescription })
              }
              onRevertKorean={(sceneId) => {
                const scene = studio.project.scenes.find((item) => item.id === sceneId)
                if (scene) {
                  updateScene(sceneId, { scriptKo: scene.approvedKo })
                }
              }}
              onBack={() => goTo("topic")}
              onMake={makeScenes}
              outfitId={studio.project.outfitId}
              onOutfitChange={(outfitId) => updateProject({ outfitId })}
              busy={scriptBusy}
              error={scriptError}
              onRewrite={() => void writeDraft(studio.project.topic, studio.project.profileId)}
              onRewriteScene={(sceneId) => void rewriteScene(sceneId)}
            />
          ) : null}

          {studio.step === "scenes" ? (
            <ScenesStep
              scenes={studio.project.scenes}
              anchor={profile.image_style_anchor}
              onRegenVisual={regenVisual}
              onRegenVoice={regenVoice}
              onBack={() => goTo("script")}
              onMakeFilm={makeFilm}
              outfitId={studio.project.outfitId}
            />
          ) : null}

          {studio.step === "film" ? (
            <FilmStep
              project={studio.project}
              onBack={() => goTo("scenes")}
              onNext={() => goTo("upload")}
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
              onInstagramChange={(instagram) => updateProject({ instagram })}
              onTiktokChange={(tiktok) => updateProject({ tiktok })}
              onScheduledAt={(scheduledAt) => updateProject({ scheduledAt })}
              onAutoUpload={(autoUpload) => updateProject({ autoUpload })}
              onBack={() => goTo("film")}
            />
          ) : null}
            </>
          )}

          {showSide ? null : (
            <p className="text-xs text-muted">
              {stepIndex + 1} / {STEPS.length}
              {ready ? " · 이 브라우저에 저장됨" : ""}
            </p>
          )}
        </main>
      </ScrollShadow>
    </div>
  )
}

function accountNotice(searchParams: { get: (name: string) => string | null }) {
  const connected = searchParams.get("connected")
  if (connected) {
    return { kind: "connected" as const, platform: connected }
  }
  if (searchParams.get("error")) {
    return { kind: "error" as const, platform: searchParams.get("platform") || "" }
  }
  return null
}
