"use client"

import { useRef, useState } from "react"
import { Button, Card } from "@heroui/react"
import {
  LoadingButtonLabel,
  busyMatches,
} from "@/components/news-clips/loading-button-label"
import { HistorySaveButton } from "@/components/news-clips/history-save-button"
import {
  stepBodyClassName,
  stepHeaderActionButtonClassName,
  stepHeaderActionsClassName,
  stepHeaderClassName,
  type WorkspaceHistorySaveProps,
} from "@/components/news-clips/step-action-bar"
import {
  angleHasLockedRange,
  includeLeadingContext,
  lockAngleRangeToTranscript,
  transcriptForAngle,
  type NewsAngleOption,
} from "@/lib/news-clips/angles"
import { snapSourceRangeToCompleteUtterance } from "@/lib/news-clips/speech-bounds"
import type {
  NewsSourceSelectionMode,
  TranscriptSegment,
} from "@/lib/news-clips/types"

export function NewsClipAnglesStep({
  angles,
  transcript,
  selectedAngleId,
  sourceSelectionMode,
  sourceOverview,
  sourceId,
  sourceDuration,
  sourceTitle,
  busy,
  note,
  progress,
  onRetry,
  onChoose,
  onCancelSelection,
  historySave,
}: {
  angles: NewsAngleOption[]
  transcript: TranscriptSegment[]
  selectedAngleId: string
  sourceSelectionMode: NewsSourceSelectionMode
  sourceOverview: string
  sourceId: string
  sourceDuration: number
  sourceTitle?: string
  busy: string
  note: string
  progress: number | null
  onRetry: () => void
  onChoose: (angle: NewsAngleOption) => void
  onCancelSelection: () => void
  historySave: WorkspaceHistorySaveProps
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [previewRange, setPreviewRange] = useState<{
    angleId: string
    rangeId: string
    start: number
    end: number
  } | null>(null)
  const isVideoSummary = sourceSelectionMode === "video-summary"
  const completedAngles = angles.map((angle) =>
    isVideoSummary
      ? completeSummaryAngleForTranscript(angle, transcript)
      : completeAngleForTranscript(angle, transcript)
  )
  const analyzing = completedAngles.length === 0 && busy !== ""
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header className={stepHeaderClassName}>
        <h2 className="truncate text-xl leading-7 font-semibold">
          {isVideoSummary ? "영상 요약 후보" : "핵심 내용 확인"}
        </h2>
        <div className={stepHeaderActionsClassName}>
          {note ? <p className="text-sm text-muted">{note}</p> : null}
          <HistorySaveButton
            {...historySave}
            className={stepHeaderActionButtonClassName}
          />
          {completedAngles.length === 0 ? (
            <Button
              className={stepHeaderActionButtonClassName}
              isDisabled={analyzing}
              onPress={onRetry}
            >
              <LoadingButtonLabel
                loading={analyzing}
                label="다시 분석"
                loadingLabel="핵심 내용 분석 중"
              />
            </Button>
          ) : null}
        </div>
      </header>
      <div className={stepBodyClassName}>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-6">
        {sourceTitle ? (
          <p className="truncate text-sm text-muted">{sourceTitle}</p>
        ) : null}

        {isVideoSummary && sourceOverview ? (
          <Card>
            <Card.Header className="border-b border-separator pb-4">
              <Card.Title>전체 내용 요약</Card.Title>
            </Card.Header>
            <Card.Content className="pt-4">
              <p className="text-sm leading-7 whitespace-pre-wrap">
                {sourceOverview}
              </p>
            </Card.Content>
          </Card>
        ) : null}

        <Card>
          <Card.Content
            className={`grid gap-3 pt-4 ${isVideoSummary ? "grid-cols-1" : "md:grid-cols-2"}`}
          >
            {completedAngles.length === 0
              ? [1, 2].map((index) => (
                  <div
                    key={index}
                    className="flex min-h-64 flex-col rounded-xl border border-dashed border-separator p-4"
                  >
                    <p className="text-xs text-muted">{index}</p>
                    <p className="mt-1 text-base leading-6 font-medium text-muted">
                      핵심 내용 후보
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      원본 분석 후 제목과 요약이 표시됩니다.
                    </p>
                    <section className="mt-4 border-t border-separator pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-muted">
                          사용 구간 전체 내용
                        </h3>
                        <span className="text-xs text-muted tabular-nums">
                          0:00–0:00
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-7 text-muted">
                        선택할 영상 구간의 원문이 여기에 표시됩니다.
                      </p>
                    </section>
                    <div className="mt-auto flex justify-end pt-4">
                      <Button size="sm" isDisabled>
                        선택
                      </Button>
                    </div>
                  </div>
                ))
              : completedAngles.map((angle, index) => {
                  const active = selectedAngleId === angle.id
                  const angleBusy = busyMatches(
                    busy,
                    `select-angle:${angle.id}`
                  )
                  const usedTranscript = transcriptForAngle(angle, transcript)
                  const summaryRanges = angle.ranges ?? []
                  return (
                    <div
                      key={angle.id}
                      className={`rounded-xl border p-4 ${
                        active
                          ? "border-foreground bg-default"
                          : "border-separator"
                      }`}
                    >
                      <p className="text-xs text-muted">{index + 1}</p>
                      <p className="mt-1 text-base leading-6 font-medium">
                        {angle.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-muted">
                        {angle.summary}
                      </p>
                      {isVideoSummary && summaryRanges.length ? (
                        <section className="mt-4 border-t border-separator pt-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold">
                              조립할 핵심 구간
                            </h3>
                            <span className="shrink-0 text-xs text-muted tabular-nums">
                              {summaryRanges.length}개 · 약{" "}
                              {formatDuration(
                                angle.estimatedDurationSeconds ??
                                  summaryRanges.reduce(
                                    (total, range) =>
                                      total +
                                      range.sourceEnd -
                                      range.sourceStart,
                                    0
                                  )
                              )}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-col gap-2">
                            {summaryRanges.map((range, rangeIndex) => (
                              <div
                                key={range.id}
                                className="grid gap-3 rounded-xl border border-separator p-3 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center"
                              >
                                <RangeThumbnail
                                  sourceId={sourceId}
                                  sourceDuration={sourceDuration}
                                  start={range.sourceStart}
                                />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">
                                    {rangeIndex + 1}. {range.label}
                                  </p>
                                  <p className="mt-1 text-xs leading-5 text-muted">
                                    {range.evidence || range.summary}
                                  </p>
                                </div>
                                <div className="flex items-center justify-end gap-2 sm:flex-col sm:items-end">
                                  <span className="text-xs text-muted tabular-nums">
                                    {formatClock(range.sourceStart)}–
                                    {formatClock(range.sourceEnd)}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    isDisabled={!sourceId}
                                    onPress={() =>
                                      setPreviewRange({
                                        angleId: angle.id,
                                        rangeId: range.id,
                                        start: range.sourceStart,
                                        end: range.sourceEnd,
                                      })
                                    }
                                  >
                                    재생
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                          {previewRange?.angleId === angle.id && sourceId ? (
                            <video
                              ref={videoRef}
                              key={`${sourceId}-${previewRange.rangeId}`}
                              src={`/api/news-clips/source-file?sourceId=${encodeURIComponent(sourceId)}`}
                              controls
                              autoPlay
                              playsInline
                              preload="metadata"
                              className="mt-3 aspect-video w-full rounded-xl bg-black"
                              onLoadedMetadata={(event) => {
                                event.currentTarget.currentTime =
                                  previewRange.start
                                void event.currentTarget
                                  .play()
                                  .catch(() => undefined)
                              }}
                              onTimeUpdate={(event) => {
                                if (
                                  event.currentTarget.currentTime >=
                                  previewRange.end
                                ) {
                                  event.currentTarget.pause()
                                }
                              }}
                            />
                          ) : null}
                        </section>
                      ) : angleHasLockedRange(angle) ? (
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
                            label={
                              active
                                ? "다시 시도"
                                : isVideoSummary
                                  ? "이 요약으로 만들기"
                                  : "선택"
                            }
                            loadingLabel="준비 중 · 취소"
                            progress={angleBusy ? progress : null}
                          />
                        </Button>
                      </div>
                    </div>
                  )
                })}
          </Card.Content>
        </Card>
        </div>
      </div>
    </div>
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

function completeSummaryAngleForTranscript(
  angle: NewsAngleOption,
  transcript: TranscriptSegment[]
) {
  // 영상 요약 API에서 이미 전체 전사의 발화 경계로 확정한 구간이다.
  // 여기서 다시 문장 완결 구간으로 늘리면 서로 떨어진 핵심 구간이
  // 중첩되거나 UI에서 본 범위와 실제 제작 범위가 달라질 수 있어 값을 그대로 유지한다.
  const ranges = (angle.ranges ?? [])
    .filter(
      (range) =>
        Number.isFinite(range.sourceStart) &&
        Number.isFinite(range.sourceEnd) &&
        range.sourceEnd > range.sourceStart
    )
    .toSorted(
      (left, right) =>
        left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    )
  const first = ranges[0]
  const last = ranges.at(-1)
  if (!first || !last) return completeAngleForTranscript(angle, transcript)
  return {
    ...angle,
    sourceStart: first.sourceStart,
    sourceEnd: last.sourceEnd,
    ranges,
    estimatedDurationSeconds:
      Math.round(
        ranges.reduce(
          (total, range) => total + range.sourceEnd - range.sourceStart,
          0
        ) * 100
      ) / 100,
  }
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

function formatDuration(seconds: number) {
  const total = Math.max(1, Math.round(seconds))
  if (total < 60) return `${total}초`
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return remainder ? `${minutes}분 ${remainder}초` : `${minutes}분`
}

function RangeThumbnail({
  sourceId,
  sourceDuration,
  start,
}: {
  sourceId: string
  sourceDuration: number
  start: number
}) {
  if (!sourceId || sourceDuration <= 0) {
    return <div className="aspect-video w-24 rounded-lg bg-default" />
  }
  const frame = Math.max(
    0,
    Math.min(7, Math.floor((start / sourceDuration) * 8))
  )
  return (
    <div
      aria-label={`${formatClock(start)} 시작 장면`}
      className="aspect-video w-24 rounded-lg bg-default bg-no-repeat"
      style={{
        backgroundImage: `url(/api/news-clips/timeline-strip?sourceId=${encodeURIComponent(sourceId)})`,
        backgroundSize: "800% 100%",
        backgroundPosition: `${(frame / 7) * 100}% center`,
      }}
    />
  )
}
