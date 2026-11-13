import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import type { NewsClipProject } from "@/lib/news-clips/types"
import { koreaPublishAt, scheduleForUpload } from "@/lib/youtube-metadata"
import {
  readChannelAccountStatus,
  youtubeAccessToken,
} from "@/lib/server/accounts"
import { readNewsChannel } from "@/lib/server/news-clips/channels"
import { applyYoutubeThumbnail } from "@/lib/server/news-clips/youtube-thumbnail"

export async function uploadNewsClipToYoutube(
  project: NewsClipProject,
  scheduledAt = "",
  onProgress?: (percent: number, label: string) => void | Promise<void>
) {
  await onProgress?.(4, "채널 확인 중")
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
  await onProgress?.(10, "채널 확인 완료")

  const videoPath = path.join(
    process.cwd(),
    "public",
    "news-clips",
    "output",
    project.id,
    "final.mp4"
  )
  const thumbnailPath = path.join(
    process.cwd(),
    "public",
    "news-clips",
    "output",
    project.id,
    "thumbnail.png"
  )
  const [video, thumbnail] = await Promise.all([
    readFile(videoPath).catch(() => null),
    readFile(thumbnailPath).catch(() => null),
  ])
  if (!video) throw new Error("video-not-found")
  await onProgress?.(16, "영상 파일 확인 완료")

  const token = await youtubeAccessToken(project.profileId)
  await onProgress?.(20, "YouTube 인증 완료")
  const title = (project.metadata.youtubeTitle || project.title)
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, 100)
  const publishAt = koreaPublishAt(scheduleForUpload(scheduledAt))
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
      ...(publishAt ? { publishAt } : {}),
      selfDeclaredMadeForKids: false,
      embeddable: true,
    },
  }
  await onProgress?.(24, "영상 업로드 중")
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
  await onProgress?.(65, "영상 업로드 완료")
  const thumbnailApplied = thumbnail
    ? await applyYoutubeThumbnail({
        videoId,
        token,
        thumbnail,
        onProgress,
      })
    : false
  await onProgress?.(100, "완료")
  return {
    videoId,
    url: `https://studio.youtube.com/video/${videoId}/edit`,
    thumbnailApplied,
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
