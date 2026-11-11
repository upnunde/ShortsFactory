const YOUTUBE_PROCESSING_CHECKS = 30
const YOUTUBE_PROCESSING_POLL_MS = 2_000
const YOUTUBE_THUMBNAIL_ATTEMPTS = 3

type ApplyYoutubeThumbnailOptions = {
  videoId: string
  token: string
  thumbnail: Buffer
  fetchImpl?: typeof fetch
  wait?: (milliseconds: number) => Promise<void>
  maxProcessingChecks?: number
  processingPollMs?: number
}

export async function applyYoutubeThumbnail({
  videoId,
  token,
  thumbnail,
  fetchImpl = fetch,
  wait = delay,
  maxProcessingChecks = YOUTUBE_PROCESSING_CHECKS,
  processingPollMs = YOUTUBE_PROCESSING_POLL_MS,
}: ApplyYoutubeThumbnailOptions) {
  const processed = await waitForYoutubeProcessing({
    videoId,
    token,
    fetchImpl,
    wait,
    maxProcessingChecks,
    processingPollMs,
  })
  if (!processed) return false

  const url =
    "https://www.googleapis.com/upload/youtube/v3/thumbnails/set" +
    `?videoId=${encodeURIComponent(videoId)}&uploadType=media`
  for (let attempt = 0; attempt < YOUTUBE_THUMBNAIL_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
        "Content-Length": String(thumbnail.length),
      },
      body: new Uint8Array(thumbnail),
    }).catch(() => null)
    if (response?.ok) return true
    if (attempt < YOUTUBE_THUMBNAIL_ATTEMPTS - 1) {
      await wait(processingPollMs)
    }
  }
  return false
}

async function waitForYoutubeProcessing({
  videoId,
  token,
  fetchImpl,
  wait,
  maxProcessingChecks,
  processingPollMs,
}: Omit<ApplyYoutubeThumbnailOptions, "thumbnail"> & {
  fetchImpl: typeof fetch
  wait: (milliseconds: number) => Promise<void>
  maxProcessingChecks: number
  processingPollMs: number
}) {
  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=processingDetails&id=${encodeURIComponent(videoId)}`
  for (let check = 0; check < maxProcessingChecks; check += 1) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null)
    if (response?.ok) {
      const result = (await response.json().catch(() => null)) as {
        items?: Array<{
          processingDetails?: { processingStatus?: string }
        }>
      } | null
      const status = result?.items?.[0]?.processingDetails?.processingStatus
      if (status === "succeeded") return true
      if (status === "failed" || status === "terminated") return false
    }
    if (check < maxProcessingChecks - 1) await wait(processingPollMs)
  }
  return false
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
