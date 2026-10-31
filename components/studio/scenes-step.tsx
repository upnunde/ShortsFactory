"use client"

import { Button, Card, Chip } from "@heroui/react"
import { StepActions, StepHeader } from "@/components/studio/chrome"
import { OutfitUsage } from "@/components/studio/outfit-choice"
import {
  englishIsStale,
  sceneReady,
  visualReady,
  voiceReady,
} from "@/lib/scene-status"
import { formatSeconds, narrationSeconds, subtitleCues } from "@/lib/timing"
import { buildScenePrompt } from "@/lib/style"
import type { Scene } from "@/lib/types"

export function ScenesStep({
  scenes,
  anchor,
  onRegenVisual,
  onRegenVoice,
  onBack,
  onMakeFilm,
  outfitId,
}: {
  scenes: Scene[]
  anchor: string
  onRegenVisual: (sceneId: string) => void
  onRegenVoice: (sceneId: string) => void
  onBack: () => void
  onMakeFilm: () => void
  outfitId: string | null
}) {
  const readyCount = scenes.filter(sceneReady).length
  const blocked = readyCount !== scenes.length

  return (
    <>
      <StepHeader
        title="씬 검수"
        description="어색한 씬만 다시 만듭니다. 화면과 음성은 따로 고치고, 자막은 그 씬 음성을 따라갑니다. 파일 생성은 아직 연결 전이라, 이 화면은 어떤 씬을 다시 만들지 고르는 자리입니다."
      />

      <OutfitUsage outfitId={outfitId} />

      <div className="flex flex-col gap-4">
        {scenes.map((scene, index) => (
          <SceneMediaCard
            key={scene.id}
            index={index}
            scene={scene}
            anchor={anchor}
            onRegenVisual={() => onRegenVisual(scene.id)}
            onRegenVoice={() => onRegenVoice(scene.id)}
          />
        ))}
      </div>

      <StepActions
        onBack={onBack}
        nextLabel="영상 만들기"
        onNext={onMakeFilm}
        nextDisabled={blocked}
        note={
          blocked
            ? `${readyCount}/${scenes.length} 씬이 준비됐습니다. 나머지를 맞춘 뒤 하나로 합칩니다.`
            : "준비한 씬을 음성·자막과 함께 하나의 쇼츠로 합칩니다."
        }
      />
    </>
  )
}

function SceneMediaCard({
  index,
  scene,
  anchor,
  onRegenVisual,
  onRegenVoice,
}: {
  index: number
  scene: Scene
  anchor: string
  onRegenVisual: () => void
  onRegenVoice: () => void
}) {
  const staleEnglish = englishIsStale(scene)
  const picture = visualReady(scene)
  const spoken = voiceReady(scene)
  const lines = subtitleCues(scene.subtitle, scene.scriptTarget)

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <Card.Title>
          씬 {index + 1}
          <span className="ml-2 text-sm font-normal text-muted">
            {formatSeconds(narrationSeconds(scene.scriptTarget))}
          </span>
        </Card.Title>
        <Chip size="sm" color={picture && spoken ? "success" : "warning"} variant="soft">
          {picture && spoken ? "준비됨" : "다시 필요"}
        </Chip>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-row items-start gap-4">
          <div className="flex aspect-[9/16] w-48 shrink-0 items-center justify-center rounded-lg bg-surface-secondary px-2 text-center text-xs text-muted">
            {picture ? "화면 자리" : "화면 없음"}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-sm">{scene.scriptKo}</p>
          <p className="text-sm text-muted">{scene.scriptTarget}</p>
          <div className="flex flex-col gap-1 rounded-lg bg-surface-secondary px-3 py-2">
            <p className="text-xs text-muted">자막</p>
            {lines.map((line, lineIndex) => (
              <p key={`${lineIndex}-${line}`} className="text-sm">
                {line}
              </p>
            ))}
          </div>
          <p className="text-xs text-muted">{buildScenePrompt(anchor, scene.sceneDescription)}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" isDisabled={staleEnglish} onPress={onRegenVisual}>
              화면만 다시
            </Button>
            <Button variant="outline" isDisabled={staleEnglish} onPress={onRegenVoice}>
              음성·자막만 다시
            </Button>
          </div>
          {staleEnglish ? (
            <p className="text-sm text-warning">대본에서 이 씬 영어를 맞춘 뒤에 다시 만들 수 있습니다.</p>
          ) : null}
        </div>
        </div>
      </Card.Content>
    </Card>
  )
}
