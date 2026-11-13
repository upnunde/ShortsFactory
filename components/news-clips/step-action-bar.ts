/** 단계 상단 헤더 — 높이 64, 우측 액션 */
export const stepHeaderClassName =
  "flex h-16 w-full shrink-0 items-center justify-between gap-3 border-b border-separator px-6"

export const stepHeaderActionsClassName =
  "flex min-w-0 flex-wrap items-center justify-end gap-2"

export const stepHeaderActionButtonClassName = "h-10"

/** 단계 본문 스크롤 영역 */
export const stepBodyClassName =
  "mt-4 min-h-0 w-full flex-1 overflow-y-auto"

/** 설정 등 하단 고정 액션(레거시) */
export const stepActionBarClassName =
  "flex w-full shrink-0 items-center gap-2 border-t border-separator bg-background/95 px-6 py-3 backdrop-blur"

export type WorkspaceHistorySaveProps = {
  busy: boolean
  disabled: boolean
  progress: number | null
  onSave: () => void
}
