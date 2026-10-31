import { Button } from "@heroui/react"

export function StepHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <header>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </header>
  )
}

export function StepActions({
  onBack,
  nextLabel,
  onNext,
  nextDisabled = false,
  note,
}: {
  onBack?: () => void
  nextLabel: string
  onNext: () => void
  nextDisabled?: boolean
  note?: string
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      {note ? <p className="text-right text-sm text-muted">{note}</p> : null}
      <div className="flex gap-2">
        {onBack ? (
          <Button variant="outline" onPress={onBack}>
            이전
          </Button>
        ) : null}
        <Button isDisabled={nextDisabled} onPress={onNext}>
          {nextLabel}
        </Button>
      </div>
    </div>
  )
}
