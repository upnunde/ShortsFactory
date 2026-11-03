"use client"

import { useEffect, useRef, useState } from "react"

import { Card, Label, ListBox, Select } from "@heroui/react"
import {
  defaultVideoSettings,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
  type VideoSettings,
} from "@/lib/video-settings"

export function VideoSettingsCard({ profileId }: { profileId: string }) {
  const [settings, setSettings] = useState(defaultVideoSettings)
  const [note, setNote] = useState("")
  const settingsRef = useRef(settings)

  useEffect(() => {
    void fetch(`/api/video?profileId=${encodeURIComponent(profileId)}`)
      .then(async (response) => {
        if (!response.ok) return
        const saved = (await response.json()) as VideoSettings
        settingsRef.current = saved
        setSettings(saved)
      })
      .catch(() => undefined)
  }, [profileId])

  function update(patch: Partial<VideoSettings>) {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    return next
  }

  async function save(next: VideoSettings) {
    setNote("")
    const response = await fetch(
      `/api/video?profileId=${encodeURIComponent(profileId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      }
    )
    if (response.ok) {
      const saved = (await response.json()) as VideoSettings
      settingsRef.current = saved
      setSettings(saved)
      setNote("저장했습니다.")
    } else {
      setNote("저장하지 못했습니다.")
    }
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>장면 영상 생성</Card.Title>
        <Card.Description>
          Seedance는 필요한 씬만 무자막 3:4 영상으로 만듭니다. 나머지는 로컬
          2D 모션으로 만들고 제목, 자막, 음성, 배경음악은 마지막에 합칩니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-5">
        <Select
          aria-label="영상 모델"
          selectedKey={settings.model}
          onSelectionChange={(key) => {
            if (key != null) {
              void save(
                update({ model: String(key) as VideoSettings["model"] })
              )
            }
          }}
        >
          <Label>영상 모델</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {VIDEO_MODELS.map((model) => (
                <ListBox.Item
                  key={model.id}
                  id={model.id}
                  textValue={model.label}
                >
                  {model.label}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Select
          aria-label="장면 생성 해상도"
          selectedKey={settings.resolution}
          onSelectionChange={(key) => {
            if (key != null) {
              void save(
                update({
                  resolution: String(key) as VideoSettings["resolution"],
                })
              )
            }
          }}
        >
          <Label>장면 생성 해상도</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {VIDEO_RESOLUTIONS.map((resolution) => (
                <ListBox.Item
                  key={resolution}
                  id={resolution}
                  textValue={resolution}
                >
                  {resolution}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="초당 예상 단가 (USD)"
            value={settings.estimatedCostPerSecondUsd}
            onSave={(value) =>
              void save(update({ estimatedCostPerSecondUsd: value }))
            }
          />
          <NumberField
            label="영상 1개 비용 상한 (USD)"
            value={settings.maxEstimatedCostUsd}
            onSave={(value) =>
              void save(update({ maxEstimatedCostUsd: value }))
            }
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="목표 영상 길이 (초)"
            value={settings.targetDurationSeconds}
            min={20}
            max={60}
            step={1}
            onSave={(value) =>
              void save(update({ targetDurationSeconds: value }))
            }
          />
          <NumberField
            label="길이 허용 오차 (±초)"
            value={settings.durationToleranceSeconds}
            min={0}
            max={15}
            step={1}
            onSave={(value) =>
              void save(update({ durationToleranceSeconds: value }))
            }
          />
          <NumberField
            label="AI 영상 최대 합계 (초)"
            value={settings.maxAiVideoSeconds}
            min={0}
            max={30}
            step={1}
            onSave={(value) =>
              void save(update({ maxAiVideoSeconds: value }))
            }
          />
          <NumberField
            label="AI 영상 최대 씬 수"
            value={settings.maxAiVideoScenes}
            min={0}
            max={8}
            step={1}
            onSave={(value) =>
              void save(update({ maxAiVideoScenes: value }))
            }
          />
          <NumberField
            label="씬별 재시도 횟수"
            value={settings.maxRetriesPerScene}
            min={0}
            max={5}
            step={1}
            onSave={(value) =>
              void save(update({ maxRetriesPerScene: value }))
            }
          />
        </div>
        <p className="text-sm text-muted">
          기본값은 40±5초, AI 영상 2~3씬·총 12초 이하입니다. 비율은 3:4로
          고정되며 초당 단가와 비용 상한을 입력하면 AI 영상 요청만 계산해
          상한을 넘기기 전에 중단합니다.
        </p>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </Card.Content>
    </Card>
  )
}

function NumberField({
  label,
  value,
  onSave,
  min = 0,
  max = 1000,
  step = 0.0001,
}: {
  label: string
  value: number
  onSave: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span>{label}</span>
      <input
        key={`${label}-${value}`}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onBlur={(event) =>
          onSave(
            Math.min(max, Math.max(min, Number(event.currentTarget.value) || 0))
          )
        }
        className="h-10 rounded-lg border border-separator bg-transparent px-3 outline-none focus:border-foreground"
      />
    </label>
  )
}
