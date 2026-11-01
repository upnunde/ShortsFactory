"use client"

import { useState, type ReactNode } from "react"

import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  Switch,
  TextArea,
  TextField,
} from "@heroui/react"
import { useBgmLibrary } from "@/components/studio/bgm-card"
import { StepHeader } from "@/components/studio/chrome"
import { filmReady } from "@/lib/scene-status"
import { buildCoverPrompt } from "@/lib/style"
import {
  inKoreaUploadWindow,
  scheduleForUpload,
} from "@/lib/youtube-metadata"
import type { Project, SocialPost, YoutubeMeta } from "@/lib/types"

export function UploadStep({
  project,
  coverAnchor,
  youtubeCredentials,
  youtubeBgm,
  instagramCredentials,
  tiktokCredentials,
  onYoutubeChange,
  onInstagramChange,
  onTiktokChange,
  onScheduledAt,
  onAutoUpload,
  onBack,
}: {
  project: Project
  coverAnchor: string
  youtubeCredentials: string
  youtubeBgm: { track: string; artist: string; volume: number }
  instagramCredentials: string
  tiktokCredentials: string
  onYoutubeChange: (youtube: YoutubeMeta) => void
  onInstagramChange: (instagram: SocialPost) => void
  onTiktokChange: (tiktok: SocialPost) => void
  onScheduledAt: (scheduledAt: string) => void
  onAutoUpload: (autoUpload: boolean) => void
  onBack: () => void
}) {
  const ready = filmReady(project)
  const bgmLibrary = useBgmLibrary()
  const bgmName =
    bgmLibrary.tracks.find((track) => track.id === project.bgmId)?.name ??
    bgmLibrary.tracks.find((track) => track.id === bgmLibrary.defaultId)
      ?.name ??
    "Stella Princess Waltz"
  const [uploading, setUploading] = useState(false)
  const [uploadNote, setUploadNote] = useState("")
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const targets = project.youtube.enabled ? 1 : 0
  const topic = project.topic.trim()
  const inWindow = inKoreaUploadWindow(project.scheduledAt)
  const uploadAt = scheduleForUpload(project.scheduledAt)

  async function uploadYoutube() {
    setUploading(true)
    setUploadNote("")
    setYoutubeUrl("")
    try {
      const response = await fetch("/api/upload/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          historyId: project.historyId,
          title: project.youtube.title,
          description: project.youtube.description,
          tags: project.youtube.tags,
          scheduledAt: project.scheduledAt,
        }),
      })
      const body = (await response.json()) as { message?: string; url?: string }
      if (!response.ok || !body.url) {
        setUploadNote(body.message || "유튜브에 업로드하지 못했습니다.")
        return
      }
      setYoutubeUrl(body.url)
      setUploadNote("유튜브에 비공개 예약 업로드했습니다.")
    } catch {
      setUploadNote("유튜브에 업로드하지 못했습니다.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <StepHeader
        title="업로드"
        description="만든 영상을 올립니다. 유튜브는 예약 업로드하고, 인스타그램과 틱톡은 게시 문구만 준비합니다."
      />

      <Card>
        <Card.Header className="flex-row items-center justify-between gap-3">
          <Card.Title>공개 시각</Card.Title>
          <Chip size="sm" color={ready ? "success" : "warning"} variant="soft">
            {ready ? "영상 준비됨" : "영상 없음"}
          </Chip>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <TextField
            value={project.scheduledAt}
            onChange={onScheduledAt}
            fullWidth
          >
            <Label>공개 시각</Label>
            <Input type="datetime-local" />
          </TextField>
          <Switch isSelected={project.autoUpload} onChange={onAutoUpload}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              영상을 만들면 유튜브에 자동으로 예약 업로드
            </Switch.Content>
          </Switch>
          <p className="text-sm text-muted">
            유튜브는 비공개로 올린 뒤 이 시각에 공개합니다. 미국 동부 저녁과
            서부 오후가 겹치는 한국 시간은 오전 6시–9시입니다. 서머타임이 없는
            겨울에는 그 겹침이 한 시간 늦습니다. 권장 공개 시각은 오전
            7시입니다.
            {inWindow && uploadAt === project.scheduledAt
              ? ""
              : ` 이 시각은 권장 시간 밖이거나 이미 지났습니다. 유튜브 예약에는 ${uploadAt.replace("T", " ")}를 넣습니다.`}{" "}
            인스타그램과 틱톡은 예약 시각을 받지 않아서, 이 시각에 앱이 직접
            올립니다.
            {project.autoUpload
              ? ` 자동 업로드 대상은 유튜브 ${targets}곳입니다.`
              : " 자동 업로드가 꺼져 있으면 업로드 버튼을 누를 때만 보냅니다."}
          </p>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>대표 커버</Card.Title>
          <Card.Description>
            처음 적은 주제가 그대로 커버입니다. 유튜브 썸네일과 인스타그램 릴스
            커버에 같은 이미지를 씁니다.
          </Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4 md:flex-row">
          <div className="flex aspect-[9/16] w-full max-w-40 shrink-0 items-end rounded-lg bg-surface-secondary p-3">
            <p className="text-sm font-medium">
              {topic || "주제를 적으면 이 칸이 커버가 됩니다."}
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <p>{topic || "주제가 비어 있습니다."}</p>
            <p className="text-muted">{buildCoverPrompt(coverAnchor, topic)}</p>
            <p className="text-muted">
              틱톡은 별도 커버 이미지를 받지 않아서, 영상 안의 한 장면을 커버로
              씁니다.
            </p>
          </div>
        </Card.Content>
      </Card>

      <PlatformCard
        title="유튜브"
        enabled={project.youtube.enabled}
        onEnabled={(enabled) =>
          onYoutubeChange({ ...project.youtube, enabled })
        }
        note={`인증 파일 ${youtubeCredentials}. 쇼츠로 올리고, 공개 시각까지는 비공개입니다. 언어는 영어, 카테고리는 교육, 아동용은 아닙니다. 배경음악은 ${bgmName}이고, 볼륨은 ${Math.round(youtubeBgm.volume * 100)}%로 고정입니다. 영어 자막 파일을 영상 다음에 붙입니다. 끝 화면 카드는 업로드 API에 없어서, 설명의 영어 질문이 그 역할을 합니다. 썸네일은 대표 커버입니다.`}
      >
        <TextField
          value={project.youtube.title}
          onChange={(title) => onYoutubeChange({ ...project.youtube, title })}
          fullWidth
        >
          <Label>제목</Label>
          <Input />
        </TextField>
        <TextField
          value={project.youtube.description}
          onChange={(description) =>
            onYoutubeChange({ ...project.youtube, description })
          }
          fullWidth
        >
          <Label>설명</Label>
          <TextArea rows={4} />
        </TextField>
        <TextField
          value={project.youtube.tags}
          onChange={(tags) => onYoutubeChange({ ...project.youtube, tags })}
          fullWidth
        >
          <Label>태그</Label>
          <Input />
        </TextField>
      </PlatformCard>

      <PlatformCard
        title="인스타그램"
        enabled={project.instagram.enabled}
        onEnabled={(enabled) =>
          onInstagramChange({ ...project.instagram, enabled })
        }
        note={`인증 파일 ${instagramCredentials}. 프로페셔널 계정의 릴스로 올립니다. 커버는 대표 커버와 같고, 영상 주소는 공개 URL이어야 합니다.`}
      >
        <TextField
          value={project.instagram.caption}
          onChange={(caption) =>
            onInstagramChange({ ...project.instagram, caption })
          }
          fullWidth
        >
          <Label>캡션</Label>
          <TextArea rows={4} />
        </TextField>
      </PlatformCard>

      <PlatformCard
        title="틱톡"
        enabled={project.tiktok.enabled}
        onEnabled={(enabled) => onTiktokChange({ ...project.tiktok, enabled })}
        note={`인증 파일 ${tiktokCredentials}. 앱 심사가 끝나기 전에는 비공개로만 올라갑니다. AI 생성 표시를 붙입니다.`}
      >
        <TextField
          value={project.tiktok.caption}
          onChange={(caption) => onTiktokChange({ ...project.tiktok, caption })}
          fullWidth
        >
          <Label>캡션</Label>
          <TextArea rows={4} />
        </TextField>
      </PlatformCard>

      <div className="flex justify-between gap-2">
        <Button variant="outline" onPress={onBack}>
          이전
        </Button>
        <Button
          isDisabled={!ready || !project.youtube.enabled || uploading}
          onPress={() => void uploadYoutube()}
        >
          {uploading ? "올리는 중" : "업로드 하기"}
        </Button>
      </div>
      {uploadNote ? <p className="text-sm text-muted">{uploadNote}</p> : null}
      {youtubeUrl ? (
        <a
          href={youtubeUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
        >
          업로드한 영상 열기
        </a>
      ) : null}
      <p className="text-sm text-muted">
        로그인은 설정의 계정 연결에서 합니다.
      </p>
    </>
  )
}

function PlatformCard({
  title,
  enabled,
  onEnabled,
  note,
  children,
}: {
  title: string
  enabled: boolean
  onEnabled: (enabled: boolean) => void
  note: string
  children: ReactNode
}) {
  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <Card.Title>{title}</Card.Title>
        <Switch
          isSelected={enabled}
          onChange={onEnabled}
          aria-label={`${title}에 올리기`}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            이 채널에 올리기
          </Switch.Content>
        </Switch>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {children}
        <p className="text-sm text-muted">{note}</p>
      </Card.Content>
    </Card>
  )
}
