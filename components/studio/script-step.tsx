"use client"

import { useEffect, useRef, useState } from "react"

import { Button, Card, Chip, Label, ListBox, Select, TextArea, TextField } from "@heroui/react"
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
  narrationTooLong,
  targetSeconds,
} from "@/lib/timing"
import type { Project, Scene } from "@/lib/types"

export function ScriptStep({
  project,
  onKoreanChange,
  onSubtitleChange,
  onRevertKorean,
  onBack,
  onMake,
  onRewriteScene,
  onPictureChange,
  onCastEnter,
  busy,
  error,
}: {
  project: Project
  onKoreanChange: (sceneId: string, scriptKo: string) => void
  onSubtitleChange: (sceneId: string, subtitle: string) => void
  onRevertKorean: (sceneId: string) => void
  onBack: () => void
  onMake: () => void
  onRewriteScene: (sceneId: string) => void
  onPictureChange: (sceneId: string, sceneDescription: string) => void
  onCastEnter: (characterId: string, fromIndex: number | null) => void
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
  const audioRef = useRef<HTMLAudioElement>(null)
  const measured = project.scenes.every(
    (scene) => spoken[scene.id]?.text === scene.scriptTarget
  )
  const measuredTotal = project.scenes.reduce(
    (sum, scene) => sum + (spoken[scene.id]?.duration ?? 0),
    0
  )
  const shownTotal = measured ? measuredTotal : seconds
  const shownOver = narrationTooLong(shownTotal)

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
        body: JSON.stringify({ scenes }),
      })
      const body = (await response.json()) as {
        message?: string
        key?: string
        clips?: { id: string; duration: number; text: string }[]
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
      return { key }
    } catch {
      setVoiceError("음성을 만들지 못했습니다.")
      return null
    } finally {
      setVoiceBusy("")
    }
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
        description="말할 문장과 화면을 확인합니다. 보조 인물은 나온 씬부터 끝까지 같은 모습으로 남습니다."
      />

      <Card>
        <Card.Content className="flex flex-col gap-3">
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
                  project.scenes.some((scene) => scene.scriptTarget.trim() === "")
                }
                onPress={() => void playAll()}
              />
              <span>{measured ? "음성 길이" : "예상 길이"}</span>
            </div>
            <span className={shownOver ? "text-danger" : "text-muted"}>
              {measured
                ? `${shownTotal.toFixed(1)}초`
                : `약 ${formatSeconds(seconds)}`}{" "}
              / {formatSeconds(targetSeconds())}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-default">
            <div
              className={shownOver ? "h-full bg-danger" : "h-full bg-accent"}
              style={{
                width: `${Math.min(100, (shownTotal / targetSeconds()) * 100)}%`,
              }}
            />
          </div>
          {voiceError ? (
            <p className="text-sm text-danger">{voiceError}</p>
          ) : null}
          {topicDrift ? (
            <p className="text-sm text-warning">
              주제가 이 대본을 만들 때와 다릅니다. 씬을 지우지 않고, 고친
              한국어만 영어 갱신 대상입니다.
            </p>
          ) : null}
        </Card.Content>
      </Card>

      <CastPlan project={project} onCastEnter={onCastEnter} />

      <div className="flex flex-col gap-4">
        {project.scenes.map((scene, index) => (
          <SceneScriptCard
            key={scene.id}
            index={index}
            companions={companionsAt(project, index)}
            onPictureChange={(value) => onPictureChange(scene.id, value)}
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
            playDisabled={
              voiceBusy !== "" || scene.scriptTarget.trim() === ""
            }
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
        nextLabel="씬 영상 만들기"
        onNext={onMake}
        nextDisabled={blocked !== "" || busy !== "" || voiceBusy !== ""}
        note={
          blocked ||
          (shownOver
            ? "예상 길이가 50초 이상입니다. 같은 장소의 짧은 씬은 한 영상으로 묶어 만듭니다. 힉스필드 비용이 듭니다."
            : "같은 장소의 짧은 씬은 한 영상으로 묶어 만듭니다. 힉스필드 비용이 듭니다.")
        }
      />
    </>
  )
}

type RegisteredPerson = {
  id: string
  name: string
  host: boolean
  active: boolean
}

function companionsAt(project: Project, index: number) {
  const scene = project.scenes[index]
  if (!scene || scene.shot === "insert") {
    return []
  }
  return scene.castIds ?? []
}

function CastPlan({
  project,
  onCastEnter,
}: {
  project: Project
  onCastEnter: (characterId: string, fromIndex: number | null) => void
}) {
  const [people, setPeople] = useState<RegisteredPerson[]>([])

  useEffect(() => {
    void fetch("/api/character")
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          body: {
            hostId?: string
            outfits?: { id: string; name: string; active: boolean }[]
          } | null
        ) => {
          const hostId = body?.hostId ?? body?.outfits?.[0]?.id ?? ""
          setPeople(
            (body?.outfits ?? []).map((person) => ({
              id: person.id,
              name: person.name,
              host: person.id === hostId,
              active: person.active,
            }))
          )
        }
      )
      .catch(() => undefined)
  }, [])

  const host = people.find((person) => person.host)
  const support = people.filter((person) => !person.host && person.active)
  const roomScenes = project.scenes
    .map((scene, index) => ({ scene, index }))
    .filter((item) => item.scene.shot !== "insert")

  return (
    <Card>
      <Card.Header>
        <Card.Title>화면</Card.Title>
        <Card.Description>
          진행 자리는 {project.placeKo.trim() || "아직 없습니다"}. 진행자는{" "}
          {host?.name ?? "등록된 진행자"}이고, 자료 화면에는 인물이 나오지
          않습니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {support.length === 0 ? (
          <p className="text-sm text-muted">
            설정에서 켠 보조 인물이 없습니다. 방 장면에는 진행자만 나옵니다.
          </p>
        ) : (
          support.map((person) => {
            const from = project.scenes.findIndex(
              (scene) =>
                scene.shot !== "insert" && (scene.castIds ?? []).includes(person.id)
            )
            return (
              <Select
                key={person.id}
                aria-label={`${person.name} 등장`}
                selectedKey={from === -1 ? "none" : String(from)}
                onSelectionChange={(key) => {
                  if (key == null) {
                    return
                  }
                  const value = String(key)
                  onCastEnter(person.id, value === "none" ? null : Number(value))
                }}
              >
                <Label>{person.name}</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="none" textValue="나오지 않음">
                      나오지 않음
                    </ListBox.Item>
                    {roomScenes.map((item) => (
                      <ListBox.Item
                        key={item.scene.id}
                        id={String(item.index)}
                        textValue={`씬 ${item.index + 1}부터`}
                      >
                        씬 {item.index + 1}부터
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )
          })
        )}
      </Card.Content>
    </Card>
  )
}

function SceneScriptCard({
  index,
  scene,
  companions,
  onPictureChange,
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
  companions: string[]
  onPictureChange: (value: string) => void
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
          {stale ? "이 씬 영어만 다시 필요" : "영어 맞음"}
        </Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="soft">
            {scene.shot === "insert" ? "자료 화면" : "방 장면"}
          </Chip>
          <p className="text-sm text-muted">
            {scene.shot === "insert"
              ? "인물이 나오지 않습니다."
              : `진행자${companions.length > 0 ? `와 보조 ${companions.length}명` : "만"}`}
          </p>
        </div>
        <TextField value={scene.sceneDescription} onChange={onPictureChange} fullWidth>
          <Label>화면</Label>
          <TextArea rows={2} />
        </TextField>
        <div className="grid gap-4 md:grid-cols-2">
        <TextField value={scene.scriptKo} onChange={onKoreanChange} fullWidth>
          <Label>한국어</Label>
          <TextArea rows={4} />
        </TextField>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">영어 나레이션</p>
          <p className="text-sm leading-6">{scene.scriptTarget}</p>
          <TextField
            value={
              typeof scene.subtitle === "string"
                ? scene.subtitle
                : defaultSubtitle(scene.scriptTarget)
            }
            onChange={onSubtitleChange}
            fullWidth
          >
            <Label>자막</Label>
            <TextArea rows={4} />
          </TextField>
          <p className="text-xs text-muted">
            한 줄이 자막 한 구간입니다. 화면에는 최대 2줄까지 나오고, 그 씬
            음성 길이에 맞춰 차례로 바뀝니다.
          </p>
          {stale ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-warning">
                영어 맞추기를 누르면 이 씬만 다시 번역되고, 자막 줄은 새 영어
                기준으로 다시 나뉩니다.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  isDisabled={rewriteDisabled}
                  onPress={onRewriteScene}
                >
                  {rewriting ? "맞추는 중" : "영어 맞추기"}
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
        </div>
        </div>
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
