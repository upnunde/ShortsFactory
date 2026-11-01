"use client"

import { useEffect, useRef, useState } from "react"

import { Card, Label, TextArea, TextField } from "@heroui/react"
import { defaultWritingGuide, type WritingGuide } from "@/lib/writing-guide"

export function WritingGuideCard() {
  const [guide, setGuide] = useState<WritingGuide>(defaultWritingGuide)
  const [note, setNote] = useState("")
  const dirty = useRef(false)
  const guideRef = useRef(guide)

  useEffect(() => {
    void fetch("/api/writing")
      .then(async (response) => {
        if (!response.ok) {
          return
        }
        const saved = (await response.json()) as WritingGuide
        if (dirty.current) {
          return
        }
        guideRef.current = saved
        setGuide(saved)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!dirty.current) {
      return
    }
    const timer = window.setTimeout(() => void save(guideRef.current), 600)
    return () => window.clearTimeout(timer)
  }, [guide])

  function edit(next: WritingGuide) {
    dirty.current = true
    guideRef.current = next
    setGuide(next)
  }

  async function save(next: WritingGuide) {
    setNote("")
    const response = await fetch("/api/writing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    })
    setNote(response.ok ? "저장했습니다." : "저장하지 못했습니다.")
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>작성 기준</Card.Title>
        <Card.Description>
          주제를 쓸 때 따르는 기준입니다. 고치면 따로 저장하지 않아도 잠시 뒤
          이 컴퓨터에 남고, 다음 작성부터 적용됩니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <TextField
          value={guide.body}
          onChange={(body) => edit({ body })}
          fullWidth
        >
          <Label>기준</Label>
          <TextArea
            rows={5}
            onBlur={() => {
              if (dirty.current) {
                void save(guideRef.current)
              }
            }}
          />
        </TextField>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </Card.Content>
    </Card>
  )
}
