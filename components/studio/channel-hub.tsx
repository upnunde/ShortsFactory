"use client"

import { useState } from "react"

import { Button, Card, Input, Label, TextField } from "@heroui/react"
import type { ChannelProfile } from "@/lib/types"

export function ChannelHub({
  profiles,
  onOpen,
  onCreated,
}: {
  profiles: ChannelProfile[]
  onOpen: (profileId: string) => void
  onCreated: (profile: ChannelProfile) => void
}) {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState("")

  async function create() {
    setPending(true)
    setNote("")
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        setNote("채널을 만들지 못했습니다.")
        return
      }
      const profile = (await response.json()) as ChannelProfile
      setName("")
      onCreated(profile)
    } catch {
      setNote("채널을 만들지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="min-h-svh bg-background px-6 py-12 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div>
          <p className="text-sm text-muted">쇼츠 팩토리</p>
          <h1 className="mt-2 text-3xl font-semibold">
            작업할 채널을 선택하세요
          </h1>
          <p className="mt-2 text-sm text-muted">
            채널마다 캐릭터, 말투, TTS, 배경음악, 영상 폼과 업로드 계정을 따로
            관리합니다.
          </p>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          {profiles.map((profile) => (
            <Card key={profile.id}>
              <Card.Header>
                <Card.Title>{profile.name}</Card.Title>
                <Card.Description>
                  {profile.language.toUpperCase()} · {profile.id}
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <p className="line-clamp-2 text-sm text-muted">
                  {profile.image_style_anchor}
                </p>
              </Card.Content>
              <Card.Footer className="justify-end">
                <Button onPress={() => onOpen(profile.id)}>
                  이 채널 작업실 열기
                </Button>
              </Card.Footer>
            </Card>
          ))}
        </section>

        <Card>
          <Card.Header>
            <Card.Title>새 채널</Card.Title>
            <Card.Description>
              기본 채널의 설정과 캐릭터 소스를 복사한 뒤 독립적으로 관리합니다.
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex items-end gap-3">
            <TextField value={name} onChange={setName} fullWidth>
              <Label>채널 이름</Label>
              <Input placeholder="예: 과학 잡지식" />
            </TextField>
            <Button
              isDisabled={pending || !name.trim()}
              onPress={() => void create()}
            >
              채널 만들기
            </Button>
          </Card.Content>
          {note ? (
            <Card.Footer>
              <p className="text-sm text-muted">{note}</p>
            </Card.Footer>
          ) : null}
        </Card>
      </div>
    </main>
  )
}
