import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"

import { youtubeAccessToken } from "@/lib/server/accounts"
import {
  historyCaptionPath,
  historyVideoPath,
  markHistoryUploaded,
} from "@/lib/server/history"
import {
  englishCaptionSnippet,
  youtubeVideoResource,
} from "@/lib/youtube-metadata"

export type YoutubeUploadInput = {
  profileId: string
  historyId: string
  title: string
  description: string
  tags: string
  scheduledAt: string
}

export async function uploadYoutubeShort(input: YoutubeUploadInput) {
  const videoPath = historyVideoPath(input.historyId)
  const captionPath = historyCaptionPath(input.historyId)
  if (!videoPath) {
    throw new Error("video-not-found")
  }
  const [video, token] = await Promise.all([
    readFile(videoPath).catch(() => null),
    youtubeAccessToken(input.profileId),
  ])
  if (!video) {
    throw new Error("video-not-found")
  }
  const resource = youtubeVideoResource(input)
  const uploaded = await multipartRequest(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
    token,
    resource,
    video,
    "video/mp4"
  )
  const videoId =
    uploaded && typeof uploaded === "object" && "id" in uploaded
      ? String(uploaded.id)
      : ""
  if (!videoId) {
    throw new Error("youtube-upload-failed")
  }
  if (captionPath) {
    const captions = await readFile(captionPath).catch(() => null)
    if (captions) {
      await multipartRequest(
        "https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet",
        token,
        englishCaptionSnippet(videoId),
        captions,
        "application/x-subrip"
      )
    }
  }
  await markHistoryUploaded(input.historyId)
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  }
}

async function multipartRequest(
  url: string,
  token: string,
  metadata: unknown,
  media: Buffer,
  mediaType: string
) {
  const boundary = `shorts-factory-${randomUUID()}`
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`),
    media,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body: new Uint8Array(body),
  })
  const result = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    throw new Error("youtube-upload-failed")
  }
  return result
}
