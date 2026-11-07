import { LoaderCircle } from "lucide-react"

export function LoadingButtonLabel({
  loading,
  label,
  loadingLabel,
}: {
  loading: boolean
  label: string
  loadingLabel: string
}) {
  if (!loading) return <>{label}</>
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2"
    >
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>{loadingLabel}</span>
    </span>
  )
}

/** 이 버튼이 로딩 중이면 비활성화하지 않아 스피너가 보이게 한다. */
export function buttonBusyDisabled(busy: string, loadingKeys: string | string[]) {
  if (!busy) return false
  const keys = Array.isArray(loadingKeys) ? loadingKeys : [loadingKeys]
  const selfLoading = keys.some(
    (key) => busy === key || busy.startsWith(`${key}:`)
  )
  return !selfLoading
}

export function busyMatches(busy: string, loadingKeys: string | string[]) {
  if (!busy) return false
  const keys = Array.isArray(loadingKeys) ? loadingKeys : [loadingKeys]
  return keys.some((key) => busy === key || busy.startsWith(`${key}:`))
}
