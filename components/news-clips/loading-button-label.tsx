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
  if (!loading) return label
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      <span>{loadingLabel}</span>
    </span>
  )
}
