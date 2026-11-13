/** 뉴스 제작 페이지의 공통 최대폭 */
export const workspacePageContentClassName =
  "mx-auto w-full max-w-[1200px] px-6"

/** 단계 상단 헤더 — 높이 64, 전체폭 구분선 */
export const stepHeaderClassName =
  "h-16 w-full shrink-0 border-b border-separator"

/** 단계 상단 헤더 내부 — 본문과 동일한 최대폭 */
export const stepHeaderContentClassName =
  `${workspacePageContentClassName} flex h-full items-center justify-between gap-3`

export const stepHeaderActionsClassName =
  "flex min-w-0 flex-wrap items-center justify-end gap-2"

export const stepHeaderActionButtonClassName = "h-10"

/** 단계 본문 스크롤 영역 */
export const stepBodyClassName =
  "mt-4 min-h-0 w-full flex-1 overflow-y-auto"

export type WorkspaceHistorySaveProps = {
  busy: boolean
  disabled: boolean
  progress: number | null
  onSave: () => void
}
