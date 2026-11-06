import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import type { NewsClipProject } from "@/lib/news-clips/types"
import {
  readChannelAccountStatus,
  youtubeAccessToken,
} from "@/lib/server/accounts"
import { readNewsChannel } from "@/lib/server/news-clips/channels"

export async function uploadNewsClipToYoutube(project: NewsClipProject) {
  const profile = await readNewsChannel(project.profileId)
  if (!profile) throw new Error("news-channel-not-found")

  const account = (await readChannelAccountStatus(project.profileId)).youtube
  if (!account.connected) throw new Error("youtube-not-connected")
  if (
    profile.youtubeChannelId &&
    account.accountId !== profile.youtubeChannelId
  ) {
    throw new Error("youtube-channel-mismatch")
  }

  const videoPath = path.join(
    process.cwd(),
    "public",
    "news-clips",
    "output",
    project.id,
    "final.mp4"
  )
  const video = await readFile(videoPath).catch(() => null)
  if (!video) throw new Error("video-not-found")

  const token = await youtubeAccessToken(project.profileId)
  const title = (project.metadata.youtubeTitle || project.title)
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, 100)
  const metadata = {
    snippet: {
      title: title || "뉴스 쇼츠",
      description: project.metadata.description.trim(),
      tags: project.metadata.tags.slice(0, 30),
      categoryId: "25",
      defaultLanguage: "ko",
      defaultAudioLanguage: "ko",
    },
    status: {
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      embeddable: true,
    },
  }
  const uploaded = await multipartRequest(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
    token,
    metadata,
    video,
    "video/mp4"
  )
  const videoId =
    uploaded && typeof uploaded === "object" && "id" in uploaded
      ? String(uploaded.id)
      : ""
  if (!videoId) throw new Error("youtube-upload-failed")
  return {
    videoId,
    url: `https://studio.youtube.com/video/${videoId}/edit`,
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
  if (!response.ok) throw new Error("youtube-upload-failed")
  return result
}
