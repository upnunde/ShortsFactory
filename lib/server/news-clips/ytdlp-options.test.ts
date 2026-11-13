import assert from "node:assert/strict"
import test from "node:test"

import {
  YOUTUBE_EXTRACTOR_ARGS,
  YOUTUBE_VIDEO_FORMAT,
  youtubeSubtitleDownloadArgs,
  youtubeVideoDownloadArgs,
  ytDlpFailureKind,
} from "./ytdlp-options.ts"

test("YouTube 영상은 호환 클라이언트와 720p H.264 우선 포맷으로 받는다", () => {
  const args = youtubeVideoDownloadArgs({
    folder: "/tmp/news-source",
    url: "https://www.youtube.com/watch?v=MmQeGynBohk",
    ffmpegPath: "/opt/ffmpeg",
  })

  assert.equal(
    args[args.indexOf("--extractor-args") + 1],
    YOUTUBE_EXTRACTOR_ARGS
  )
  assert.equal(args[args.indexOf("-f") + 1], YOUTUBE_VIDEO_FORMAT)
  assert.equal(args.includes("--js-runtimes"), false)
  assert.equal(args.at(-1), "https://www.youtube.com/watch?v=MmQeGynBohk")
})

test("PO Token 없이 403을 내는 android_vr 클라이언트는 사용하지 않는다", () => {
  const clients = YOUTUBE_EXTRACTOR_ARGS.split("=")[1]?.split(",") ?? []
  assert.equal(YOUTUBE_EXTRACTOR_ARGS.includes("android_vr"), false)
  assert.equal(clients.includes("visionos"), true)
  assert.equal(clients.includes("android"), true)
})

test("자막 다운로드도 같은 호환 클라이언트를 사용한다", () => {
  const args = youtubeSubtitleDownloadArgs({
    folder: "/tmp/news-source",
    url: "https://youtu.be/MmQeGynBohk",
    languages: "ko.*,ko",
  })

  assert.equal(
    args[args.indexOf("--extractor-args") + 1],
    YOUTUBE_EXTRACTOR_ARGS
  )
  assert.equal(args[args.indexOf("--sub-langs") + 1], "ko.*,ko")
  assert.equal(args.includes("--skip-download"), true)
})

test("비공개 영상과 실행기 오류를 구분한다", () => {
  assert.equal(ytDlpFailureKind("ERROR: Private video"), "video-unavailable")
  assert.equal(
    ytDlpFailureKind(
      "Failed to initialize sync semaphore! semctl: Operation not permitted"
    ),
    "runtime-unavailable"
  )
  assert.equal(
    ytDlpFailureKind("ERROR: The page needs to be reloaded"),
    "retryable"
  )
})
