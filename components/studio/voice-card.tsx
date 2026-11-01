"use client"

import { useEffect, useState } from "react"

import { Card, Label, ListBox, Select } from "@heroui/react"
import { DEFAULT_VOICE_ID, KOKORO_VOICES, voiceById } from "@/lib/voices"

export function VoiceCard() {
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [note, setNote] = useState("")

  useEffect(() => {
    void fetch("/api/voice")
      .then(async (response) => {
        if (!response.ok) {
          return
        }
        const body = (await response.json()) as { id?: string }
        if (body.id) {
          setVoiceId(voiceById(body.id).id)
        }
      })
      .catch(() => undefined)
  }, [])

  async function save(id: string) {
    const next = voiceById(id).id
    setVoiceId(next)
    setNote("")
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: next }),
    })
    setNote(response.ok ? "목소리를 등록했습니다." : "목소리를 저장하지 못했습니다.")
  }

  const selected = voiceById(voiceId)

  return (
    <Card>
      <Card.Header>
        <Card.Title>목소리</Card.Title>
        <Card.Description>
          영상을 만들 때 쓸 목소리를 등록합니다. 기본은 마이클입니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <Select
          aria-label="목소리"
          selectedKey={selected.id}
          onSelectionChange={(key) => {
            if (key != null) {
              void save(String(key))
            }
          }}
        >
          <Label>등록된 목소리</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {KOKORO_VOICES.map((voice) => (
                <ListBox.Item
                  key={voice.id}
                  id={voice.id}
                  textValue={`${voice.label} ${voice.detail}`}
                >
                  {voice.label} · {voice.detail}
                  {voice.id === DEFAULT_VOICE_ID ? " · 기본" : ""}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </Card.Content>
    </Card>
  )
}
