"use client"

import { useEffect, useState } from "react"

import { AlertDialog, Button, Card, Chip } from "@heroui/react"
import { Trash2 } from "lucide-react"
import type { NewsHistoryEntry } from "@/lib/news-clips/history"
import { NEWS_CLIP_STEPS } from "@/lib/news-clips/types"

export function NewsHistoryPanel({
  profileId,
  currentId,
  onOpen,
}: {
  profileId: string
  currentId: string
  onOpen: (id: string) => void | Promise<void>
}) {
  const [items, setItems] = useState<NewsHistoryEntry[]>([])
  const [opening, setOpening] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<NewsHistoryEntry | null>(
    null
  )
  const [note, setNote] = useState("")

  useEffect(() => {
    let stopped = false
    void fetch(
      `/api/news-clips/history?profileId=${encodeURIComponent(profileId)}`
    )
      .then(async (response) => {
        const body = (await response.json()) as { items?: NewsHistoryEntry[] }
        if (stopped) return
        if (!response.ok || !Array.isArray(body.items)) {
          setNote("불러오지 못했습니다.")
          return
        }
        setItems(body.items)
        setNote("")
      })
      .catch(() => !stopped && setNote("불러오지 못했습니다."))
    return () => {
      stopped = true
    }
  }, [profileId])

  async function open(id: string) {
    setOpening(id)
    setNote("")
    try {
      await onOpen(id)
    } catch {
      setNote("불러오지 못했습니다.")
    } finally {
      setOpening("")
    }
  }

  async function remove() {
    if (!confirmDelete) return
    setDeleting(true)
    setNote("")
    try {
      const response = await fetch(
        `/api/news-clips/history/${encodeURIComponent(confirmDelete.id)}?profileId=${encodeURIComponent(profileId)}`,
        { method: "DELETE" }
      )
      if (!response.ok) {
        setNote("삭제하지 못했습니다.")
        return
      }
      setItems((current) =>
        current.filter((item) => item.id !== confirmDelete.id)
      )
      setConfirmDelete(null)
    } catch {
      setNote("삭제하지 못했습니다.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pt-6">
      <header className="shrink-0 border-b border-separator pb-4">
        <h2 className="text-xl leading-7 font-semibold">히스토리</h2>
      </header>
      {note ? <p className="text-sm text-warning">{note}</p> : null}
      <section className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <Card
            key={item.id}
            role="button"
            tabIndex={0}
            aria-label={`${item.title} 불러오기`}
            className="cursor-pointer transition hover:border-foreground/25 hover:shadow-md focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:outline-none"
            onClick={() => {
              if (!deleting) void open(item.id)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                if (!deleting) void open(item.id)
              }
            }}
          >
            <Card.Header className="relative pr-14">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Card.Title className="truncate">{item.title}</Card.Title>
                  <Chip
                    size="sm"
                    color={item.finalized ? "success" : "default"}
                    variant="soft"
                    className="shrink-0"
                  >
                    {item.finalized ? "최종" : `${stepNumber(item.step)}단계`}
                  </Chip>
                  {item.id === currentId ? (
                    <Chip size="sm" variant="soft" className="shrink-0">
                      현재
                    </Chip>
                  ) : null}
                </div>
                <Card.Description>
                  {item.finalized ? "완료 " : "수정 "}
                  {formatWhen(
                    item.finalized && item.completedAt
                      ? item.completedAt
                      : item.updatedAt
                  )}
                  {showRecentEdit(item)
                    ? ` · 최근 수정 ${formatWhen(item.updatedAt)}`
                    : ""}
                  {item.durationSeconds > 0
                    ? ` · ${item.durationSeconds.toFixed(1)}초`
                    : ""}
                </Card.Description>
              </div>
              <div
                className="absolute top-3 right-3"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label="삭제"
                  isDisabled={deleting || opening !== ""}
                  onPress={() => setConfirmDelete(item)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </Card.Header>
          </Card>
        ))}
      </section>

      <AlertDialog
        isOpen={confirmDelete !== null}
        onOpenChange={(open) => !open && !deleting && setConfirmDelete(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container placement="center">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>삭제할까요?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                저장된 작업과 완성 영상이 함께 삭제됩니다.
              </AlertDialog.Body>
              <AlertDialog.Footer className="justify-end">
                <Button
                  variant="outline"
                  isDisabled={deleting}
                  onPress={() => setConfirmDelete(null)}
                >
                  취소
                </Button>
                <Button
                  variant="danger"
                  isDisabled={deleting}
                  onPress={() => void remove()}
                >
                  {deleting ? "삭제 중" : "삭제"}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  )
}

function stepNumber(step: NewsHistoryEntry["step"]) {
  return Math.max(1, NEWS_CLIP_STEPS.findIndex((item) => item.id === step) + 1)
}

function formatWhen(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function showRecentEdit(item: NewsHistoryEntry) {
  if (!item.finalized || !item.completedAt) return false
  const completed = new Date(item.completedAt)
  const updated = new Date(item.updatedAt)
  if (Number.isNaN(completed.getTime()) || Number.isNaN(updated.getTime())) {
    return false
  }
  return updated.getTime() - completed.getTime() >= 60_000
}
