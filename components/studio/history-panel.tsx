"use client"

import { useEffect, useState } from "react"

import { Button, Card, Chip } from "@heroui/react"
import { StepHeader } from "@/components/studio/chrome"
import type { HistoryEntry } from "@/lib/history"

export function HistoryPanel({
  currentId,
  onOpen,
}: {
  currentId: string
  onOpen: (id: string) => void | Promise<void>
}) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState("")
  const [opening, setOpening] = useState("")

  useEffect(() => {
    let stop = false
    async function load() {
      try {
        const response = await fetch("/api/history")
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
  }, [currentId])

  return (
    <>
      <StepHeader
        title="히스토리"
        description="대본은 고치는 동안 이 컴퓨터에 저장되고, 영상이 합쳐지면 그 작업 옆에 같이 남습니다. 불러오면 그때의 대본과 영상이 다시 열립니다."
      />
      {error ? <p className="text-sm text-warning">{error}</p> : null}
      {items && items.length === 0 ? <p className="text-sm text-muted">아직 저장된 작업이 없습니다.</p> : null}
      <div className="flex flex-col gap-3">
        {items?.map((item) => (
          <Card key={item.id}>
            <Card.Header className="flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <Card.Title className="truncate">{item.topic}</Card.Title>
                <Card.Description>{formatWhen(item.updatedAt)}</Card.Description>
              </div>
              <Chip size="sm" color={item.hasVideo ? "success" : "default"} variant="soft">
                {item.hasVideo ? "영상 있음" : "대본"}
              </Chip>
            </Card.Header>
            <Card.Footer className="flex items-center justify-between gap-3">
              {item.id === currentId ? <span className="text-sm text-muted">지금 연 작업</span> : <span />}
              <Button
                size="sm"
                isDisabled={opening === item.id}
                onPress={() => {
                  setOpening(item.id)
                  void Promise.resolve(onOpen(item.id)).finally(() => setOpening(""))
                }}
              >
                불러오기
              </Button>
            </Card.Footer>
          </Card>
        ))}
      </div>
    </>
  )
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
