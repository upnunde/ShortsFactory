"use client"

import { Button, Card } from "@heroui/react"
import {
  LoadingButtonLabel,
  busyMatches,
} from "@/components/news-clips/loading-button-label"
import {
  angleHasLockedRange,
  includeLeadingContext,
  lockAngleRangeToTranscript,
  transcriptForAngle,
  type NewsAngleOption,
} from "@/lib/news-clips/angles"
import { snapSourceRangeToCompleteUtterance } from "@/lib/news-clips/speech-bounds"
import type { TranscriptSegment } from "@/lib/news-clips/types"

export function NewsClipAnglesStep({
  angles,
  transcript,
  selectedAngleId,
  sourceTitle,
  busy,
  note,
  onBack,
  onChoose,
  onCancelSelection,
}: {
  angles: NewsAngleOption[]
  transcript: TranscriptSegment[]
  selectedAngleId: string
  sourceTitle?: string
  busy: string
  note: string
  onBack: () => void
  onChoose: (angle: NewsAngleOption) => void
  onCancelSelection: () => void
}) {
  const selecting = busy.startsWith("select-angle:")
  const completedAngles = angles.map((angle) =>
    completeAngleForTranscript(angle, transcript)
  )
  return (
    <>
      <header>
        <h2 className="text-xl font-semibold">핵심 내용 확인</h2>
        {sourceTitle ? (
          <p className="mt-1 truncate text-sm text-muted">{sourceTitle}</p>
        ) : null}
      </header>

      <Card>
        <Card.Content className="grid gap-3 pt-4 md:grid-cols-2">
          {completedAngles.map((angle, index) => {
            const active = selectedAngleId === angle.id
            const angleBusy = busyMatches(
              busy,
              `select-angle:${angle.id}`
            )
            const usedTranscript = transcriptForAngle(angle, transcript)
            return (
              <div
                key={angle.id}
                className={`rounded-xl border p-4 ${
                  active ? "border-foreground bg-default" : "border-separator"
                }`}
              >
                <p className="text-xs text-muted">{index + 1}</p>
                <p className="mt-1 text-base leading-6 font-medium">
                  {angle.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {angle.summary}
                </p>
                {angleHasLockedRange(angle) ? (
                  <section className="mt-4 border-t border-separator pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">
                        사용 구간 전체 내용
                      </h3>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {formatClock(angle.sourceStart)}–
                        {formatClock(angle.sourceEnd)}
                      </span>
                    </div>
                    {usedTranscript.length ? (
                      <p className="mt-3 text-sm leading-7 whitespace-pre-wrap">
                        {transcriptAsProse(usedTranscript)}
                      </p>
                    ) : null}
                  </section>
                ) : null}
                {angle.keywords.length ? (
                  <p className="mt-3 text-xs text-muted">
                    {angle.keywords.join(" · ")}
                  </p>
                ) : null}
                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    variant={active ? "outline" : "primary"}
                    isDisabled={Boolean(busy) && !angleBusy}
                    onPress={() =>
                      angleBusy ? onCancelSelection() : onChoose(angle)
                    }
                  >
                    <LoadingButtonLabel
                      loading={angleBusy}
                      label={active ? "다시 시도" : "선택"}
                      loadingLabel="준비 중 · 취소"
                    />
                  </Button>
                </div>
              </div>
            )
          })}
        </Card.Content>
        {note ? (
          <Card.Content>
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              {note}
            </div>
          </Card.Content>
        ) : null}
        <Card.Footer>
          <Button variant="outline" isDisabled={selecting} onPress={onBack}>
            이전
          </Button>
        </Card.Footer>
      </Card>
    </>
  )
}

function completeAngleForTranscript(
  angle: NewsAngleOption,
  transcript: TranscriptSegment[]
) {
  const range = snapSourceRangeToCompleteUtterance(
    angle.sourceStart,
    angle.sourceEnd,
    transcript
  )
  return includeLeadingContext(
    lockAngleRangeToTranscript(
      { ...angle, sourceStart: range.start, sourceEnd: range.end },
      transcript
    ),
    transcript
  )
}

function transcriptAsProse(transcript: TranscriptSegment[]) {
  return transcript
    .map((segment) => segment.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}
