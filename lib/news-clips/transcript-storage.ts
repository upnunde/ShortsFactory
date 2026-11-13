type StoredTranscriptCandidates = {
  originalTimed?: string | null
  originalPlain?: string | null
  generated?: string | null
}

/**
 * 원본 자막과 로컬 STT 캐시가 함께 있을 때 사용할 전사본을 고른다.
 * 자동 생성 JSON은 원본 SRT/VTT를 덮지 않지만, 사용자가 검수한 JSON은
 * 원문과 단어 타임스탬프를 함께 보존하므로 가장 먼저 사용한다.
 */
export function selectPreferredStoredTranscript({
  originalTimed,
  originalPlain,
  generated,
}: StoredTranscriptCandidates) {
  const reviewedGenerated =
    generated && transcriptJsonHasUserReviewMetadata(generated)
      ? generated
      : ""
  return (
    reviewedGenerated ||
    originalTimed?.trim() ||
    generated?.trim() ||
    originalPlain?.trim() ||
    null
  )
}

/** SRT/VTT 또는 단어 시간 JSON처럼 실제 시간 정보가 있는 전사본인지 확인한다. */
export function transcriptHasExplicitTimestamps(value: string) {
  const text = value.trim()
  if (!text) return false
  if (/\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}/.test(text)) {
    return true
  }
  if (!text.startsWith("{") && !text.startsWith("[")) return false
  try {
    const parsed = JSON.parse(text) as {
      segments?: Array<{ start?: unknown; end?: unknown }>
    }
    return Boolean(
      parsed.segments?.some((segment) => {
        const start = Number(segment.start)
        const end = Number(segment.end)
        return Number.isFinite(start) && Number.isFinite(end) && end > start
      })
    )
  } catch {
    return false
  }
}

export function transcriptJsonHasUserReviewMetadata(value: string) {
  const text = value.trim()
  if (!text.startsWith("{") && !text.startsWith("[")) return false
  try {
    const parsed = JSON.parse(text) as {
      provenance?: unknown
      segments?: Array<{
        original_text?: unknown
        original_words?: unknown
        caption_boundary_source?: unknown
      }>
    }
    if (parsed.provenance === "user-reviewed") return true
    return Boolean(
      parsed.segments?.some(
        (segment) =>
          (typeof segment.original_text === "string" &&
            segment.original_text.trim().length > 0) ||
          (Array.isArray(segment.original_words) &&
            segment.original_words.length > 0) ||
          segment.caption_boundary_source === "manual"
      )
    )
  } catch {
    return false
  }
}
