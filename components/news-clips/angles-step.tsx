"use client"

import { Button, Card } from "@heroui/react"
import {
  LoadingButtonLabel,
  busyMatches,
  buttonBusyDisabled,
} from "@/components/news-clips/loading-button-label"
import type { NewsAngleOption } from "@/lib/news-clips/angles"

export function NewsClipAnglesStep({
  angles,
  selectedAngleId,
  sourceTitle,
  busy,
  note,
  onBack,
  onSelect,
}: {
  angles: NewsAngleOption[]
  selectedAngleId: string
  sourceTitle?: string
  busy: string
  note: string
  onBack: () => void
  onSelect: (angle: NewsAngleOption) => void
}) {
  const selecting = busy.startsWith("select-angle:")

  return (
    <>
      <header>
        <h2 className="text-xl font-semibold">주제 고르기</h2>
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
                      label="이 내용으로"
                      loadingLabel={
                        busy.endsWith(":script") ? "대본 작성 중" : "구성 중"
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
        </Card.Footer>
      </Card>
    </>
  )
}
