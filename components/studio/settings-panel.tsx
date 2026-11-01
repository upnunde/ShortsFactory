"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Tabs,
  TextField,
} from "@heroui/react"
import { AccountsPanel } from "@/components/studio/accounts-panel"
import { CharacterPanel } from "@/components/studio/character-panel"
import type { AccountPlatform, AccountStatus } from "@/lib/server/accounts"
import { BgmSettingsCard } from "@/components/studio/bgm-card"
import { FrameLayoutCard } from "@/components/studio/frame-layout-card"
import { WritingGuideCard } from "@/components/studio/writing-guide-card"
import { VoiceCard } from "@/components/studio/voice-card"
import { StepHeader } from "@/components/studio/chrome"

type Status = {
  claude: { saved: boolean }
  higgsfield: { saved: boolean }
}

const EMPTY: Status = {
  claude: { saved: false },
  higgsfield: { saved: false },
}

export function SettingsPanel({
  initialTab = "frame",
  accountNotice = null,
  initialAccounts,
}: {
  initialTab?: "character" | "frame" | "keys" | "accounts"
  accountNotice?: { kind: "connected" | "error"; platform: string } | null
  initialAccounts: Record<AccountPlatform, AccountStatus>
}) {
  const [status, setStatus] = useState(EMPTY)

  useEffect(() => {
    void refresh(setStatus)
  }, [])

  return (
    <>
      <StepHeader
        title="설정"
        description="캐릭터, 목소리와 배경음악, API 키, 계정 연결을 나눠 둡니다."
      />
      <Tabs defaultSelectedKey={initialTab}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="설정 구분">
            <Tabs.Tab id="character">
              캐릭터
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="frame">
              영상 설정
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="keys">
              API 키 설정
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="accounts">
              계정 연결
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="character" className="flex flex-col gap-6">
          <CharacterPanel />
        </Tabs.Panel>
        <Tabs.Panel id="frame" className="flex flex-col gap-6">
          <WritingGuideCard />
          <VoiceCard />
          <BgmSettingsCard />
          <FrameLayoutCard />
        </Tabs.Panel>
        <Tabs.Panel id="keys" className="flex flex-col gap-6">
          <ClaudeCard
            saved={status.claude.saved}
            onSaved={() => refresh(setStatus)}
          />
          <HiggsfieldCard
            saved={status.higgsfield.saved}
            onSaved={() => refresh(setStatus)}
          />
        </Tabs.Panel>
        <Tabs.Panel id="accounts" className="flex flex-col gap-6">
          <AccountsPanel
            notice={accountNotice}
            initialStatus={initialAccounts}
          />
        </Tabs.Panel>
      </Tabs>
    </>
  )
}

function ClaudeCard({
  saved,
  onSaved,
}: {
  saved: boolean
  onSaved: () => Promise<void>
}) {
  const [apiKey, setApiKey] = useState("")
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState("")
  const [failed, setFailed] = useState(false)

  async function save() {
    setPending(true)
    setNote("")
    const result = await postSettings({ provider: "claude", apiKey })
    setPending(false)
    setFailed(!result.ok)
    setNote(result.message)
    if (result.ok) {
      setApiKey("")
      await onSaved()
    }
  }

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <Card.Title>클로드</Card.Title>
        <SavedChip saved={saved} />
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          대본을 쓰고 영어로 맞출 때 씁니다. Console에서 만든 API 키를 넣습니다.
        </p>
        <SecretField
          label="API 키"
          value={apiKey}
          onChange={setApiKey}
          placeholder="sk-ant-..."
        />
        <SaveRow
          pending={pending}
          disabled={apiKey.trim() === ""}
          note={note}
          failed={failed}
          onSave={save}
        />
      </Card.Content>
    </Card>
  )
}

function HiggsfieldCard({
  saved,
  onSaved,
}: {
  saved: boolean
  onSaved: () => Promise<void>
}) {
  const [apiKey, setApiKey] = useState("")
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState("")
  const [failed, setFailed] = useState(false)

  async function save() {
    setPending(true)
    setNote("")
    const result = await postSettings({ provider: "higgsfield", apiKey })
    setPending(false)
    setFailed(!result.ok)
    setNote(result.message)
    if (result.ok) {
      setApiKey("")
      await onSaved()
    }
  }

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <Card.Title>힉스필드</Card.Title>
        <SavedChip saved={saved} />
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          영상과 인물 각도에 씁니다. Copy API key로 복사한 값을 넣습니다.
        </p>
        <SecretField label="API Key" value={apiKey} onChange={setApiKey} />
        <SaveRow
          pending={pending}
          disabled={apiKey.trim() === ""}
          note={note}
          failed={failed}
          onSave={save}
        />
      </Card.Content>
    </Card>
  )
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex items-end gap-2">
      <TextField value={value} onChange={onChange} fullWidth>
        <Label>{label}</Label>
        <Input type={visible ? "text" : "password"} placeholder={placeholder} />
      </TextField>
      <Button
        variant="outline"
        onPress={() => setVisible((current) => !current)}
      >
        {visible ? "숨기기" : "보기"}
      </Button>
    </div>
  )
}

function SavedChip({ saved }: { saved: boolean }) {
  return (
    <Chip size="sm" color={saved ? "success" : "warning"} variant="soft">
      {saved ? "저장됨" : "없음"}
    </Chip>
  )
}

function SaveRow({
  pending,
  disabled,
  note,
  failed,
  onSave,
}: {
  pending: boolean
  disabled: boolean
  note: string
  failed: boolean
  onSave: () => void
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <Button isDisabled={pending || disabled} onPress={onSave}>
        {pending ? "저장 중" : "저장"}
      </Button>
      {note ? (
        <p className={failed ? "text-sm text-danger" : "text-sm text-muted"}>
          {note}
        </p>
      ) : null}
    </div>
  )
}

async function refresh(setStatus: (status: Status) => void) {
  const response = await fetch("/api/settings")
  if (response.ok) {
    setStatus((await response.json()) as Status)
  }
}

async function postSettings(body: {
  provider: "claude" | "higgsfield"
  apiKey: string
}) {
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const payload = (await response.json()) as { message?: string }
    if (!response.ok) {
      return {
        ok: false,
        message:
          payload.message || "키를 확인하지 못했습니다. 저장하지 않았습니다.",
      }
    }
    return { ok: true, message: "저장했습니다." }
  } catch {
    return {
      ok: false,
      message: "키를 확인하지 못했습니다. 저장하지 않았습니다.",
    }
  }
}
