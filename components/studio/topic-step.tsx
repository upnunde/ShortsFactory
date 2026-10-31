"use client"

import { useEffect, useState } from "react"

import { Button, Card, Label, ListBox, Select, TextArea, TextField } from "@heroui/react"
import { StepHeader } from "@/components/studio/chrome"
import { getProfile, profiles } from "@/lib/profiles"

export function TopicStep({
  topic,
  profileId,
  onTopicChange,
  onProfileChange,
  onNext,
  busy,
  error,
}: {
  topic: string
  profileId: string
  onTopicChange: (topic: string) => void
  onProfileChange: (profileId: string) => void
  onNext: () => void
  busy: boolean
  error: string
}) {
  const profile = getProfile(profileId)
  const [outfitName, setOutfitName] = useState("")

  useEffect(() => {
    void fetch("/api/character")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { outfits?: { name: string; active: boolean }[] } | null) => {
        const active = body?.outfits?.find((outfit) => outfit.active)
        setOutfitName(active?.name ?? "")
      })
  }, [])

  return (
    <>
      <StepHeader
        title="주제"
        description="한국어로 적습니다. 이 주제가 유튜브와 인스타그램 대표 커버가 됩니다. 대본, 목소리, 자막은 영어로 나갑니다."
      />

      <Card>
        <Card.Header>
          <Card.Title>이번 쇼츠</Card.Title>
          <Card.Description>전체 영상은 1분 미만입니다. 여기에 적은 문장이 대표 커버입니다.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <TextField value={topic} onChange={onTopicChange} fullWidth>
            <Label>주제</Label>
            <TextArea rows={3} placeholder="갑자기 궁금한 내용을 한 줄로" />
          </TextField>
          <Select
            aria-label="채널"
            selectedKey={profileId}
            onSelectionChange={(key) => {
              if (key != null) {
                onProfileChange(String(key))
              }
            }}
          >
            <Label>채널</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {profiles.map((item) => (
                  <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                    {item.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{profile.name}</Card.Title>
          <Card.Description>채널 설정은 config/profiles 에 있습니다.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3 text-sm">
          <p className="text-muted">{profile.image_style_anchor}</p>
          <p>
            음성 {profile.tts_voice_id || "아직 없음"} · LoRA {profile.lora_model || "없음"}
          </p>
          {outfitName ? (
            <p>씬을 만들기 전에 착장을 고릅니다. 고르지 않으면 켜 둔 {outfitName}이 쓰입니다.</p>
          ) : null}
        </Card.Content>
      </Card>

      <div className="flex flex-col items-end gap-2">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button isDisabled={topic.trim() === "" || busy} onPress={onNext}>
          {busy ? "쓰는 중" : "대본 검수"}
        </Button>
      </div>
    </>
  )
}
