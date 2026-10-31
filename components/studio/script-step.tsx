"use client"

import { Button, Card, Chip, Label, TextArea, TextField } from "@heroui/react"
import { StepActions, StepHeader } from "@/components/studio/chrome"
import { OutfitPicker } from "@/components/studio/outfit-choice"
import { englishIsStale, projectSeconds, scriptBlocked } from "@/lib/scene-status"
import { defaultSubtitle, formatSeconds, targetSeconds } from "@/lib/timing"
import type { Project, Scene } from "@/lib/types"

export function ScriptStep({
  project,
  onKoreanChange,
  onSubtitleChange,
  onDescriptionChange,
  onRevertKorean,
  onBack,
  onMake,
  outfitId,
  onOutfitChange,
  onRewrite,
  onRewriteScene,
  busy,
  error,
}: {
  project: Project
  onKoreanChange: (sceneId: string, scriptKo: string) => void
  onSubtitleChange: (sceneId: string, subtitle: string) => void
  onDescriptionChange: (sceneId: string, sceneDescription: string) => void
  onRevertKorean: (sceneId: string) => void
  onBack: () => void
  onMake: () => void
  outfitId: string | null
  onOutfitChange: (outfitId: string | null) => void
  onRewrite: () => void
  onRewriteScene: (sceneId: string) => void
  busy: string
  error: string
}) {
  const seconds = projectSeconds(project.scenes)
  const over = seconds > targetSeconds()
  const blocked = scriptBlocked(project)
  const topicDrift = project.topic.trim() !== project.scriptTopic.trim()

  return (
    <>
      <StepHeader
        title="대본 검수"
        description="한국어를 고치면 그 씬만 다시 번역합니다. 자막 줄은 씬마다 직접 나눌 수 있습니다."
      />

      <Card>
        <Card.Content className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>예상 길이</span>
            <span className={over ? "text-danger" : "text-muted"}>
              약 {formatSeconds(seconds)} / {formatSeconds(targetSeconds())}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-default">
            <div
              className={over ? "h-full bg-danger" : "h-full bg-accent"}
              style={{ width: `${Math.min(100, (seconds / targetSeconds()) * 100)}%` }}
            />
          </div>
          {topicDrift ? (
            <p className="text-sm text-warning">
              주제가 이 대본을 만들 때와 다릅니다. 씬을 지우지 않고, 고친 한국어만 영어 갱신 대상입니다.
            </p>
          ) : null}
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
            onDescriptionChange={(value) => onDescriptionChange(scene.id, value)}
            onRevertKorean={() => onRevertKorean(scene.id)}
            onRewriteScene={() => onRewriteScene(scene.id)}
            rewriting={busy === scene.id}
            rewriteDisabled={busy !== ""}
          />
        ))}
      </div>

      <OutfitPicker outfitId={outfitId} onChange={onOutfitChange} />

      <div className="flex flex-col items-end gap-2">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button variant="outline" isDisabled={busy !== ""} onPress={onRewrite}>
          {busy === "draft" ? "쓰는 중" : "이 주제로 대본 다시 쓰기"}
        </Button>
      </div>

      <StepActions
        onBack={onBack}
        nextLabel="만들기"
        onNext={onMake}
        nextDisabled={blocked !== "" || busy !== ""}
        note={blocked || "승인한 영어 대본으로 씬마다 화면과 음성·자막을 만듭니다."}
      />
    </>
  )
}

function SceneScriptCard({
  index,
  scene,
  onKoreanChange,
  onSubtitleChange,
  onDescriptionChange,
  onRevertKorean,
  onRewriteScene,
  rewriting,
  rewriteDisabled,
}: {
  index: number
  scene: Scene
  onKoreanChange: (value: string) => void
  onSubtitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onRevertKorean: () => void
  onRewriteScene: () => void
  rewriting: boolean
  rewriteDisabled: boolean
}) {
  const stale = englishIsStale(scene)

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <Card.Title>씬 {index + 1}</Card.Title>
        <Chip size="sm" color={stale ? "warning" : "success"} variant="soft">
          {stale ? "이 씬 영어만 다시 필요" : "영어 맞음"}
        </Chip>
      </Card.Header>
      <Card.Content className="grid gap-4 md:grid-cols-2">
        <TextField value={scene.scriptKo} onChange={onKoreanChange} fullWidth>
          <Label>한국어</Label>
          <TextArea rows={4} />
        </TextField>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">영어 나레이션</p>
          <p className="text-sm leading-6">{scene.scriptTarget}</p>
          <TextField
            value={typeof scene.subtitle === "string" ? scene.subtitle : defaultSubtitle(scene.scriptTarget)}
            onChange={onSubtitleChange}
            fullWidth
          >
            <Label>자막</Label>
            <TextArea rows={4} />
          </TextField>
          <p className="text-xs text-muted">한 줄이 화면에 나오는 자막 한 줄입니다.</p>
          {stale ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-warning">
                영어 맞추기를 누르면 이 씬만 다시 번역되고, 자막 줄은 새 영어 기준으로 다시 나뉩니다.
              </p>
              <div className="flex gap-2">
                <Button size="sm" isDisabled={rewriteDisabled} onPress={onRewriteScene}>
                  {rewriting ? "맞추는 중" : "영어 맞추기"}
                </Button>
                <Button size="sm" variant="outline" isDisabled={rewriteDisabled} onPress={onRevertKorean}>
                  한국어 되돌리기
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="md:col-span-2">
          <TextField value={scene.sceneDescription} onChange={onDescriptionChange} fullWidth>
            <Label>화면 설명</Label>
            <TextArea rows={2} />
          </TextField>
        </div>
      </Card.Content>
    </Card>
  )
}
