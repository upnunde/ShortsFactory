"use client"

import { useEffect, useMemo, useState } from "react"

import {
  Card,
  Chip,
  Label,
  ListBox,
  Select,
  TextArea,
  TextField,
} from "@heroui/react"
import { StepActions, StepHeader } from "@/components/studio/chrome"
import {
  SCENE_PRODUCTION_LABELS,
  SCENE_PRODUCTION_MODES,
  type SceneProductionMode,
} from "@/lib/scene-production"
import { directionReady } from "@/lib/scene-status"
import type { Project } from "@/lib/types"
import {
  defaultVideoSettings,
  type VideoSettings,
} from "@/lib/video-settings"

type Person = { id: string; name: string; host: boolean; active: boolean }

export function DirectionStep({
  project,
  busy,
  error,
  onBack,
  onMake,
  onPictureChange,
  onProductionModeChange,
  onCastEnter,
}: {
  project: Project
  busy: boolean
  error: string
  onBack: () => void
  onMake: () => void
  onPictureChange: (sceneId: string, value: string) => void
  onProductionModeChange: (
    sceneId: string,
    mode: SceneProductionMode
  ) => void
  onCastEnter: (characterId: string, fromIndex: number | null) => void
}) {
  const [settings, setSettings] = useState(defaultVideoSettings)
  const [people, setPeople] = useState<Person[]>([])

  useEffect(() => {
    void fetch(`/api/video?profileId=${encodeURIComponent(project.profileId)}`)
      .then(async (response) => {
        if (response.ok) setSettings((await response.json()) as VideoSettings)
      })
      .catch(() => undefined)
    void fetch(
      `/api/character?profileId=${encodeURIComponent(project.profileId)}`
    )
      .then(async (response) => {
        if (!response.ok) return
        const body = (await response.json()) as {
          hostId?: string
          outfits?: { id: string; name: string; active: boolean }[]
        }
        const hostId = body.hostId ?? body.outfits?.[0]?.id ?? ""
        setPeople(
          (body.outfits ?? []).map((person) => ({
            ...person,
            host: person.id === hostId,
          }))
        )
      })
      .catch(() => undefined)
  }, [project.profileId])

  const aiScenes = project.scenes.filter(
    (scene) => scene.productionMode === "ai_video"
  )
  const usage = {
    aiSceneCount: aiScenes.length,
    aiSeconds: aiScenes.reduce(
      (sum, scene) =>
        sum + Math.max(4, Math.ceil(project.sceneDurations[scene.id] ?? 0)),
      0
    ),
  }
  const total = Object.values(project.sceneDurations).reduce(
    (sum, value) => sum + value,
    0
  )
  const estimatedCost = usage.aiSeconds * settings.estimatedCostPerSecondUsd
  const issues = useMemo(() => {
    const list: string[] = []
    if (!directionReady(project)) list.push("대본 또는 TTS가 바뀌어 연출을 다시 만들어야 합니다.")
    if (project.scenes.some((scene) => !scene.sceneDescription.trim())) {
      list.push("화면 연출이 비어 있는 씬이 있습니다.")
    }
    if (
      project.scenes.some(
        (scene) => scene.shot === "insert" && scene.castIds.length > 0
      )
    ) {
      list.push("자료 화면에는 캐릭터가 등장할 수 없습니다.")
    }
    if (
      project.scenes.some(
        (scene) =>
          scene.shot === "room" &&
          scene.actionBeats.some(
            (beat) =>
              !scene.scriptTarget
                .toLowerCase()
                .includes(beat.trigger.toLowerCase())
          )
      )
    ) {
      list.push("음성과 맞지 않는 행동 시작 단어가 있습니다.")
    }
    if (
      total < settings.targetDurationSeconds - settings.durationToleranceSeconds ||
      total > settings.targetDurationSeconds + settings.durationToleranceSeconds
    ) {
      list.push("실제 음성 길이가 채널의 허용 범위를 벗어났습니다.")
    }
    if (
      usage.aiSceneCount > settings.maxAiVideoScenes ||
      usage.aiSeconds > settings.maxAiVideoSeconds
    ) {
      list.push("AI 영상 사용량이 채널 상한을 넘었습니다.")
    }
    if (
      settings.maxEstimatedCostUsd > 0 &&
      estimatedCost > settings.maxEstimatedCostUsd
    ) {
      list.push("예상 AI 영상 비용이 채널 상한을 넘었습니다.")
    }
    return list
  }, [estimatedCost, project, settings, total, usage.aiSceneCount, usage.aiSeconds])

  const support = people.filter((person) => !person.host && person.active)
  const roomScenes = project.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.shot === "room")

  return (
    <>
      <StepHeader
        title="화면 연출"
        description="확정된 대본과 실제 TTS 길이를 기준으로 만든 전체 스토리보드입니다. 이 단계에서는 대사를 바꾸지 않습니다."
      />

      <Card>
        <Card.Header className="flex-row items-center justify-between gap-3">
          <div>
            <Card.Title>자동 품질검사</Card.Title>
            <Card.Description>
              음성 길이, 행동 타이밍, 캐릭터 연속성과 제작 비용을 확인합니다.
            </Card.Description>
          </div>
          <Chip color={issues.length === 0 ? "success" : "warning"} variant="soft">
            {issues.length === 0 ? "통과" : `${issues.length}개 확인 필요`}
          </Chip>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="실제 음성" value={`${total.toFixed(1)}초`} />
            <Metric
              label="AI 영상"
              value={`${usage.aiSceneCount}씬 · 약 ${usage.aiSeconds}초`}
            />
            <Metric
              label="예상 비용"
              value={
                settings.estimatedCostPerSecondUsd > 0
                  ? `$${estimatedCost.toFixed(2)}`
                  : "단가 미설정"
              }
            />
          </div>
          {issues.map((issue) => (
            <p key={issue} className="text-warning">• {issue}</p>
          ))}
        </Card.Content>
      </Card>

      {support.length > 0 ? (
        <Card>
          <Card.Header>
            <Card.Title>보조 인물 자동 배치</Card.Title>
            <Card.Description>
              AI가 정한 등장 시점입니다. 필요한 경우에만 수정합니다.
            </Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-3 sm:grid-cols-2">
            {support.map((person) => {
              const from = project.scenes.findIndex(
                (scene) =>
                  scene.shot === "room" && scene.castIds.includes(person.id)
              )
              return (
                <Select
                  key={person.id}
                  aria-label={`${person.name} 등장 시점`}
                  selectedKey={from < 0 ? "none" : String(from)}
                  onSelectionChange={(key) =>
                    key != null &&
                    onCastEnter(
                      person.id,
                      String(key) === "none" ? null : Number(key)
                    )
                  }
                >
                  <Label>{person.name}</Label>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="none" textValue="나오지 않음">나오지 않음</ListBox.Item>
                      {roomScenes.map(({ scene, index }) => (
                        <ListBox.Item key={scene.id} id={String(index)} textValue={`씬 ${index + 1}부터`}>
                          씬 {index + 1}부터
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              )
            })}
          </Card.Content>
        </Card>
      ) : null}

      <div className="flex flex-col gap-4">
        {project.scenes.map((scene, index) => (
          <Card key={scene.id}>
            <Card.Header className="flex-row items-center justify-between gap-3">
              <Card.Title>씬 {index + 1}</Card.Title>
              <div className="flex gap-2">
                <Chip size="sm" variant="soft">
                  {scene.shot === "insert" ? "자료 화면" : "방 장면"}
                </Chip>
                <Chip size="sm" variant="soft">
                  {(project.sceneDurations[scene.id] ?? 0).toFixed(1)}초
                </Chip>
              </div>
            </Card.Header>
            <Card.Content className="flex flex-col gap-4">
              <p className="text-sm leading-6">{scene.scriptTarget}</p>
              <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
                <TextField
                  value={scene.sceneDescription}
                  onChange={(value) => onPictureChange(scene.id, value)}
                  fullWidth
                >
                  <Label>화면 연출</Label>
                  <TextArea rows={3} />
                </TextField>
                <Select
                  aria-label={`씬 ${index + 1} 제작 방식`}
                  selectedKey={scene.productionMode}
                  onSelectionChange={(key) =>
                    key != null &&
                    onProductionModeChange(
                      scene.id,
                      String(key) as SceneProductionMode
                    )
                  }
                >
                  <Label>제작 방식</Label>
                  <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {SCENE_PRODUCTION_MODES.map((mode) => (
                        <ListBox.Item key={mode} id={mode} textValue={SCENE_PRODUCTION_LABELS[mode]}>
                          {SCENE_PRODUCTION_LABELS[mode]}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              {scene.actionBeats.length > 0 ? (
                <p className="text-xs text-muted">
                  행동: {scene.actionBeats.map((beat) => `${beat.trigger} → ${beat.action}`).join(" · ")}
                </p>
              ) : null}
            </Card.Content>
          </Card>
        ))}
      </div>

      {error ? <p className="text-right text-sm text-danger">{error}</p> : null}
      <StepActions
        onBack={onBack}
        nextLabel={busy ? "씬 영상 만드는 중" : "씬 영상 만들기"}
        onNext={onMake}
        nextDisabled={busy || issues.length > 0}
        note={
          issues.length > 0
            ? "품질검사 항목을 해결한 뒤 영상을 만들 수 있습니다."
            : "검사를 통과했습니다. 필요한 장면만 유료 AI 영상을 사용합니다."
        }
      />
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-default/40 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1">{value}</p>
    </div>
  )
}
