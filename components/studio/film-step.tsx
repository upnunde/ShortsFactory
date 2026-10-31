"use client"

import { Card, Chip } from "@heroui/react"
import { StepActions, StepHeader } from "@/components/studio/chrome"
import { OutfitUsage } from "@/components/studio/outfit-choice"
import { filmReady, projectSeconds } from "@/lib/scene-status"
import { formatSeconds, narrationSeconds } from "@/lib/timing"
import type { Project } from "@/lib/types"

export function FilmStep({
  project,
  onBack,
  onNext,
}: {
  project: Project
  onBack: () => void
  onNext: () => void
}) {
  const ready = filmReady(project)
  const seconds = projectSeconds(project.scenes)

  return (
    <>
      <StepHeader
        title="영상"
        description="씬을 이어 붙인 최종 쇼츠입니다. 목소리와 자막이 같은 시간에 들어갑니다."
      />

      <OutfitUsage outfitId={project.outfitId} />

      <Card>
        <Card.Header className="flex-row items-center justify-between gap-3">
          <div>
            <Card.Title>outputs/final_shorts.mp4</Card.Title>
            <Card.Description>9:16 · 약 {formatSeconds(seconds)}</Card.Description>
          </div>
          <Chip size="sm" color={ready ? "success" : "warning"} variant="soft">
            {ready ? "합쳐짐" : "아직 없음"}
          </Chip>
        </Card.Header>
        <Card.Content className="flex flex-col items-center gap-4">
          <div className="flex aspect-[9/16] w-full max-w-xs items-center justify-center rounded-lg bg-surface-secondary px-6 text-center text-sm text-muted">
            {ready ? "최종 영상 자리" : "씬 검수 뒤 영상 만들기를 누르면 여기에 붙습니다."}
          </div>
          <ol className="flex w-full flex-col gap-2 text-sm">
            {project.scenes.map((scene, index) => (
              <li key={scene.id} className="flex justify-between gap-4">
                <span>
                  {index + 1}. {scene.scriptTarget}
                </span>
                <span className="shrink-0 text-muted">
                  {formatSeconds(narrationSeconds(scene.scriptTarget))}
                </span>
              </li>
            ))}
          </ol>
        </Card.Content>
      </Card>

      <StepActions
        onBack={onBack}
        nextLabel="업로드"
        onNext={onNext}
        nextDisabled={!ready}
        note={
          ready
            ? project.autoUpload
              ? "자동 업로드가 켜져 있습니다. 켠 채널이 유튜브, 인스타그램, 틱톡이면 그곳으로 올립니다."
              : "파일을 확인한 뒤 업로드 화면에서 직접 올립니다."
            : "씬이 준비된 뒤 영상 만들기를 누르면 이 화면이 채워집니다."
        }
      />
    </>
  )
}
