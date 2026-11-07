/** 이슈·원본 검색에 공통으로 쓰는 최신성 한도. */
export const NEWS_MAX_AGE_DAYS = 2
export const NEWS_MAX_AGE_MS = NEWS_MAX_AGE_DAYS * 86_400_000

export function isWithinNewsMaxAge(
  publishedAt: string | undefined,
  now = Date.now()
) {
  if (!publishedAt?.trim()) return false
  const timestamp = new Date(publishedAt).getTime()
  if (!Number.isFinite(timestamp)) return false
  // 시계 오차 여유 1일, 과거는 NEWS_MAX_AGE_DAYS 이내만 허용
  return (
    timestamp <= now + 86_400_000 && now - timestamp <= NEWS_MAX_AGE_MS
  )
}
