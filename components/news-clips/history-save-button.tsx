"use client"

import { Button } from "@heroui/react"
import { LoadingButtonLabel } from "@/components/news-clips/loading-button-label"
import type { WorkspaceHistorySaveProps } from "@/components/news-clips/step-action-bar"

export function HistorySaveButton({
  busy,
  disabled,
  progress,
  onSave,
  className,
}: WorkspaceHistorySaveProps & { className?: string }) {
  return (
    <Button
      size={className ? "md" : "sm"}
      variant="outline"
      className={className}
      isDisabled={busy ? false : disabled}
      onPress={onSave}
    >
      <LoadingButtonLabel
        loading={busy}
        label="임시저장"
        loadingLabel="임시저장 중"
        progress={progress}
      />
    </Button>
  )
}
