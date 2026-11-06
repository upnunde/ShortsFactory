"use client"

import { useState } from "react"

import { Button, Card, Input, Label, TextField } from "@heroui/react"
import { ArrowLeft } from "lucide-react"
import type { ChannelProfile } from "@/lib/types"

export function ChannelHub({
  profiles,
  onOpen,
  onCreated,
  onBack,
}: {
  profiles: ChannelProfile[]
  onOpen: (profileId: string) => void
  onCreated: (profile: ChannelProfile) => void
  onBack: () => void
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
        <nav className="flex items-center gap-2 text-sm text-muted">
          <Button size="sm" variant="ghost" onPress={onBack}>
            <ArrowLeft className="size-4" /> 제작 모드
          </Button>
          <span aria-hidden="true">/</span>
          <span>캐릭터·AI 생성형</span>
        </nav>
        <div>
          <p className="text-sm text-muted">쇼츠 팩토리</p>
          <h1 className="mt-2 text-3xl font-semibold">
            작업할 채널을 선택하세요
          </h1>
          <p className="mt-2 text-sm text-muted">
            캐릭터 제작 전용 채널만 표시됩니다. 뉴스 채널과 정보·설정·작업
            내역을 공유하지 않습니다.
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
                <Button onPress={() => onOpen(profile.id)}>열기</Button>
              </Card.Footer>
            </Card>
          ))}
        </section>

        <Card>
          <Card.Header>
            <Card.Title>새 채널</Card.Title>
            <Card.Description>
              기본 캐릭터 채널의 설정과 소스를 복사한 뒤 이 모드 안에서만
              관리합니다.
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
