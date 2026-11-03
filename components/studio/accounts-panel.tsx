"use client"

import { useCallback, useEffect, useState } from "react"

import { Button, Card, Chip, Input, Label, TextField } from "@heroui/react"
import type { AccountPlatform, AccountStatus } from "@/lib/server/accounts"

const PLATFORMS: {
  id: AccountPlatform
  title: string
  consoleUrl: string
  consoleLabel: string
  hint: string
  idLabel: string
}[] = [
  {
    id: "youtube",
    title: "유튜브",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    consoleLabel: "Google Cloud 사용자 인증 정보",
    hint: "OAuth 클라이언트를 만들고 아래 주소를 리디렉션 URI에 넣습니다. 영어 자막을 올리려면 로그인 범위에 자막 권한이 필요합니다. 예전에 연결했다면 다시 로그인합니다.",
    idLabel: "클라이언트 ID",
  },
  {
    id: "instagram",
    title: "인스타그램",
    consoleUrl: "https://developers.facebook.com/apps/",
    consoleLabel: "Meta 개발자 앱",
    hint: "Facebook 로그인에 아래 주소를 넣고, 인스타그램 프로페셔널 계정으로 로그인합니다.",
    idLabel: "앱 ID",
  },
  {
    id: "tiktok",
    title: "틱톡",
    consoleUrl: "https://developers.tiktok.com/apps",
    consoleLabel: "TikTok 개발자 앱",
    hint: "Login Kit와 Content Posting API에 아래 주소를 넣습니다.",
    idLabel: "클라이언트 키",
  },
]

const EMPTY: Record<AccountPlatform, AccountStatus> = {
  youtube: { hasApp: false, connected: false, accountName: null },
  instagram: { hasApp: false, connected: false, accountName: null },
  tiktok: { hasApp: false, connected: false, accountName: null },
}

export function AccountsPanel({
  notice,
  initialStatus = EMPTY,
  profileId,
}: {
  notice: { kind: "connected" | "error"; platform: string } | null
  initialStatus?: Record<AccountPlatform, AccountStatus>
  profileId: string
}) {
  const [status, setStatus] = useState(initialStatus)
  const [origin, setOrigin] = useState("")

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/accounts?profileId=${encodeURIComponent(profileId)}`
    )
    if (response.ok) {
      setStatus((await response.json()) as typeof EMPTY)
    }
  }, [profileId])

  useEffect(() => {
    void Promise.resolve(window.location.origin).then(setOrigin)
    void Promise.resolve().then(refresh)
  }, [refresh])

  return (
    <>
      <p className="text-sm text-muted">
        유튜브, 인스타그램, 틱톡 로그인은 여기서 합니다. 비밀키는 이 컴퓨터에만
        저장됩니다.
      </p>
      {notice ? (
        <p className="text-sm text-muted">{noticeText(notice)}</p>
      ) : null}
      {PLATFORMS.map((platform) => (
        <AccountCard
          key={platform.id}
          platform={platform}
          status={status[platform.id]}
          origin={origin}
          profileId={profileId}
          onChanged={refresh}
        />
      ))}
    </>
  )
}

function AccountCard({
  platform,
  status,
  origin,
  profileId,
  onChanged,
}: {
  platform: (typeof PLATFORMS)[number]
  status: AccountStatus
  origin: string
  profileId: string
  onChanged: () => Promise<void>
}) {
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [pending, setPending] = useState(false)
  const callback = origin
    ? `${origin}/api/accounts/${platform.id}/callback`
    : `/api/accounts/${platform.id}/callback`

  async function connect() {
    setPending(true)
    if (!status.hasApp) {
      const response = await fetch(
        `/api/accounts/${platform.id}/app?profileId=${encodeURIComponent(profileId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, clientSecret }),
        }
      )
      if (!response.ok) {
        setPending(false)
        return
      }
    }
    // OAuth starts through an internal route and then leaves the application.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/accounts/${platform.id}/start?profileId=${encodeURIComponent(profileId)}`
  }

  async function disconnect() {
    setPending(true)
    await fetch(
      `/api/accounts/${platform.id}?profileId=${encodeURIComponent(profileId)}`,
      { method: "DELETE" }
    )
    setPending(false)
    await onChanged()
  }

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <Card.Title>{platform.title}</Card.Title>
        <Chip
          size="sm"
          color={status.connected ? "success" : "warning"}
          variant="soft"
        >
          {status.connected ? status.accountName || "연결됨" : "연결 안 됨"}
        </Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {status.connected
            ? "이 컴퓨터에 로그인되어 있습니다."
            : platform.hint}
        </p>
        <p className="text-sm">
          <a
            className="underline"
            href={platform.consoleUrl}
            target="_blank"
            rel="noreferrer"
          >
            {platform.consoleLabel}
          </a>
        </p>
        <p className="text-sm break-all text-muted">리디렉션 주소 {callback}</p>
        {status.hasApp ? null : (
          <>
            <TextField value={clientId} onChange={setClientId} fullWidth>
              <Label>{platform.idLabel}</Label>
              <Input />
            </TextField>
            <TextField
              value={clientSecret}
              onChange={setClientSecret}
              fullWidth
            >
              <Label>시크릿</Label>
              <Input type="password" />
            </TextField>
          </>
        )}
        <div className="flex gap-2">
          {status.connected ? (
            <Button variant="outline" isDisabled={pending} onPress={disconnect}>
              연결 해제
            </Button>
          ) : (
            <Button
              isDisabled={
                pending ||
                (!status.hasApp &&
                  (clientId.trim() === "" || clientSecret.trim() === ""))
              }
              onPress={connect}
            >
              로그인
            </Button>
          )}
        </div>
      </Card.Content>
    </Card>
  )
}

function noticeText(notice: { kind: "connected" | "error"; platform: string }) {
  const name =
    notice.platform === "youtube"
      ? "유튜브"
      : notice.platform === "instagram"
        ? "인스타그램"
        : "틱톡"
  if (notice.kind === "connected") {
    return `${name}에 로그인했습니다.`
  }
  return `${name} 로그인에 실패했습니다. 리디렉션 주소와 앱 키를 확인한 뒤 다시 누르세요.`
}
