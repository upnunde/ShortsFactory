"use client"

import { useEffect, useRef, useState } from "react"

import {
  Button,
  Card,
  Chip,
  Label,
  TextArea,
  TextField,
} from "@heroui/react"
import { LoaderCircle, Pause, Play } from "lucide-react"
import { StepActions, StepHeader } from "@/components/studio/chrome"
import {
  englishIsStale,
  projectSeconds,
  scriptBlocked,
} from "@/lib/scene-status"
import {
  defaultSubtitle,
  formatSeconds,
  narrationSeconds,
} from "@/lib/timing"
import type { Project, Scene } from "@/lib/types"
import {
  defaultVideoSettings,
  type VideoSettings,
} from "@/lib/video-settings"

export function ScriptStep({
  project,
  onKoreanChange,
  onSubtitleChange,
  onRevertKorean,
  onBack,
  onComplete,
  onRewriteScene,
  busy,
  error,
}: {
  project: Project
  onKoreanChange: (sceneId: string, scriptKo: string) => void
  onSubtitleChange: (sceneId: string, subtitle: string) => void
  onRevertKorean: (sceneId: string) => void
  onBack: () => void
  onComplete: (preview: {
    key: string
    clips: {
      id: string
      duration: number
      text: string
      words: { word: string; start: number; end: number }[]
    }[]
  }) => void
  onRewriteScene: (sceneId: string) => void
  busy: string
  error: string
}) {
  const seconds = projectSeconds(project.scenes)
  const blocked = scriptBlocked(project)
  const topicDrift = project.topic.trim() !== project.scriptTopic.trim()
  const [spoken, setSpoken] = useState<
    Record<string, { text: string; duration: number; key: string }>
  >({})
  const [bundleKey, setBundleKey] = useState("")
  const [voiceBusy, setVoiceBusy] = useState("")
  const [playing, setPlaying] = useState("")
  const [voiceError, setVoiceError] = useState("")
  const [videoSettings, setVideoSettings] = useState(defaultVideoSettings)
  const audioRef = useRef<HTMLAudioElement>(null)
  const measured = project.scenes.every(
    (scene) => spoken[scene.id]?.text === scene.scriptTarget
  )
  const measuredTotal = project.scenes.reduce(
    (sum, scene) => sum + (spoken[scene.id]?.duration ?? 0),
    0
  )
  const shownTotal = measured ? measuredTotal : seconds
  const shownOver =
    shownTotal >
    videoSettings.targetDurationSeconds + videoSettings.durationToleranceSeconds

  useEffect(() => {
    void fetch(`/api/video?profileId=${encodeURIComponent(project.profileId)}`)
      .then(async (response) => {
        if (response.ok) {
          setVideoSettings((await response.json()) as VideoSettings)
        }
      })
      .catch(() => undefined)
  }, [project.profileId])

  async function playAll() {
    if (measured && bundleKey) {
      await startAudio(bundleKey, "all")
      return
    }
    const preview = await requestVoice(
      project.scenes.map((scene) => ({
        id: scene.id,
        text: scene.scriptTarget,
      })),
      "all"
    )
    if (!preview) {
      return
    }
    setBundleKey(preview.key)
    await startAudio(preview.key, "all")
  }

  async function playScene(scene: Scene) {
    const ready = spoken[scene.id]
    if (ready?.text === scene.scriptTarget && ready.key) {
      await startAudio(ready.key, scene.id)
      return
    }
    const preview = await requestVoice(
      [{ id: scene.id, text: scene.scriptTarget }],
      scene.id
    )
    if (!preview) {
      return
    }
    await startAudio(preview.key, scene.id)
  }

  async function requestVoice(
    scenes: { id: string; text: string }[],
    busyId: string
  ) {
    audioRef.current?.pause()
    setPlaying("")
    setVoiceBusy(busyId)
    setVoiceError("")
    try {
      const response = await fetch("/api/voice/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenes, profileId: project.profileId }),
      })
      const body = (await response.json()) as {
        message?: string
        key?: string
        clips?: {
          id: string
          duration: number
          text: string
          words: { word: string; start: number; end: number }[]
        }[]
      }
      if (!response.ok || !body.key || !body.clips) {
        setVoiceError(body.message || "음성을 만들지 못했습니다.")
        return null
      }
      const key = body.key
      setSpoken((current) => ({
        ...current,
        ...Object.fromEntries(
          body.clips!.map((clip) => [
            clip.id,
            { text: clip.text, duration: clip.duration, key },
          ])
        ),
      }))
      return { key, clips: body.clips }
    } catch {
      setVoiceError("음성을 만들지 못했습니다.")
      return null
    } finally {
      setVoiceBusy("")
    }
  }

  async function completeScript() {
    const preview = await requestVoice(
      project.scenes.map((scene) => ({
        id: scene.id,
        text: scene.scriptTarget,
      })),
      "all"
    )
    if (!preview) return
    onComplete(preview)
  }

  async function startAudio(key: string, scope: string) {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    if (playing === scope && !audio.paused) {
      audio.pause()
      setPlaying("")
      return
    }
    const clip = scope === "all" ? "all" : scope
    audio.src = `/api/voice/preview?key=${key}&clip=${encodeURIComponent(clip)}`
    setPlaying(scope)
    try {
      await audio.play()
    } catch {
      setPlaying("")
      setVoiceError("재생을 시작하지 못했습니다. 다시 눌러 주세요.")
    }
  }

  return (
    <>
      <StepHeader
        title="대본"
        description="이 단계에서는 말할 내용과 실제 음성 길이만 확정합니다. 완료하면 화면 연출을 별도로 설계합니다."
      />

      <Card>
        <Card.Header>
          <Card.Title>제작 요약</Card.Title>
          <Card.Description>
            음성 길이와 유료 AI 영상 사용량을 한곳에서 확인합니다.
          </Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <PlayButton
                label="전체 대본 듣기"
                text={voiceBusy === "all" ? "만드는 중" : "전체 듣기"}
                busy={voiceBusy === "all"}
                playing={playing === "all"}
                disabled={
                  voiceBusy !== "" ||
                  project.scenes.length === 0 ||
                  project.scenes.some(
                    (scene) => scene.scriptTarget.trim() === ""
                  )
                }
                onPress={() => void playAll()}
              />
              <span>{measured ? "음성 길이" : "예상 길이"}</span>
            </div>
            <span className={shownOver ? "text-danger" : "text-muted"}>
              {measured
                ? `${shownTotal.toFixed(1)}초`
                : `약 ${formatSeconds(seconds)}`}{" "}
              / {formatSeconds(videoSettings.targetDurationSeconds)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-default">
            <div
              className={shownOver ? "h-full bg-danger" : "h-full bg-accent"}
              style={{
                width: `${Math.min(100, (shownTotal / videoSettings.targetDurationSeconds) * 100)}%`,
              }}
            />
          </div>
          {voiceError ? (
            <p className="text-sm text-danger">{voiceError}</p>
          ) : null}
          {topicDrift ? (
            <p className="text-sm text-warning">
              주제가 이 대본을 만들 때와 다릅니다. 원문을 맞추면 연결된 번역과
              제목·게시 문구도 함께 갱신됩니다. 연출은 대본 완성 후 만듭니다.
            </p>
          ) : null}
          <div className="grid gap-2 border-t border-separator pt-4 text-sm sm:grid-cols-2">
            <Metric
              label="전체 길이"
              value={`${shownTotal.toFixed(1)}초 / ${videoSettings.targetDurationSeconds}±${videoSettings.durationToleranceSeconds}초`}
              danger={shownOver}
            />
            <Metric label="대본 상태" value={blocked || "확정 가능"} danger={blocked !== ""} />
          </div>
        </Card.Content>
      </Card>

      <div className="flex flex-col gap-4">
        {project.scenes.map((scene, index) => (
          <SceneScriptCard
            key={scene.id}
            index={index}
            scene={scene}
            onKoreanChange={(value) => onKoreanChange(scene.id, value)}
            onSubtitleChange={(value) => onSubtitleChange(scene.id, value)}
            onRevertKorean={() => onRevertKorean(scene.id)}
            onRewriteScene={() => onRewriteScene(scene.id)}
            rewriting={busy === scene.id}
            rewriteDisabled={busy !== "" || voiceBusy !== ""}
            spokenSeconds={
              spoken[scene.id]?.text === scene.scriptTarget
                ? spoken[scene.id]?.duration
                : undefined
            }
            playLabel={`씬 ${index + 1} 듣기`}
            playBusy={voiceBusy === scene.id}
            playing={playing === scene.id}
            playDisabled={voiceBusy !== "" || scene.scriptTarget.trim() === ""}
            onPlay={() => void playScene(scene)}
          />
        ))}
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        preload="auto"
        onEnded={() => setPlaying("")}
      />

      {error ? <p className="text-right text-sm text-danger">{error}</p> : null}

      <StepActions
        onBack={onBack}
        nextLabel="대본 완성 및 화면 연출 만들기"
        onNext={() => void completeScript()}
        nextDisabled={
          blocked !== "" || busy !== "" || voiceBusy !== ""
        }
        note={
          blocked ||
          (shownOver
            ? `예상 길이가 ${videoSettings.targetDurationSeconds + videoSettings.durationToleranceSeconds}초를 넘습니다. 대본을 줄여 주세요.`
            : "완료하면 TTS를 실측하고, 길이가 범위를 벗어나면 내용을 자동 요약·보강한 뒤 화면 연출을 만듭니다.")
        }
      />
    </>
  )
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-default/40 p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={danger ? "text-danger" : "text-foreground"}>
        {value}
      </span>
    </div>
  )
}

function SceneScriptCard({
  index,
  scene,
  onKoreanChange,
  onSubtitleChange,
  onRevertKorean,
  onRewriteScene,
  rewriting,
  rewriteDisabled,
  spokenSeconds,
  playLabel,
  playBusy,
  playing,
  playDisabled,
  onPlay,
}: {
  index: number
  scene: Scene
  onKoreanChange: (value: string) => void
  onSubtitleChange: (value: string) => void
  onRevertKorean: () => void
  onRewriteScene: () => void
  rewriting: boolean
  rewriteDisabled: boolean
  spokenSeconds?: number
  playLabel: string
  playBusy: boolean
  playing: boolean
  playDisabled: boolean
  onPlay: () => void
}) {
  const stale = englishIsStale(scene)
  const secondsLabel =
    spokenSeconds === undefined
      ? `약 ${formatSeconds(narrationSeconds(scene.scriptTarget))}`
      : `${spokenSeconds.toFixed(1)}초`

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PlayButton
            label={playLabel}
            busy={playBusy}
            playing={playing}
            disabled={playDisabled}
            onPress={onPlay}
          />
          <Card.Title>
            씬 {index + 1}
            <span className="ml-2 text-sm font-normal text-muted">
              {secondsLabel}
            </span>
          </Card.Title>
        </div>
        <Chip size="sm" color={stale ? "warning" : "success"} variant="soft">
          {stale ? "연결 항목 갱신 필요" : "내용 맞음"}
        </Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-5">
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <section className="flex min-h-[19rem] flex-col rounded-xl border border-separator bg-default/20 p-4">
            <div className="shrink-0">
              <p className="text-sm font-medium">한국어 원문</p>
              <p className="mt-1 text-xs text-muted">
                내용을 수정하면 번역, 자막, 제목과 게시 문구를 함께 맞춥니다.
                화면 연출은 대본 완성 후 별도로 생성됩니다.
              </p>
            </div>
            <TextField
              className="mt-4 min-h-0 flex-1"
              value={scene.scriptKo}
              onChange={onKoreanChange}
              fullWidth
            >
              <Label className="sr-only">한국어 원문</Label>
              <TextArea className="h-full min-h-0 flex-1 resize-none overflow-y-auto" />
            </TextField>
          </section>

          <section className="flex min-h-[19rem] flex-col rounded-xl border border-separator bg-default/20 p-4">
            <div>
              <p className="text-sm font-medium">영어 나레이션</p>
              <p className="mt-1 text-xs text-muted">TTS가 읽는 확정 문장입니다.</p>
            </div>
            <div className="mt-4 min-h-20 rounded-lg bg-background/70 p-3 text-sm leading-6 ring-1 ring-separator">
              {scene.scriptTarget}
            </div>
            <TextField
              className="mt-4"
              value={
                typeof scene.subtitle === "string"
                  ? scene.subtitle
                  : defaultSubtitle(scene.scriptTarget)
              }
              onChange={onSubtitleChange}
              fullWidth
            >
              <Label>영문 자막 구간</Label>
              <TextArea rows={3} />
            </TextField>
            <p className="mt-2 text-xs leading-5 text-muted">
              한 줄이 한 구간이며, 음성 길이에 맞춰 최대 2줄씩 표시됩니다.
            </p>
          </section>
        </div>

        {stale ? (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-warning">
              한국어가 변경되었습니다. 연결된 항목을 새 원문에 맞춰 주세요.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                isDisabled={rewriteDisabled}
                onPress={onRewriteScene}
              >
                {rewriting ? "맞추는 중" : "전체 맞추기"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                isDisabled={rewriteDisabled}
                onPress={onRevertKorean}
              >
                한국어 되돌리기
              </Button>
            </div>
          </div>
        ) : null}
      </Card.Content>
    </Card>
  )
}

function PlayButton({
  label,
  text,
  busy,
  playing,
  disabled,
  onPress,
}: {
  label: string
  text?: string
  busy: boolean
  playing: boolean
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      isIconOnly={!text}
      aria-label={playing ? `${label} 정지` : label}
      isDisabled={disabled}
      onPress={onPress}
    >
      {busy ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : playing ? (
        <Pause className="size-4" />
      ) : (
        <Play className="size-4" />
      )}
      {text ? <span>{playing ? "정지" : text}</span> : null}
    </Button>
  )
}
