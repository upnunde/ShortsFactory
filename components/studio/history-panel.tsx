"use client"

import { useEffect, useState } from "react"

import { AlertDialog, Button, Card, Chip, Modal } from "@heroui/react"
import { Trash2 } from "lucide-react"
import { StepHeader } from "@/components/studio/chrome"
import {
  HISTORY_BADGE_LABEL,
  historyBadge,
  type HistoryEntry,
} from "@/lib/history"
import type { Scene, StudioState } from "@/lib/types"

type ScriptPreview = {
  topic: string
  lines: { ko: string; en: string }[]
}

export function HistoryPanel({
  currentId,
  profileId,
  onOpen,
}: {
  currentId: string
  profileId: string
  onOpen: (id: string) => void | Promise<void>
}) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState("")
  const [opening, setOpening] = useState("")
  const [previewBusy, setPreviewBusy] = useState("")
  const [preview, setPreview] = useState<ScriptPreview | null>(null)
  const [previewError, setPreviewError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<HistoryEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let stop = false
    async function load() {
      try {
        const response = await fetch(
          `/api/history?profileId=${encodeURIComponent(profileId)}`
        )
        const body = (await response.json()) as { items?: HistoryEntry[] }
        if (stop) {
          return
        }
        if (!response.ok || !body.items) {
          setError("히스토리를 읽지 못했습니다.")
          setItems([])
          return
        }
        setError("")
        setItems(body.items)
      } catch {
        if (!stop) {
          setError("히스토리를 읽지 못했습니다.")
          setItems([])
        }
      }
    }
    void load()
    const timer = window.setTimeout(() => void load(), 800)
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [currentId, profileId])

  async function openScript(item: HistoryEntry) {
    setPreviewBusy(item.id)
    setPreviewError("")
    try {
      const response = await fetch(`/api/history/${item.id}`)
      const body = (await response.json()) as { studio?: StudioState }
      if (!response.ok || !body.studio) {
        setPreviewError("대본을 읽지 못했습니다.")
        setPreview({ topic: item.topic, lines: [] })
        return
      }
      setPreview({
        topic: item.topic,
        lines: scriptLines(body.studio.project.scenes),
      })
    } catch {
      setPreviewError("대본을 읽지 못했습니다.")
      setPreview({ topic: item.topic, lines: [] })
    } finally {
      setPreviewBusy("")
    }
  }

  async function removeItem() {
    if (!confirmDelete) {
      return
    }
    setDeleting(true)
    setError("")
    try {
      const response = await fetch(`/api/history/${confirmDelete.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        setError("작업을 삭제하지 못했습니다.")
        return
      }
      setItems((current) =>
        (current ?? []).filter((item) => item.id !== confirmDelete.id)
      )
      setConfirmDelete(null)
    } catch {
      setError("작업을 삭제하지 못했습니다.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <StepHeader
        title="히스토리"
        description="대본은 고치는 동안 이 컴퓨터에 저장되고, 영상이 합쳐지면 그 작업 옆에 같이 남습니다. 불러오면 그때의 대본과 영상이 다시 열립니다."
      />
      {error ? <p className="text-sm text-warning">{error}</p> : null}
      {items && items.length === 0 ? (
        <p className="text-sm text-muted">아직 저장된 작업이 없습니다.</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {items?.map((item) => (
          <Card key={item.id}>
            <Card.Header className="flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Card.Title className="truncate">{item.topic}</Card.Title>
                  <Chip
                    size="sm"
                    color={badgeColor(historyBadge(item))}
                    variant="soft"
                    className="shrink-0"
                  >
                    {HISTORY_BADGE_LABEL[historyBadge(item)]}
                  </Chip>
                </div>
                <Card.Description>
                  {formatWhen(item.updatedAt)}
                </Card.Description>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={previewBusy === item.id}
                  onPress={() => void openScript(item)}
                >
                  대본
                </Button>
                <Button
                  size="sm"
                  isDisabled={opening === item.id}
                  onPress={() => {
                    setOpening(item.id)
                    void Promise.resolve(onOpen(item.id)).finally(() =>
                      setOpening("")
                    )
                  }}
                >
                  불러오기
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label="삭제"
                  isDisabled={deleting}
                  onPress={() => setConfirmDelete(item)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </Card.Header>
          </Card>
        ))}
      </div>

      <AlertDialog
        isOpen={confirmDelete !== null}
        onOpenChange={(open) => !open && !deleting && setConfirmDelete(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container placement="center">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>이 작업을 삭제할까요?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {confirmDelete
                  ? `"${confirmDelete.topic}" 대본과 저장된 영상이 함께 삭제됩니다.`
                  : "선택한 작업이 삭제됩니다."}
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
                  onPress={() => void removeItem()}
                >
                  삭제
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <Modal
        isOpen={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null)
            setPreviewError("")
          }
        }}
      >
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="lg" scroll="inside">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>대본</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <p className="truncate text-sm text-muted">{preview?.topic}</p>
                {previewError ? (
                  <p className="text-sm text-warning">{previewError}</p>
                ) : null}
                {!previewError && preview?.lines.length === 0 ? (
                  <p className="text-sm text-muted">저장된 대본이 없습니다.</p>
                ) : null}
                <ol className="flex flex-col gap-4">
                  {preview?.lines.map((line, index) => (
                    <li key={index} className="flex flex-col gap-1">
                      <p className="text-xs text-muted">{index + 1}</p>
                      <p className="text-sm break-keep">{line.ko}</p>
                      {line.en ? (
                        <p className="text-sm break-keep text-muted">
                          {line.en}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </Modal.Body>
              <Modal.Footer className="justify-end">
                <Button
                  variant="outline"
                  onPress={() => {
                    setPreview(null)
                    setPreviewError("")
                  }}
                >
                  닫기
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  )
}

function badgeColor(badge: ReturnType<typeof historyBadge>) {
  if (badge === "upload") {
    return "success" as const
  }
  if (badge === "film") {
    return "accent" as const
  }
  return "default" as const
}

function scriptLines(scenes: Scene[] | undefined) {
  if (!Array.isArray(scenes)) {
    return []
  }
  return scenes
    .map((scene) => ({
      ko: (scene.approvedKo || scene.scriptKo || "").trim(),
      en: (scene.scriptTarget || "").trim(),
    }))
    .filter((line) => line.ko || line.en)
}

function formatWhen(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return date.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
