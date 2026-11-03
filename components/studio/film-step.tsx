"use client"

import { useEffect, useState } from "react"

import { Button, Card, Chip } from "@heroui/react"
import { ClipPreview } from "@/components/studio/clip-preview"
import { SequencePreview } from "@/components/studio/sequence-preview"
import { ShortsFrame } from "@/components/studio/shorts-frame"
import { StepHeader } from "@/components/studio/chrome"
import { videoGroups } from "@/lib/film-groups"
import { defaultFrameLayout, type FrameLayout } from "@/lib/frame-layout"
import { filmSignature, projectSeconds } from "@/lib/scene-status"
import { formatSeconds } from "@/lib/timing"
import type { Project } from "@/lib/types"

type ClipJob = {
  state: "idle" | "running" | "done" | "error"
  signature: string
  groups: { id: string; ready: boolean }[]
}

type FilmStatus = {
  state: "idle" | "running" | "done" | "error"
  message: string
  fileReady: boolean
  signature: string
}

export function FilmStep({
  project,
  note,
  onAssemble,
  onReady,
}: {
  project: Project
  note: string
  onAssemble: () => void
  onReady: () => void
}) {
  const seconds = projectSeconds(project.scenes)
  const expected = filmSignature(project)
  const [status, setStatus] = useState<FilmStatus>({
    state: "idle",
    message: "",
    fileReady: false,
    signature: "",
  })
  const [layout, setLayout] = useState<FrameLayout>(defaultFrameLayout)
  const [clips, setClips] = useState<ClipJob>({
    state: "idle",
    signature: "",
    groups: [],
  })

  useEffect(() => {
    void fetch("/api/layout")
      .then(async (response) => {
        if (response.ok) {
          setLayout((await response.json()) as FrameLayout)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let stop = false
    async function loadClips() {
      try {
        const response = await fetch(
          `/api/film/clips?signature=${encodeURIComponent(expected)}`
        )
        const body = (await response.json()) as ClipJob
        if (!stop) {
          setClips(body)
        }
      } catch {
        if (!stop) {
          setClips((current) => ({ ...current, state: "error" }))
        }
      }
    }
    void loadClips()
    const timer = window.setInterval(() => void loadClips(), 3000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [expected])

  useEffect(() => {
    let stop = false
    async function load() {
      try {
        const response = await fetch("/api/film")
        const body = (await response.json()) as FilmStatus
        if (stop) {
          return
        }
        setStatus(body)
        if (body.fileReady && body.signature === expected) {
          onReady()
        }
      } catch {
        if (!stop) {
          setStatus({
            state: "error",
            message: "영상 상태를 읽지 못했습니다.",
            fileReady: false,
            signature: "",
          })
        }
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 4000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [expected, onReady])

  const saved =
    project.finalSignature !== "" && project.finalSignature === expected
  const fileReady = saved || (status.fileReady && status.signature === expected)
  const groups = videoGroups(
    project.scenes.map((scene) => ({
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
  const readyGroups = clips.signature === expected ? clips.groups : []
  const clipsReady =
    groups.length > 0 &&
    groups.every(
      (group) => readyGroups.find((item) => item.id === group.id)?.ready
    )
  const previewClips = groups.map((group) => ({
    src: `/api/film/clips/file?id=${group.id}`,
    parts: project.scenes
      .filter((scene) => group.sceneIds.includes(scene.id))
      .map((scene) => ({
        subtitle: scene.subtitle.trim() || scene.scriptTarget,
        script: scene.scriptTarget,
      })),
  }))

  return (
    <>
      <StepHeader
        title="영상"
        description="확인한 Seedance 장면과 로컬 2D 모션을 하나의 9:16 쇼츠로 합칩니다. 합친 결과가 맞으면 업로드로 넘어갑니다."
      />

      <Card>
        <Card.Header className="flex-row items-center justify-between gap-3">
          <div>
            <Card.Title>이 작업의 영상</Card.Title>
            <Card.Description>
              9:16 · {layout.outputSize.replace("x", " × ")} · 약{" "}
              {formatSeconds(seconds)}
            </Card.Description>
          </div>
          <Chip
            size="sm"
            color={
              fileReady
                ? "success"
                : status.state === "error"
                  ? "danger"
                  : "warning"
            }
            variant="soft"
          >
            {fileReady
              ? "합쳐짐"
              : status.state === "running"
                ? "만드는 중"
                : "아직 없음"}
          </Chip>
        </Card.Header>
        <Card.Content className="flex flex-col items-center gap-4">
          {fileReady ? (
            <ClipPreview
              key={project.historyId || status.message}
              src={
                project.historyId
                  ? `/api/history/${encodeURIComponent(project.historyId)}/file`
                  : "/api/film/file"
              }
              label="합친 영상"
            />
          ) : clipsReady ? (
            <SequencePreview
              title={project.topicEn}
              layout={layout}
              clips={previewClips}
            />
          ) : (
            <ShortsFrame
              title={project.topicEn}
              subtitle=""
              layout={layout}
              className="w-48"
            />
          )}
        </Card.Content>
      </Card>

      <div className="flex flex-col items-end gap-2">
        {note ? <p className="text-sm text-danger">{note}</p> : null}
        <Button
          isDisabled={status.state === "running" || !clipsReady}
          onPress={onAssemble}
        >
          {status.state === "running" ? "합치는 중" : "하나로 합치기"}
        </Button>
      </div>
    </>
  )
}
