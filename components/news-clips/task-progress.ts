export type NewsOperationProgress = {
  runId: string
  percent: number
}

export type NewsOperationProgressMap = Record<
  string,
  NewsOperationProgress | undefined
>

export type UpdateNewsOperationProgress = (
  key: string,
  runId: string,
  percent: number | null
) => void

export function operationProgressPercent(
  progress: NewsOperationProgressMap,
  key: string
) {
  return progress[key]?.percent ?? null
}

export function startNewsTaskProgressPolling(
  jobId: string,
  onProgress: (percent: number) => void
) {
  let active = true
  const poll = async () => {
    try {
      const response = await fetch(
        `/api/news-clips/render-progress?jobId=${encodeURIComponent(jobId)}`,
        { cache: "no-store" }
      )
      const body = (await response.json()) as { percent?: number }
      if (!active || !Number.isFinite(body.percent)) return
      onProgress(clampProgress(body.percent!))
    } catch {
      // 진행률 조회 실패가 실제 작업 요청을 중단시키지는 않는다.
    }
  }
  void poll()
  const timer = window.setInterval(() => void poll(), 400)
  return () => {
    active = false
    window.clearInterval(timer)
    void fetch(
      `/api/news-clips/render-progress?jobId=${encodeURIComponent(jobId)}`,
      { method: "DELETE" }
    ).catch(() => undefined)
  }
}

export function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}
