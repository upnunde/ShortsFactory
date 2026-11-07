export type NewsAngleOption = {
  id: string
  title: string
  summary: string
  keywords: string[]
}

export function normalizeAngleOptions(value: unknown): NewsAngleOption[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return []
      const record = item as Partial<NewsAngleOption>
      const title = typeof record.title === "string" ? record.title.trim() : ""
      const summary =
        typeof record.summary === "string" ? record.summary.trim() : ""
      if (!title || !summary) return []
      return [
        {
          id:
            typeof record.id === "string" && record.id.trim()
              ? record.id.trim()
              : `angle-${index + 1}`,
          title: title.slice(0, 80),
          summary: summary.slice(0, 180),
          keywords: Array.isArray(record.keywords)
            ? record.keywords
                .filter((term): term is string => typeof term === "string")
                .map((term) => term.trim())
                .filter(Boolean)
                .slice(0, 6)
            : [],
        } satisfies NewsAngleOption,
      ]
    })
    .slice(0, 6)
}
