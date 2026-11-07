"use client"

type SegmentedTabItem<T extends string> = {
  id: T
  label: string
  disabled?: boolean
}

/** 3번(미리보기) 화면의 세그먼트 탭 UI. 뉴스 클립 전역에서 동일하게 쓴다. */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
  equalWidth = true,
}: {
  items: Array<SegmentedTabItem<T>>
  value: T | null
  onChange: (id: T) => void
  ariaLabel: string
  className?: string
  equalWidth?: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex w-full gap-1 rounded-xl border border-separator bg-default p-1 ${className}`}
    >
      {items.map((item) => {
        const selected = value !== null && item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={item.disabled}
            className={`${
              equalWidth ? "flex-1" : "shrink-0"
            } rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
