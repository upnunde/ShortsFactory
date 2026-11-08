"use client"

import { Button, Card } from "@heroui/react"
import {
  LoadingButtonLabel,
  busyMatches,
  buttonBusyDisabled,
} from "@/components/news-clips/loading-button-label"
import {
  angleHasLockedRange,
  type NewsAngleOption,
} from "@/lib/news-clips/angles"

export function NewsClipAnglesStep({
  angles,
  selectedAngleId,
  sourceTitle,
  busy,
  note,
  onBack,
  onSelect,
  onCancelSelection,
}: {
  angles: NewsAngleOption[]
  selectedAngleId: string
  sourceTitle?: string
  busy: string
  note: string
  onBack: () => void
  onSelect: (angle: NewsAngleOption) => void
  onCancelSelection: () => void
}) {
  const selecting = busy.startsWith("select-angle:")

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
          {angles.map((angle, index) => {
            const active = selectedAngleId === angle.id
            const angleBusyKey = `select-angle:${angle.id}`
            const loading = busyMatches(busy, angleBusyKey)
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
                {angle.evidence ? (
                  <blockquote className="mt-3 rounded-lg bg-default px-3 py-2 text-sm leading-6">
                    “{angle.evidence}”
                  </blockquote>
                ) : null}
                {angleHasLockedRange(angle) ? (
                  <p className="mt-2 text-xs text-muted tabular-nums">
                    원본 구간 {formatClock(angle.sourceStart)}–
                    {formatClock(angle.sourceEnd)}
                  </p>
                ) : null}
                {angle.keywords.length ? (
                  <p className="mt-3 text-xs text-muted">
                    {angle.keywords.join(" · ")}
                  </p>
                ) : null}
                <div className="mt-4 flex justify-end">
                  <Button
                    size="sm"
                    isDisabled={buttonBusyDisabled(busy, angleBusyKey)}
                    onPress={() => onSelect(angle)}
                  >
                    <LoadingButtonLabel
                      loading={loading}
                      label="이 내용으로 초안 만들기"
                      loadingLabel={
                        busy.endsWith(":preview")
                          ? "초안 영상 만드는 중"
                          : busy.endsWith(":script")
                            ? "대본 준비 중"
                            : "초안 만드는 중"
                      }
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
        <Card.Footer className="justify-between">
          <Button variant="outline" isDisabled={selecting} onPress={onBack}>
            이전
          </Button>
          {selecting || selectedAngleId ? (
            <Button variant="outline" onPress={onCancelSelection}>
              선택 취소
            </Button>
          ) : null}
        </Card.Footer>
      </Card>
    </>
  )
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}
