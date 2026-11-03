"use client"

import { useEffect, useState } from "react"

import { Button, Card, Chip } from "@heroui/react"
import { BgmPicker } from "@/components/studio/bgm-card"
import { ClipPreview } from "@/components/studio/clip-preview"
import { StepActions, StepHeader } from "@/components/studio/chrome"
import { OutfitUsage } from "@/components/studio/outfit-choice"
import { videoGroups } from "@/lib/film-groups"
import { SCENE_PRODUCTION_LABELS } from "@/lib/scene-production"
import { englishIsStale, projectSeconds } from "@/lib/scene-status"
import { formatSeconds, narrationSeconds, narrationTooLong } from "@/lib/timing"
import type { Scene } from "@/lib/types"

type ClipJob = {
  state: "idle" | "running" | "done" | "error"
  message: string
  signature: string
  groups: { id: string; sceneIds: string[]; ready: boolean; seconds: number }[]
}

export function ScenesStep({
  scenes,
  bgmId,
  signature,
  onBgmChange,
  blockedNote,
  onBack,
  onNext,
  onRedoClip,
}: {
  scenes: Scene[]
  bgmId: string
  signature: string
  onBgmChange: (bgmId: string) => void
  blockedNote: string
  onBack: () => void
  onNext: () => void
  onRedoClip: (groupId: string) => void
}) {
  const blocked = blockedNote !== ""
  const over = narrationTooLong(projectSeconds(scenes))
  const groups = videoGroups(
    scenes.map((scene) => ({
      id: scene.id,
      shot: scene.shot,
      productionMode: scene.productionMode,
      sceneDescription: scene.sceneDescription,
      scriptTarget: scene.scriptTarget,
      subtitle: scene.subtitle,
      actionBeats: scene.actionBeats,
      castIds: scene.castIds ?? [],
    }))
  )
  const [job, setJob] = useState<ClipJob>({
    state: "idle",
    message: "",
    signature: "",
    groups: [],
  })

  useEffect(() => {
    let stop = false
    async function load() {
      try {
        const response = await fetch(
          `/api/film/clips?signature=${encodeURIComponent(signature)}`
        )
        const body = (await response.json()) as ClipJob
        if (!stop) {
          setJob(body)
        }
      } catch {
        if (!stop) {
          setJob((current) => ({
            ...current,
            state: "error",
            message: "씬 영상 상태를 읽지 못했습니다.",
          }))
        }
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [signature])

  const readyGroups = job.signature === signature ? job.groups : []
  const allReady =
    groups.length > 0 &&
    groups.every(
      (group) => readyGroups.find((item) => item.id === group.id)?.ready
    )

  return (
    <>
      <StepHeader
        title="씬"
        description="AI 영상과 로컬 2D 모션이 섞인 TTS 포함 3:4 장면을 확인합니다. 제목, 자막과 BGM은 영상 단계에서 합칩니다."
      />

      <OutfitUsage />

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group, index) => {
          const status = readyGroups.find((item) => item.id === group.id)
          const groupedScenes = scenes.filter((scene) =>
            group.sceneIds.includes(scene.id)
          )
          return (
            <SceneClipCard
              key={group.id}
              index={index}
              sceneLabels={group.sceneIds.map((id) => {
                const sceneIndex = scenes.findIndex((scene) => scene.id === id)
                return sceneIndex + 1
              })}
              lines={groupedScenes.map((scene) => scene.scriptTarget)}
              productionLabel={
                SCENE_PRODUCTION_LABELS[group.scenes[0].productionMode]
              }
              seconds={
                status?.ready
                  ? status.seconds
                  : groupedScenes.reduce(
                      (sum, scene) =>
                        sum + narrationSeconds(scene.scriptTarget),
                      0
                    )
              }
              ready={status?.ready === true}
              stale={groupedScenes.some(englishIsStale)}
              busy={job.state === "running"}
              onRedo={() => onRedoClip(group.id)}
            />
          )
        })}
      </div>

      <BgmPicker bgmId={bgmId} onChange={onBgmChange} />

      <StepActions
        onBack={onBack}
        nextLabel="영상으로 넘어가기"
        onNext={onNext}
        nextDisabled={blocked || !allReady}
        note={
          blocked
            ? blockedNote
            : job.state === "running"
              ? job.message || "씬 영상을 만드는 중"
              : allReady
                ? "각 영상을 확인했습니다. 영상 단계에서 하나로 합칩니다."
                : over
                  ? "예상 길이가 45초를 넘습니다. 대본을 줄인 뒤 다시 만들어 주세요."
                  : job.message || "대본에서 씬 영상을 만들면 여기에 붙습니다."
        }
      />
    </>
  )
}

function SceneClipCard({
  index,
  sceneLabels,
  lines,
  productionLabel,
  seconds,
  ready,
  stale,
  busy,
  onRedo,
}: {
  index: number
  sceneLabels: number[]
  lines: string[]
  productionLabel: string
  seconds: number
  ready: boolean
  stale: boolean
  busy: boolean
  onRedo: () => void
}) {
  const span =
    sceneLabels.length === 1
      ? `씬 ${sceneLabels[0]}`
      : `씬 ${sceneLabels[0]}–${sceneLabels[sceneLabels.length - 1]}`

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <Card.Title>
          영상 {index + 1}
          <span className="ml-2 text-sm font-normal text-muted">
            {span} ·{" "}
            {ready ? `${seconds.toFixed(1)}초` : `약 ${formatSeconds(seconds)}`}
          </span>
        </Card.Title>
        <Chip
          size="sm"
          color={ready ? "success" : stale ? "warning" : "default"}
          variant="soft"
        >
          {ready ? "준비됨" : busy ? "만드는 중" : "아직 없음"}
        </Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <Chip size="sm" variant="soft" className="self-start">
          {productionLabel}
        </Chip>
        {ready ? (
          <ClipPreview
            key={`${index}-${seconds}`}
            src={`/api/film/clips/file?id=clip-${String(index + 1).padStart(2, "0")}`}
            label={`영상 ${index + 1}`}
            aspect="3:4"
          />
        ) : (
          <div className="mx-auto flex aspect-[3/4] w-48 items-center justify-center bg-black text-center text-sm whitespace-pre-line text-white/55 ring-1 ring-white/25">
            {"3:4 장면 영상\n(TTS 포함)"}
          </div>
        )}
        <div className="flex flex-col gap-1">
          {lines.map((line) => (
            <p key={line} className="text-sm leading-6">
              {line}
            </p>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          isDisabled={!ready || busy}
          onPress={onRedo}
        >
          이 영상만 다시 만들기
        </Button>
      </Card.Content>
    </Card>
  )
}
