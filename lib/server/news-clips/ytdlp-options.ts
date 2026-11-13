import path from "node:path"

export const YOUTUBE_EXTRACTOR_ARGS =
  "youtube:player_client=visionos,android,web_safari"

export const YOUTUBE_VIDEO_FORMAT =
  "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]"

export function youtubeVideoDownloadArgs(input: {
  folder: string
  url: string
  ffmpegPath: string
}) {
  return [
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "30",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--extractor-args",
    YOUTUBE_EXTRACTOR_ARGS,
    "--ffmpeg-location",
    input.ffmpegPath,
    "--merge-output-format",
    "mp4",
    "--write-info-json",
    "-f",
    YOUTUBE_VIDEO_FORMAT,
    "-o",
    path.join(input.folder, "source.%(ext)s"),
    input.url,
  ]
}

export function youtubeSubtitleDownloadArgs(input: {
  folder: string
  url: string
  languages: string
}) {
  return [
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "30",
    "--retries",
    "2",
    "--extractor-args",
    YOUTUBE_EXTRACTOR_ARGS,
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    input.languages,
    "--sub-format",
    "srt/vtt/best",
    "-o",
    path.join(input.folder, "source.%(ext)s"),
    input.url,
  ]
}

export function ytDlpFailureKind(stderr: string) {
  const normalized = stderr.toLowerCase()
  if (
    /private video|video unavailable|members-only|members only|login required|sign in to confirm|not available in your country|copyright complaint/.test(
      normalized
    )
  ) {
    return "video-unavailable" as const
  }
  if (
    /enoent|no such file or directory|command not found|failed to initialize sync semaphore|semctl: operation not permitted/.test(
      normalized
    )
  ) {
    return "runtime-unavailable" as const
  }
  return "retryable" as const
}
