"use client"

import { useState } from "react"

import {
  Button,
  Card,
  Input,
  Label,
  ListBox,
  Select,
  TextArea,
  TextField,
} from "@heroui/react"
import { useBgmLibrary } from "@/components/studio/bgm-card"
import type { ChannelProfile } from "@/lib/types"

export function ChannelSettingsCard({
  profile,
  onSaved,
}: {
  profile: ChannelProfile
  onSaved: (profile: ChannelProfile) => void
}) {
  const [draft, setDraft] = useState(profile)
  const [note, setNote] = useState("")
  const bgm = useBgmLibrary()

  async function save() {
    setNote("")
    const response = await fetch("/api/profiles", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    })
    if (!response.ok) {
      setNote("저장하지 못했습니다.")
      return
    }
    const saved = (await response.json()) as ChannelProfile
    setDraft(saved)
    onSaved(saved)
    setNote("이 채널의 기본값을 저장했습니다.")
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>채널 운영 기본값</Card.Title>
        <Card.Description>
          현재 작업실에서 사용할 채널 이름, 말투, 그림 스타일과 기본 배경음악을
          정합니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-5">
        <TextField
          value={draft.name}
          onChange={(name) => setDraft({ ...draft, name })}
        >
          <Label>채널 이름</Label>
          <Input />
        </TextField>

        <Select
          aria-label="채널 기본 배경음악"
          selectedKey={draft.default_bgm_id}
          onSelectionChange={(key) => {
            if (key != null) {
              setDraft({ ...draft, default_bgm_id: String(key) })
            }
          }}
        >
          <Label>기본 배경음악</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {bgm.tracks.map((track) => (
                <ListBox.Item
                  key={track.id}
                  id={track.id}
                  textValue={track.name}
                >
                  {track.name}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <TextField
          value={draft.image_style_anchor}
          onChange={(image_style_anchor) =>
            setDraft({ ...draft, image_style_anchor })
          }
        >
          <Label>그림 스타일 기준</Label>
          <TextArea rows={4} />
        </TextField>

        <TextField
          value={draft.system_prompt}
          onChange={(system_prompt) => setDraft({ ...draft, system_prompt })}
        >
          <Label>기본 말투와 대본 규칙</Label>
          <TextArea rows={6} />
        </TextField>

        <label className="flex flex-col gap-2 text-sm">
          <span>
            배경음악 볼륨 {Math.round(draft.youtube_bgm_volume * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={Math.round(draft.youtube_bgm_volume * 100)}
            onChange={(event) =>
              setDraft({
                ...draft,
                youtube_bgm_volume: Number(event.currentTarget.value) / 100,
              })
            }
            className="accent-foreground"
          />
        </label>

        <div className="flex items-center justify-end gap-3">
          {note ? <p className="text-sm text-muted">{note}</p> : null}
          <Button onPress={() => void save()}>저장</Button>
        </div>
      </Card.Content>
    </Card>
  )
}
