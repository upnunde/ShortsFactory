"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button, Card } from "@heroui/react"
import { Play, Plus, Square, Trash2 } from "lucide-react"
import { NewsFramePreview } from "@/components/news-clips/frame-preview"
import { LoadingButtonLabel } from "@/components/news-clips/loading-button-label"
import { SegmentedTabs } from "@/components/news-clips/segmented-tabs"
import {
  stepBodyClassName,
  stepHeaderActionButtonClassName,
  stepHeaderActionsClassName,
  stepHeaderClassName,
  stepHeaderContentClassName,
  workspacePageContentClassName,
} from "@/components/news-clips/step-action-bar"
import { AccountsPanel } from "@/components/studio/accounts-panel"
import {
  resolveTextBox,
  splitIntroTitleLines,
  titleLineFits,
} from "@/lib/news-clips/text-layout"
import type {
  NewsClipSettings,
  NewsSearchChannel,
  NewsTextLayout,
  TypecastVoiceProfile,
} from "@/lib/news-clips/types"
import { defaultNewsClipSettings } from "@/lib/news-clips/types"
import { NEWS_TTS_VOICES, newsTtsVoiceById } from "@/lib/news-clips/voices"

const NEWS_VOICE_PREVIEW_TEXT =
  "오늘 주요 소식입니다. 정부가 새로운 대책을 발표했습니다. 자세한 내용 전해드립니다."

export function NewsClipSettingsPanel({
  profileId,
  previewTitle,
  previewSubtitle,
  onPreviewChange,
  onSaved,
  initialTab = "search",
  accountNotice = null,
  youtubeChannelId = "",
}: {
  profileId: string
  previewTitle: string
  previewSubtitle: string
  onPreviewChange: (settings: NewsClipSettings) => void
  onSaved: (settings: NewsClipSettings) => void
  initialTab?: "search" | "assets" | "text" | "audio" | "accounts"
  accountNotice?: { kind: "connected" | "error"; platform: string } | null
  youtubeChannelId?: string
}) {
  const [settings, setSettings] = useState<NewsClipSettings>({
    ...defaultNewsClipSettings,
    profileId,
  })
  const [savedSettings, setSavedSettings] = useState<NewsClipSettings | null>(
    null
  )
  const [channels, setChannels] = useState<NewsSearchChannel[]>([])
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState("")
  const [voicePlaying, setVoicePlaying] = useState("")
  const [frameMode, setFrameMode] = useState<"title" | "body">("title")
  const [bodyTextTab, setBodyTextTab] = useState<
    "title" | "subtitle" | "source"
  >("title")
  const [settingsTab, setSettingsTab] = useState(initialTab)
  const [loaded, setLoaded] = useState(false)
  const [typecastUsage, setTypecastUsage] = useState<{
    planCredits: number
    usedCredits: number
    remainingCredits: number
    usedPercent: number
  } | null>(null)
  const [typecastUsageNote, setTypecastUsageNote] = useState("")
  const [typecastUsagePending, setTypecastUsagePending] = useState(false)
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const onPreviewChangeRef = useRef(onPreviewChange)
  const [previewFirstTitle, previewSecondTitle] = splitIntroTitleLines(
    previewTitle,
    settings.titleCardText
  )
  const previewFirstTitleFits = titleLineFits(
    previewFirstTitle,
    settings.titleCardText
  )
  const previewSecondTitleFits = titleLineFits(previewSecondTitle, {
    ...settings.titleCardText,
    fontSize: settings.titleCardSecondFontSize,
  })
  const previewTitleOverflow =
    Boolean(previewTitle) && (!previewFirstTitleFits || !previewSecondTitleFits)
  const previewTitleOverflowLabel =
    !previewFirstTitleFits && !previewSecondTitleFits
      ? "1·2단"
      : previewFirstTitleFits
        ? "2단"
        : "1단"
  const currentSettings = {
    ...settings,
    preferredChannels: channels,
  }
  const hasChanges =
    loaded &&
    savedSettings !== null &&
    JSON.stringify(currentSettings) !== JSON.stringify(savedSettings)
  useEffect(() => {
    onPreviewChangeRef.current = onPreviewChange
  }, [onPreviewChange])

  useEffect(() => {
    void fetch(
      `/api/news-clips/settings?profileId=${encodeURIComponent(profileId)}`
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("settings-load-failed")
        const value = (await response.json()) as NewsClipSettings
        setSettings(value)
        setChannels(value.preferredChannels)
        setSavedSettings(value)
        setLoaded(true)
      })
      .catch(() => setNote("설정을 읽지 못했습니다."))
  }, [profileId])

  useEffect(() => {
    if (!loaded) return
    onPreviewChangeRef.current({
      ...settings,
      preferredChannels: channels,
    })
  }, [channels, loaded, settings])

  useEffect(
    () => () => {
      voiceAudioRef.current?.pause()
    },
    []
  )

  const loadTypecastUsage = useCallback(async () => {
    setTypecastUsagePending(true)
    setTypecastUsageNote("")
    try {
      const response = await fetch("/api/news-clips/typecast-usage", {
        cache: "no-store",
      })
      const body = (await response.json()) as {
        planCredits?: number
        usedCredits?: number
        remainingCredits?: number
        usedPercent?: number
        message?: string
      }
      if (!response.ok) {
        setTypecastUsage(null)
        setTypecastUsageNote(body.message || "사용량을 불러오지 못했습니다.")
        return
      }
      if (
        typeof body.planCredits !== "number" ||
        typeof body.usedCredits !== "number" ||
        typeof body.remainingCredits !== "number" ||
        typeof body.usedPercent !== "number"
      ) {
        setTypecastUsage(null)
        setTypecastUsageNote("사용량을 불러오지 못했습니다.")
        return
      }
      setTypecastUsage({
        planCredits: body.planCredits,
        usedCredits: body.usedCredits,
        remainingCredits: body.remainingCredits,
        usedPercent: body.usedPercent,
      })
    } catch {
      setTypecastUsage(null)
      setTypecastUsageNote("사용량을 불러오지 못했습니다.")
    } finally {
      setTypecastUsagePending(false)
    }
  }, [])

  useEffect(() => {
    if (settings.ttsProvider !== "typecast") return
    const timeout = window.setTimeout(() => void loadTypecastUsage(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadTypecastUsage, settings.ttsProvider])

  async function save() {
    if (!loaded) return
    setPending(true)
    setNote("")
    try {
      const response = await fetch(
        `/api/news-clips/settings?profileId=${encodeURIComponent(profileId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...settings,
            preferredChannels: channels,
          }),
        }
      )
      const body = (await response.json()) as NewsClipSettings & {
        message?: string
      }
      if (!response.ok) {
        setNote(body.message || "저장하지 못했습니다.")
        return
      }
      setSettings(body)
      setChannels(body.preferredChannels)
      setSavedSettings(body)
      onSaved(body)
      setNote("뉴스 리포트 설정을 저장했습니다.")
    } catch {
      setNote("저장하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  async function upload(kind: "titleFrame" | "bodyFrame" | "bgm", file: File) {
    setPending(true)
    setNote("")
    const form = new FormData()
    form.set("kind", kind)
    form.set("file", file)
    try {
      const response = await fetch(
        `/api/news-clips/settings?profileId=${encodeURIComponent(profileId)}`,
        { method: "POST", body: form }
      )
      const body = (await response.json()) as NewsClipSettings & {
        message?: string
      }
      if (!response.ok) {
        setNote(body.message || "파일을 저장하지 못했습니다.")
        return
      }
      const assetPatch =
        kind === "titleFrame"
          ? { titleFrameImage: body.titleFrameImage }
          : kind === "bodyFrame"
            ? { bodyFrameImage: body.bodyFrameImage }
            : { bgmFile: body.bgmFile }
      const next = { ...settings, ...assetPatch }
      setSettings(next)
      setSavedSettings(body)
      onSaved({ ...next, preferredChannels: channels })
      setNote("파일을 등록했습니다.")
    } catch {
      setNote("파일을 저장하지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  function stopVoicePreview() {
    const audio = voiceAudioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      voiceAudioRef.current = null
    }
    setVoicePlaying("")
  }

  async function previewVoice({
    id,
    provider,
    voiceId,
    typecastVoiceId,
  }: {
    id: string
    provider: "free" | "typecast"
    voiceId: string
    typecastVoiceId: string
  }) {
    if (voicePlaying === id) {
      stopVoicePreview()
      return
    }
    stopVoicePreview()
    setVoiceBusy(id)
    setNote("")
    try {
      const response = await fetch("/api/news-clips/voice-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voiceId,
          provider,
          typecastVoiceId,
          ratePercent: settings.titleVoiceRate,
          text: NEWS_VOICE_PREVIEW_TEXT,
        }),
      })
      const body = (await response.json()) as {
        url?: string
        message?: string
      }
      if (!response.ok || !body.url) {
        setNote(body.message || "목소리 미리듣기를 만들지 못했습니다.")
        return
      }
      const audio = new Audio(body.url)
      voiceAudioRef.current = audio
      audio.addEventListener(
        "ended",
        () => {
          if (voiceAudioRef.current === audio) voiceAudioRef.current = null
          setVoicePlaying("")
        },
        { once: true }
      )
      const playback = audio.play()
      setVoicePlaying(id)
      await playback
    } catch {
      stopVoicePreview()
      setNote("목소리 미리듣기를 재생하지 못했습니다.")
    } finally {
      setVoiceBusy("")
    }
  }

  function addTypecastVoice() {
    setSettings({
      ...settings,
      typecastVoices: [
        ...settings.typecastVoices,
        {
          id: crypto.randomUUID(),
          name: `Typecast 음성 ${settings.typecastVoices.length + 1}`,
          voiceId: "",
        },
      ],
    })
  }

  function updateTypecastVoice(
    voice: TypecastVoiceProfile,
    patch: Partial<TypecastVoiceProfile>
  ) {
    if (patch.voiceId !== undefined) stopVoicePreview()
    const nextVoice = { ...voice, ...patch }
    setSettings({
      ...settings,
      typecastVoiceId:
        settings.typecastVoiceId === voice.voiceId
          ? nextVoice.voiceId
          : settings.typecastVoiceId,
      typecastVoices: settings.typecastVoices.map((item) =>
        item.id === voice.id ? nextVoice : item
      ),
    })
  }

  function removeTypecastVoice(voice: TypecastVoiceProfile) {
    if (settings.typecastVoices.length <= 1) return
    stopVoicePreview()
    const typecastVoices = settings.typecastVoices.filter(
      (item) => item.id !== voice.id
    )
    setSettings({
      ...settings,
      typecastVoices,
      typecastVoiceId:
        settings.typecastVoiceId === voice.voiceId
          ? typecastVoices[0].voiceId
          : settings.typecastVoiceId,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className={stepHeaderClassName}>
        <div className={stepHeaderContentClassName}>
          <h2 className="truncate text-xl leading-7 font-semibold">
            뉴스 리포트 채널 설정
          </h2>
          <div className={stepHeaderActionsClassName}>
            {note ? (
              <p className="max-w-sm truncate text-sm text-muted">{note}</p>
            ) : null}
            <Button
              className={stepHeaderActionButtonClassName}
              isDisabled={!loaded || (pending ? false : !hasChanges)}
              onPress={() => void save()}
            >
              <LoadingButtonLabel
                loading={pending}
                label="설정 저장"
                loadingLabel="저장 중"
              />
            </Button>
          </div>
        </div>
      </header>

      <div className={stepBodyClassName}>
        <div
          className={`${workspacePageContentClassName} flex flex-col gap-5 pb-6`}
        >
          <SegmentedTabs
            ariaLabel="뉴스 리포트 설정 구분"
            equalWidth={false}
            className="overflow-x-auto"
            value={settingsTab}
            onChange={setSettingsTab}
            items={[
              { id: "search", label: "검색" },
              { id: "assets", label: "화면 자산" },
              { id: "text", label: "텍스트 배치" },
              { id: "audio", label: "오디오·자막" },
              { id: "accounts", label: "채널 연결" },
            ]}
          />

        {settingsTab === "search" ? (
          <div className="flex flex-col gap-5">
            <Card>
              <Card.Header className="border-b border-separator pb-4">
                <Card.Title>이슈 탐색·원본 검색</Card.Title>
                <Card.Description>
                  이슈 탐색과 원본 검색 기준을 정합니다.
                </Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-5 md:grid-cols-2">
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-medium">우선 탐색 주제</span>
                  <textarea
                    rows={4}
                    maxLength={500}
                    value={settings.issueSearchGuidance}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        issueSearchGuidance: event.currentTarget.value,
                      })
                    }
                    className={fieldClass}
                    placeholder="예: 현 정부 정책의 모순, 민주당 관련 논란, 세금·부동산 정책이 국민 생활에 미치는 영향"
                  />
                </label>
                <div className="flex flex-col gap-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        우선 검색 채널 · 선택 사항
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() =>
                        setChannels((current) => [
                          ...current,
                          {
                            id: crypto.randomUUID(),
                            name: "",
                            youtubeChannelId: "",
                            priority: 3,
                            enabled: true,
                          },
                        ])
                      }
                    >
                      채널 추가
                    </Button>
                  </div>
                  {channels.length
                    ? channels.map((channel) => (
                        <div
                          key={channel.id}
                          className="grid gap-2 rounded-xl border border-separator p-3 md:grid-cols-[1fr_1.2fr_90px_80px_auto]"
                        >
                          <input
                            aria-label="채널 이름"
                            value={channel.name}
                            onChange={(event) =>
                              setChannels((current) =>
                                updateChannel(current, channel.id, {
                                  name: event.currentTarget.value,
                                })
                              )
                            }
                            className={fieldClass}
                            placeholder="채널 이름"
                          />
                          <input
                            aria-label="YouTube 채널 ID"
                            value={channel.youtubeChannelId}
                            onChange={(event) =>
                              setChannels((current) =>
                                updateChannel(current, channel.id, {
                                  youtubeChannelId: event.currentTarget.value,
                                })
                              )
                            }
                            className={fieldClass}
                            placeholder="UC..."
                          />
                          <label className="flex items-center gap-2 text-xs">
                            우선
                            <input
                              type="number"
                              min={1}
                              max={5}
                              value={channel.priority}
                              onChange={(event) =>
                                setChannels((current) =>
                                  updateChannel(current, channel.id, {
                                    priority: Number(event.currentTarget.value),
                                  })
                                )
                              }
                              className={fieldClass}
                            />
                          </label>
                          <label className="flex items-center justify-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={channel.enabled}
                              onChange={(event) =>
                                setChannels((current) =>
                                  updateChannel(current, channel.id, {
                                    enabled: event.currentTarget.checked,
                                  })
                                )
                              }
                            />
                            사용
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() =>
                              setChannels((current) =>
                                current.filter((item) => item.id !== channel.id)
                              )
                            }
                          >
                            삭제
                          </Button>
                        </div>
                      ))
                    : null}
                  <label className="flex items-start gap-3 rounded-xl border border-separator p-4 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.communitySignalsEnabled}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          communitySignalsEnabled: event.currentTarget.checked,
                        })
                      }
                    />
                    <span className="font-medium">
                      공개 커뮤니티 이슈 보조 신호
                    </span>
                  </label>
                </div>
                <div className="rounded-xl border border-separator p-4">
                  <p className="text-sm font-medium">제목 인트로 길이</p>
                </div>
              </Card.Content>
            </Card>
          </div>
        ) : null}

        {settingsTab === "assets" ? (
          <div className="flex flex-col gap-5">
            <Card>
              <Card.Header className="border-b border-separator pb-4">
                <Card.Title>고정 프레임</Card.Title>
                <Card.Description>
                  제목·본문 고정 프레임을 등록합니다.
                </Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-4 md:grid-cols-2">
                <AssetField
                  label="제목 프레임 이미지"
                  value={settings.titleFrameImage}
                  accept="image/*"
                  onFile={(file) => void upload("titleFrame", file)}
                />
                <AssetField
                  label="본문 프레임 이미지"
                  value={settings.bodyFrameImage}
                  accept="image/*"
                  onFile={(file) => void upload("bodyFrame", file)}
                />
                <div className="rounded-xl border border-separator bg-default p-4 md:col-span-2">
                  <p className="text-sm font-medium">
                    자료 영상 영역 · 3:2 고정
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    기준 캔버스 1080×720 · 720p 출력 720×480
                  </p>
                </div>
              </Card.Content>
            </Card>
          </div>
        ) : null}

        {settingsTab === "text" ? (
          <div className="flex flex-col gap-5">
            <Card>
              <Card.Header className="border-b border-separator pb-4">
                <Card.Title>글꼴·텍스트 위치</Card.Title>
                <Card.Description>
                  미리보기·초안·최종에 같은 글자 배치를 씁니다.
                </Card.Description>
              </Card.Header>
              <Card.Content className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="flex flex-col gap-3 lg:sticky lg:top-6">
                  <SegmentedTabs
                    ariaLabel="프레임 미리보기"
                    value={frameMode}
                    onChange={setFrameMode}
                    items={[
                      { id: "title", label: "제목 프레임" },
                      { id: "body", label: "본문 프레임" },
                    ]}
                  />
                  <NewsFramePreview
                    mode={frameMode}
                    title={previewTitle || "뉴스 핵심을\n두 줄 안에 표시"}
                    subtitle={
                      previewSubtitle ||
                      "본문 자막도 두 줄 안에서\n음성에 맞춰 표시됩니다"
                    }
                    sourceCredit={
                      frameMode === "body" ? "출처 · 예시 방송" : ""
                    }
                    settings={settings}
                    showGuides
                    className="w-full"
                  />
                  {frameMode === "title" && previewTitleOverflow ? (
                    <p className="text-xs font-medium text-danger">
                      {previewTitleOverflowLabel} 제목 폭 초과
                    </p>
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-col gap-5">
                  <RangeField
                    label="안전 여백"
                    value={settings.safeMarginPercent}
                    min={5}
                    max={12}
                    step={1}
                    formatValue={(value) => `${Math.round(value)}%`}
                    onChange={(safeMarginPercent) =>
                      setSettings({ ...settings, safeMarginPercent })
                    }
                  />
                  <label className="flex flex-col gap-2">
                    <span className="text-sm">글꼴</span>
                    <select
                      value={settings.fontFamily}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          fontFamily:
                            event.currentTarget.value === "Black Han Sans"
                              ? "Black Han Sans"
                              : "Pretendard",
                        })
                      }
                      className={fieldClass}
                    >
                      <option value="Pretendard">Pretendard</option>
                      <option value="Black Han Sans">Black Han Sans</option>
                    </select>
                  </label>

                  {frameMode === "title" ? (
                    <TextLayoutEditor
                      title="제목 프레임 제목"
                      value={settings.titleCardText}
                      maxWidthPercent={100}
                      secondaryFontSize={settings.titleCardSecondFontSize}
                      lineHeightPercent={settings.titleCardLineHeightPercent}
                      color={settings.titleCardColor}
                      secondaryColor={settings.titleCardSecondColor}
                      safeMarginPercent={settings.safeMarginPercent}
                      onChange={(titleCardText) =>
                        setSettings({ ...settings, titleCardText })
                      }
                      onSecondaryFontSizeChange={(titleCardSecondFontSize) =>
                        setSettings({ ...settings, titleCardSecondFontSize })
                      }
                      onLineHeightPercentChange={(titleCardLineHeightPercent) =>
                        setSettings({ ...settings, titleCardLineHeightPercent })
                      }
                      onColorChange={(titleCardColor) =>
                        setSettings({ ...settings, titleCardColor })
                      }
                      onSecondaryColorChange={(titleCardSecondColor) =>
                        setSettings({ ...settings, titleCardSecondColor })
                      }
                    />
                  ) : (
                    <>
                      <SegmentedTabs
                        ariaLabel="본문 텍스트"
                        value={bodyTextTab}
                        onChange={setBodyTextTab}
                        items={[
                          { id: "title", label: "제목" },
                          { id: "subtitle", label: "자막" },
                          { id: "source", label: "출처" },
                        ]}
                      />
                      {bodyTextTab === "title" ? (
                        <TextLayoutEditor
                          title="본문 상단 제목 · 한 줄"
                          value={settings.bodyTitleText}
                          maxWidthPercent={100}
                          color={settings.bodyTitleColor}
                          safeMarginPercent={settings.safeMarginPercent}
                          onChange={(bodyTitleText) =>
                            setSettings({ ...settings, bodyTitleText })
                          }
                          onColorChange={(bodyTitleColor) =>
                            setSettings({ ...settings, bodyTitleColor })
                          }
                        />
                      ) : null}
                      {bodyTextTab === "subtitle" ? (
                        <TextLayoutEditor
                          title="본문 자막"
                          value={settings.bodySubtitleText}
                          maxWidthPercent={100}
                          color={settings.subtitleColor}
                          safeMarginPercent={settings.safeMarginPercent}
                          onChange={(bodySubtitleText) =>
                            setSettings({ ...settings, bodySubtitleText })
                          }
                          onColorChange={(subtitleColor) =>
                            setSettings({ ...settings, subtitleColor })
                          }
                        />
                      ) : null}
                      {bodyTextTab === "source" ? (
                        <>
                          <div className="rounded-xl border border-separator bg-default p-3 text-sm text-muted">
                            출처 문구는 사용 중인 원본 영상의 채널명을 감지해
                            자동으로 넣습니다. 여기서는 글꼴·위치·색만 정합니다.
                          </div>
                          <TextLayoutEditor
                            title="본문 출처"
                            value={settings.bodySourceText}
                            maxWidthPercent={100}
                            color={settings.sourceColor}
                            safeMarginPercent={settings.safeMarginPercent}
                            onChange={(bodySourceText) =>
                              setSettings({ ...settings, bodySourceText })
                            }
                            onColorChange={(sourceColor) =>
                              setSettings({ ...settings, sourceColor })
                            }
                          />
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              </Card.Content>
            </Card>
          </div>
        ) : null}

        {settingsTab === "audio" ? (
          <div className="flex flex-col gap-5">
            <Card>
              <Card.Header className="border-b border-separator pb-4">
                <Card.Title>오디오·자막</Card.Title>
                <Card.Description>
                  논평 TTS를 고릅니다. 직접 발언은 원본 음성입니다.
                </Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-5 md:col-span-2">
                  <label className="flex max-w-md flex-col gap-2">
                    <span className="text-sm font-medium">TTS 제공자</span>
                    <select
                      value={settings.ttsProvider}
                      className={fieldClass}
                      onChange={(event) => {
                        stopVoicePreview()
                        setSettings({
                          ...settings,
                          ttsProvider: event.currentTarget.value as
                            "auto" | "free" | "typecast",
                        })
                      }}
                    >
                      <option value="auto">자동 · Typecast 우선</option>
                      <option value="free">무료 TTS</option>
                      <option value="typecast">Typecast</option>
                    </select>
                  </label>
                  {settings.ttsProvider === "typecast" ? (
                    <div className="flex max-w-md flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">
                          Typecast 사용량
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          isDisabled={typecastUsagePending}
                          onPress={() => void loadTypecastUsage()}
                        >
                          {typecastUsagePending ? "확인 중" : "새로고침"}
                        </Button>
                      </div>
                      {typecastUsage ? (
                        <>
                          <div className="h-2 overflow-hidden rounded-full bg-default">
                            <div
                              className={`h-full rounded-full transition-[width] ${
                                typecastUsage.usedPercent >= 90
                                  ? "bg-danger"
                                  : typecastUsage.usedPercent >= 70
                                    ? "bg-warning"
                                    : "bg-success"
                              }`}
                              style={{
                                width: `${Math.min(100, typecastUsage.usedPercent)}%`,
                              }}
                            />
                          </div>
                          <p className="text-sm text-muted">
                            {typecastUsage.usedCredits.toLocaleString("ko-KR")}{" "}
                            /{" "}
                            {typecastUsage.planCredits.toLocaleString("ko-KR")}{" "}
                            크레딧 · {typecastUsage.usedPercent}% 사용
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted">
                          {typecastUsagePending
                            ? "사용량을 확인하는 중…"
                            : typecastUsageNote || "사용량 정보가 없습니다."}
                        </p>
                      )}
                    </div>
                  ) : null}
                  {settings.ttsProvider !== "free" ? (
                    <section className="flex flex-col gap-4 border-t border-separator pt-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold">
                          Typecast 음성 목록
                        </h3>
                        <Button
                          size="sm"
                          variant="outline"
                          onPress={addTypecastVoice}
                        >
                          <Plus className="size-4" /> 음성 추가
                        </Button>
                      </div>
                      <label className="flex max-w-md flex-col gap-2">
                        <span className="text-sm">기본 Typecast 음성</span>
                        <select
                          value={settings.typecastVoiceId}
                          className={fieldClass}
                          onChange={(event) => {
                            stopVoicePreview()
                            setSettings({
                              ...settings,
                              typecastVoiceId: event.currentTarget.value,
                            })
                          }}
                        >
                          {settings.typecastVoices.map((voice) => (
                            <option key={voice.id} value={voice.voiceId}>
                              {voice.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="divide-y divide-separator">
                        {settings.typecastVoices.map((voice) => (
                          <div
                            key={voice.id}
                            className="grid items-end gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_9rem_auto]"
                          >
                            <label className="flex min-w-0 flex-col gap-2">
                              <span className="text-sm">음성 이름</span>
                              <input
                                value={voice.name}
                                className={fieldClass}
                                onChange={(event) =>
                                  updateTypecastVoice(voice, {
                                    name: event.currentTarget.value,
                                  })
                                }
                                placeholder="예: 뉴스 앵커"
                              />
                            </label>
                            <label className="flex min-w-0 flex-col gap-2">
                              <span className="text-sm">음성 코드</span>
                              <input
                                value={voice.voiceId}
                                className={fieldClass}
                                onChange={(event) =>
                                  updateTypecastVoice(voice, {
                                    voiceId: event.currentTarget.value,
                                  })
                                }
                                placeholder="tc_..."
                              />
                            </label>
                            <Button
                              variant="outline"
                              className="w-full justify-center"
                              isDisabled={
                                voiceBusy !== "" ||
                                !/^tc_[a-z0-9]{8,96}$/i.test(
                                  voice.voiceId.trim()
                                )
                              }
                              onPress={() =>
                                void previewVoice({
                                  id: voice.id,
                                  provider: "typecast",
                                  voiceId: settings.titleVoice,
                                  typecastVoiceId: voice.voiceId,
                                })
                              }
                            >
                              {voicePlaying === voice.id ? (
                                <Square className="size-4 fill-current" />
                              ) : (
                                <Play className="size-4" />
                              )}
                              {voiceBusy === voice.id
                                ? "생성 중"
                                : voicePlaying === voice.id
                                  ? "멈추기"
                                  : "미리듣기"}
                            </Button>
                            <Button
                              variant="ghost"
                              isIconOnly
                              aria-label={`${voice.name} 삭제`}
                              isDisabled={settings.typecastVoices.length <= 1}
                              onPress={() => removeTypecastVoice(voice)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {settings.ttsProvider !== "typecast" ? (
                    <section className="grid items-end gap-3 border-t border-separator pt-5 md:grid-cols-[minmax(0,1fr)_9rem]">
                      <label className="flex min-w-0 flex-col gap-2">
                        <span className="text-sm font-semibold">
                          {settings.ttsProvider === "auto"
                            ? "무료 대체 음성"
                            : "무료 TTS 목소리"}
                        </span>
                        <select
                          value={newsTtsVoiceById(settings.titleVoice).id}
                          className={fieldClass}
                          onChange={(event) => {
                            stopVoicePreview()
                            setSettings({
                              ...settings,
                              titleVoice: newsTtsVoiceById(
                                event.currentTarget.value
                              ).id,
                            })
                          }}
                        >
                          {NEWS_TTS_VOICES.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        variant="outline"
                        className="w-full justify-center"
                        isDisabled={voiceBusy !== ""}
                        onPress={() =>
                          void previewVoice({
                            id: `free-${settings.titleVoice}`,
                            provider: "free",
                            voiceId: settings.titleVoice,
                            typecastVoiceId: settings.typecastVoiceId,
                          })
                        }
                      >
                        {voicePlaying === `free-${settings.titleVoice}` ? (
                          <Square className="size-4 fill-current" />
                        ) : (
                          <Play className="size-4" />
                        )}
                        {voiceBusy === `free-${settings.titleVoice}`
                          ? "생성 중"
                          : voicePlaying === `free-${settings.titleVoice}`
                            ? "멈추기"
                            : "미리듣기"}
                      </Button>
                    </section>
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <AssetField
                    label="고정 BGM"
                    value={settings.bgmFile}
                    accept="audio/*"
                    onFile={(file) => void upload("bgm", file)}
                  />
                </div>
                <RangeField
                  label="BGM 기본 음량"
                  value={settings.bgmVolume}
                  min={0}
                  max={0.4}
                  step={0.01}
                  formatValue={ratioPercent}
                  onChange={(bgmVolume) =>
                    setSettings({ ...settings, bgmVolume })
                  }
                />
                <RangeField
                  label="아나운서 TTS 속도"
                  value={settings.titleVoiceRate}
                  min={-15}
                  max={8}
                  step={1}
                  formatValue={signedPercent}
                  onChange={(titleVoiceRate) =>
                    setSettings({ ...settings, titleVoiceRate })
                  }
                />
                <RangeField
                  label="원본 직접 발언 기본 음량"
                  value={settings.quoteVolume}
                  min={0}
                  max={2}
                  step={0.05}
                  formatValue={ratioPercent}
                  onChange={(quoteVolume) =>
                    setSettings({ ...settings, quoteVolume })
                  }
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.removeFillers}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        removeFillers: event.currentTarget.checked,
                      })
                    }
                  />
                  보도 대본에서 말버릇·반복 표현 제거
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.bgmEnabled}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        bgmEnabled: event.currentTarget.checked,
                      })
                    }
                  />
                  모든 뉴스 쇼츠에 BGM 기본 적용
                </label>
              </Card.Content>
            </Card>
          </div>
        ) : null}

          {settingsTab === "accounts" ? (
            <div className="flex flex-col gap-5">
              <AccountsPanel
                notice={accountNotice}
                profileId={profileId}
                returnTo="news"
                expectedYoutubeChannelId={youtubeChannelId}
              />
              <label className="flex items-center justify-between gap-4 rounded-xl border border-separator p-4 text-sm">
                <span className="font-medium">
                  최종본 완성 후 YouTube 비공개 자동 업로드
                </span>
                <input
                  type="checkbox"
                  checked={settings.youtubeAutoUpload}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      youtubeAutoUpload: event.currentTarget.checked,
                    })
                  }
                />
              </label>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const fieldClass =
  "w-full rounded-xl border border-separator bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"

function updateChannel(
  channels: NewsSearchChannel[],
  id: string,
  patch: Partial<NewsSearchChannel>
) {
  return channels.map((channel) =>
    channel.id === id ? { ...channel, ...patch } : channel
  )
}

function TextLayoutEditor({
  title,
  value,
  maxWidthPercent = 90,
  secondaryFontSize,
  lineHeightPercent,
  color,
  secondaryColor,
  safeMarginPercent,
  onChange,
  onSecondaryFontSizeChange,
  onLineHeightPercentChange,
  onColorChange,
  onSecondaryColorChange,
}: {
  title: string
  value: NewsTextLayout
  maxWidthPercent?: number
  secondaryFontSize?: number
  lineHeightPercent?: number
  color: string
  secondaryColor?: string
  safeMarginPercent: number
  onChange: (value: NewsTextLayout) => void
  onSecondaryFontSizeChange?: (value: number) => void
  onLineHeightPercentChange?: (value: number) => void
  onColorChange: (color: string) => void
  onSecondaryColorChange?: (color: string) => void
}) {
  const hasSecondLineSettings =
    secondaryFontSize !== undefined &&
    onSecondaryFontSizeChange !== undefined &&
    lineHeightPercent !== undefined &&
    onLineHeightPercentChange !== undefined &&
    secondaryColor !== undefined &&
    onSecondaryColorChange !== undefined

  return (
    <section className="rounded-xl border border-separator p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {hasSecondLineSettings ? (
        <div>
          <p className="mb-3 text-xs font-medium text-muted">줄별 설정</p>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium">1단 제목</p>
              <RangeField
                label="글자 크기"
                value={value.fontSize}
                min={28}
                max={220}
                step={1}
                formatValue={(fontSize) => `${Math.round(fontSize)}px`}
                onChange={(fontSize) => onChange({ ...value, fontSize })}
              />
              <TextColorField
                label="컬러"
                color={color}
                onChange={onColorChange}
              />
            </div>
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium">2단 제목</p>
              <RangeField
                label="글자 크기"
                value={secondaryFontSize}
                min={28}
                max={220}
                step={1}
                formatValue={(fontSize) => `${Math.round(fontSize)}px`}
                onChange={onSecondaryFontSizeChange}
              />
              <TextColorField
                label="컬러"
                color={secondaryColor}
                onChange={onSecondaryColorChange}
              />
            </div>
          </div>
          <div className="mt-5 border-t border-separator pt-5">
            <RangeField
              label="행간"
              value={lineHeightPercent}
              min={70}
              max={200}
              step={1}
              formatValue={(value) => `${Math.round(value)}%`}
              onChange={onLineHeightPercentChange}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <RangeField
            label="글자 크기"
            value={value.fontSize}
            min={28}
            max={150}
            step={1}
            formatValue={(fontSize) => `${Math.round(fontSize)}px`}
            onChange={(fontSize) => onChange({ ...value, fontSize })}
          />
          <TextColorField
            label="글자 컬러"
            color={color}
            onChange={onColorChange}
          />
        </div>
      )}

      <div className="mt-5 border-t border-separator pt-5">
        <p className="mb-3 text-xs font-medium text-muted">타이포그래피</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <RangeField
            label="글자 굵기"
            value={value.fontWeight}
            min={400}
            max={900}
            step={100}
            formatValue={(fontWeight) => String(Math.round(fontWeight))}
            onChange={(fontWeight) =>
              onChange({
                ...value,
                fontWeight: fontWeight as NewsTextLayout["fontWeight"],
              })
            }
          />
          <RangeField
            label="자간"
            value={value.letterSpacing}
            min={-5}
            max={20}
            step={1}
            formatValue={(letterSpacing) =>
              `${letterSpacing > 0 ? "+" : ""}${Math.round(letterSpacing)}px`
            }
            onChange={(letterSpacing) => onChange({ ...value, letterSpacing })}
          />
        </div>
      </div>

      <div className="mt-5 border-t border-separator pt-5">
        <p className="mb-3 text-xs font-medium text-muted">배치</p>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm">가로 위치</span>
            <div className="flex gap-2">
              {(
                [
                  ["left", "좌측"],
                  ["center", "가운데"],
                  ["right", "우측"],
                ] as const
              ).map(([alignment, label]) => (
                <Button
                  key={alignment}
                  size="sm"
                  variant={
                    value.alignment === alignment ? "secondary" : "outline"
                  }
                  onPress={() => onChange({ ...value, alignment })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <RangeField
            label="세로 위치"
            value={value.y}
            min={0}
            max={1800}
            step={1}
            formatValue={(y) => `${Math.round((y / 1920) * 100)}%`}
            onChange={(y) => onChange({ ...value, y })}
          />
          <TextWidthField
            value={value}
            safeMarginPercent={safeMarginPercent}
            maxPercent={maxWidthPercent}
            onChange={(width) => onChange({ ...value, width })}
          />
        </div>
      </div>
    </section>
  )
}

const TEXT_COLOR_PRESETS = [
  "#ffffff",
  "#ffd84d",
  "#ff5a5f",
  "#5ee28b",
  "#111111",
] as const

function TextColorField({
  label,
  color,
  onChange,
}: {
  label: string
  color: string
  onChange: (color: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
      <span className="text-sm">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-separator px-2.5 py-1.5">
          <input
            aria-label="직접 컬러 선택"
            type="color"
            value={color}
            onChange={(event) => onChange(event.currentTarget.value)}
            className="size-7 cursor-pointer border-0 bg-transparent p-0"
          />
          <span className="text-xs font-medium text-muted tabular-nums">
            {color.toUpperCase()}
          </span>
        </label>
        {TEXT_COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={`${preset} 컬러 적용`}
            title={preset}
            onClick={() => onChange(preset)}
            className={`size-8 rounded-full border-2 shadow-sm transition ${
              color.toLowerCase() === preset
                ? "border-foreground ring-2 ring-foreground/20"
                : "border-separator"
            }`}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>
    </div>
  )
}

function TextWidthField({
  value,
  safeMarginPercent,
  maxPercent = 90,
  onChange,
}: {
  value: NewsTextLayout
  safeMarginPercent: number
  maxPercent?: number
  onChange: (width: number) => void
}) {
  const box = resolveTextBox(value, safeMarginPercent)
  const widthPercent = Math.round(box.widthPercent)
  return (
    <label className="flex flex-col gap-2 sm:col-span-2 lg:col-span-2">
      <span className="flex flex-wrap justify-between gap-2 text-sm">
        <span>텍스트 폭</span>
        <span className="text-muted tabular-nums">
          화면 {widthPercent}% · 좌 {box.leftPercent}% · 우 {box.rightPercent}%
        </span>
      </span>
      <input
        type="range"
        value={widthPercent}
        min={50}
        max={maxPercent}
        step={1}
        onChange={(event) =>
          onChange(Math.round((1080 * Number(event.currentTarget.value)) / 100))
        }
      />
    </label>
  )
}

function AssetField({
  label,
  value,
  accept,
  onFile,
}: {
  label: string
  value: string
  accept: string
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-separator p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 truncate text-xs text-muted">
          {value || "등록된 파일 없음"}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) onFile(file)
          event.currentTarget.value = ""
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onPress={() => inputRef.current?.click()}
      >
        {value ? "파일 변경" : "파일 등록"}
      </Button>
    </div>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  formatValue: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{formatValue(value)}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function ratioPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function signedPercent(value: number) {
  const rounded = Math.round(value)
  return `${rounded > 0 ? "+" : ""}${rounded}%`
}
