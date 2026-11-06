"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { Button, Card, Chip, Input, Label, TextField } from "@heroui/react"
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react"
import type { CredentialStatus } from "@/lib/server/credentials"

type Provider =
  "claude" | "higgsfield" | "azureSpeech" | "typecast" | "youtubeData"

const EMPTY_STATUS: CredentialStatus = {
  claude: { saved: false },
  higgsfield: { saved: false },
  azureSpeech: { saved: false },
  typecast: { saved: false },
  youtubeData: { saved: false },
}

export function PlatformSettings() {
  const [status, setStatus] = useState<CredentialStatus>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch("/api/settings", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          setStatus((await response.json()) as CredentialStatus)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-svh bg-background px-6 py-12 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <nav>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted transition hover:bg-default hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> 제작 모드
          </Link>
        </nav>

        <header className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-default">
            <KeyRound className="size-5" />
          </div>
          <div>
            <p className="text-sm text-muted">쇼츠 팩토리 공통</p>
            <h1 className="mt-1 text-3xl font-semibold">플랫폼 API 설정</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              이곳에 등록한 API는 캐릭터 쇼츠와 뉴스 쇼츠의 모든 채널에서
              공통으로 사용합니다. 채널 정보, 작업 데이터와 업로드 계정은 각
              쇼츠 모드에 그대로 분리됩니다.
            </p>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-2">
          <CredentialCard
            provider="claude"
            title="Claude"
            description="대본 작성, 번역, 뉴스 분석과 문장별 화면 연출에 사용합니다."
            placeholder="sk-ant-..."
            saved={status.claude.saved}
            loading={loading}
            onStatus={setStatus}
          />
          <CredentialCard
            provider="higgsfield"
            title="Higgsfield"
            description="캐릭터 쇼츠의 생성 영상과 이미지 제작에 사용합니다."
            placeholder="API key"
            saved={status.higgsfield.saved}
            loading={loading}
            onStatus={setStatus}
          />
          <CredentialCard
            provider="typecast"
            title="Typecast TTS · 선택 사항"
            description="등록하면 뉴스 TTS에 Typecast를 사용합니다. 등록하지 않으면 무료 한국어 MMS가 자동으로 사용됩니다."
            placeholder="Typecast API key"
            saved={status.typecast.saved}
            loading={loading}
            onStatus={setStatus}
          />
          <CredentialCard
            provider="youtubeData"
            title="YouTube Data API"
            description="등록한 뉴스 채널에서 최근 원본 영상 후보를 검색합니다."
            placeholder="AIza..."
            saved={status.youtubeData.saved}
            loading={loading}
            onStatus={setStatus}
          />
        </section>

        <div className="flex items-start gap-3 rounded-xl border border-separator bg-surface p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <p className="text-sm leading-6 text-muted">
            저장된 키 값은 브라우저로 다시 보내지 않고 연결 여부만 표시합니다.
            유튜브 업로드 로그인은 API 키와 성격이 다르므로 각 채널의 계정 연결
            메뉴에서 별도로 관리합니다.
          </p>
        </div>
      </div>
    </main>
  )
}

function CredentialCard({
  provider,
  title,
  description,
  placeholder,
  saved,
  loading,
  region = false,
  onStatus,
}: {
  provider: Provider
  title: string
  description: string
  placeholder: string
  saved: boolean
  loading: boolean
  region?: boolean
  onStatus: (status: CredentialStatus) => void
}) {
  const [apiKey, setApiKey] = useState("")
  const [azureRegion, setAzureRegion] = useState("koreacentral")
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState("")
  const [failed, setFailed] = useState(false)

  async function save() {
    setPending(true)
    setNote("")
    setFailed(false)
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey,
          ...(region ? { region: azureRegion } : {}),
        }),
      })
      const body = (await response.json()) as CredentialStatus & {
        message?: string
      }
      if (!response.ok) {
        setFailed(true)
        setNote(
          body.message ||
            "연결 정보를 확인하지 못했습니다. 저장하지 않았습니다."
        )
        return
      }
      onStatus(body)
      setApiKey("")
      setNote("연결을 확인하고 공통 설정에 저장했습니다.")
    } catch {
      setFailed(true)
      setNote("연결 정보를 확인하지 못했습니다. 저장하지 않았습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="min-h-72">
      <Card.Header className="flex-row items-start justify-between gap-4">
        <div>
          <Card.Title>{title}</Card.Title>
          <Card.Description className="mt-2 leading-5">
            {description}
          </Card.Description>
        </div>
        <Chip
          size="sm"
          color={saved ? "success" : "warning"}
          variant="soft"
          className="shrink-0"
        >
          {loading ? "확인 중" : saved ? "연결됨" : "미연결"}
        </Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {region ? (
          <TextField value={azureRegion} onChange={setAzureRegion} fullWidth>
            <Label>Azure 리전</Label>
            <Input placeholder="예: koreacentral" />
          </TextField>
        ) : null}
        <div className="flex items-end gap-2">
          <TextField value={apiKey} onChange={setApiKey} fullWidth>
            <Label>API 키</Label>
            <Input
              type={visible ? "text" : "password"}
              placeholder={placeholder}
              autoComplete="off"
            />
          </TextField>
          <Button
            variant="outline"
            className="shrink-0"
            onPress={() => setVisible((current) => !current)}
          >
            {visible ? "숨기기" : "보기"}
          </Button>
        </div>
      </Card.Content>
      <Card.Footer className="flex-col items-end gap-2">
        <Button
          isDisabled={
            pending ||
            apiKey.trim() === "" ||
            (region && azureRegion.trim() === "")
          }
          onPress={() => void save()}
        >
          {pending ? "연결 확인 중" : saved ? "키 변경" : "연결하고 저장"}
        </Button>
        {note ? (
          <p
            className={`text-right text-xs leading-5 ${failed ? "text-danger" : "text-muted"}`}
          >
            {note}
          </p>
        ) : null}
      </Card.Footer>
    </Card>
  )
}
