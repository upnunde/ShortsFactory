"use client"

import { useState } from "react"

import { Button, Label, TextArea, TextField } from "@heroui/react"

export function PlaceNote({
  busy,
  disabled,
  onRewrite,
}: {
  busy: boolean
  disabled: boolean
  onRewrite: (note: string) => Promise<boolean>
}) {
  const [note, setNote] = useState("")

  async function rewrite() {
    const text = note.trim()
    if (!text) {
      return
    }
    const ok = await onRewrite(text)
    if (ok) {
      setNote("")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <TextField value={note} onChange={setNote} fullWidth>
        <Label>자리 메모</Label>
        <TextArea rows={2} placeholder="같은 어두운 방, 책상 앞처럼 짧게" />
      </TextField>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          짧게 적으면 진행 자리만 다시 씁니다. 주제 속으로 넣지는 않습니다.
        </p>
        <Button
          variant="outline"
          isDisabled={disabled || busy || note.trim() === ""}
          onPress={() => void rewrite()}
        >
          {busy ? "다시 쓰는 중" : "자리 다시 쓰기"}
        </Button>
      </div>
    </div>
  )
}
