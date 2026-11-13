"use client"

import { useEffect, useState, type ReactNode } from "react"
import Image from "next/image"

import type { NewsClipSettings } from "@/lib/news-clips/types"

const NEWS_PREVIEW_PLACEHOLDER = "/news-clips/news-preview-placeholder.png"

export function NewsFramePreview({
  mode,
  title,
  subtitle,
  sourceCredit = "",
  settings,
  zoom = 1,
  showGuides = false,
  className = "",
  backgroundContent,
  videoContent,
}: {
  mode: "title" | "body"
  title: string
  subtitle: string
  sourceCredit?: string
  settings: NewsClipSettings
  zoom?: number
  showGuides?: boolean
  className?: string
  backgroundContent?: ReactNode
  videoContent?: ReactNode
}) {
  const image =
    mode === "title" ? settings.titleFrameImage : settings.bodyFrameImage
  const safe = settings.safeMarginPercent
  const mediaContent = mode === "title" ? backgroundContent : videoContent
  const previewTitle =
    title.trim() ||
    (mode === "title" ? "1단 핵심 제목\n2단 보조 제목" : "본문 제목")
  const previewSubtitle =
    subtitle.trim() || "아나운서 음성에 맞춰 자막이 표시됩니다"
  const previewSourceCredit = sourceCredit.trim()
  const fullFramePreview = !backgroundContent && !videoContent
  const overlayRequestKey = JSON.stringify({
    mode,
    title: previewTitle,
    subtitle: previewSubtitle,
    sourceCredit: previewSourceCredit,
    settings: {
      profileId: settings.profileId,
      fontFamily: settings.fontFamily,
      titleCardText: settings.titleCardText,
      titleCardSecondFontSize: settings.titleCardSecondFontSize,
      titleCardLineHeightPercent: settings.titleCardLineHeightPercent,
      titleCardColor: settings.titleCardColor,
      titleCardSecondColor: settings.titleCardSecondColor,
      bodyTitleText: settings.bodyTitleText,
      bodyTitleColor: settings.bodyTitleColor,
      bodySubtitleText: settings.bodySubtitleText,
      subtitleColor: settings.subtitleColor,
      bodySourceText: settings.bodySourceText,
      sourceColor: settings.sourceColor,
      emphasisColor: settings.emphasisColor,
      safeMarginPercent: settings.safeMarginPercent,
      titleFrameImage: settings.titleFrameImage,
      bodyFrameImage: settings.bodyFrameImage,
      videoRect: settings.videoRect,
    },
  })
  const [textOverlay, setTextOverlay] = useState<{
    url: string
    mode: "title" | "body"
    kind: "frame" | "overlay"
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const kind = fullFramePreview ? "frame" : "overlay"
      void fetch(
        fullFramePreview
          ? "/api/news-clips/frame-preview"
          : "/api/news-clips/text-overlay",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: overlayRequestKey,
          signal: controller.signal,
        }
      )
        .then(async (response) => {
          if (!response.ok) return null
          return URL.createObjectURL(await response.blob())
        })
        .then((url) => {
          if (!url || controller.signal.aborted) return
          setTextOverlay({ url, mode, kind })
        })
        .catch(() => undefined)
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [fullFramePreview, mode, overlayRequestKey])

  useEffect(
    () => () => {
      if (textOverlay?.url) URL.revokeObjectURL(textOverlay.url)
    },
    [textOverlay?.url]
  )

  const exactOverlayUrl =
    textOverlay?.mode === mode &&
    textOverlay.kind === (fullFramePreview ? "frame" : "overlay")
      ? textOverlay.url
      : ""

  return (
    <div
      className={`relative aspect-[9/16] overflow-hidden rounded-2xl bg-neutral-950 text-white shadow-xl ${className}`}
      style={{ containerType: "inline-size" }}
    >
      {/* 영상은 맨 뒤. 프레임이 노출 영역을 가린다. */}
      {!fullFramePreview && mediaContent ? (
        <div className="absolute inset-0 z-0 overflow-hidden">{mediaContent}</div>
      ) : !fullFramePreview ? (
        <Image
          src={NEWS_PREVIEW_PLACEHOLDER}
          alt=""
          fill
          unoptimized
          aria-hidden="true"
          className="z-0 object-cover"
          style={
            mode === "body"
              ? { transform: `scale(${Math.max(1, zoom)})` }
              : undefined
          }
        />
      ) : null}

      {!fullFramePreview && image ? (
        <Image
          src={image}
          alt={mode === "title" ? "제목 고정 프레임" : "본문 고정 프레임"}
          fill
          unoptimized
          className="pointer-events-none z-10 object-contain"
        />
      ) : null}

      {exactOverlayUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={exactOverlayUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 size-full object-contain"
        />
      ) : fullFramePreview ? (
        <div className="absolute inset-0 grid place-items-center text-xs text-white/55">
          FFmpeg 미리보기 생성 중
        </div>
      ) : null}

      {showGuides ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-40 border border-dashed border-white/45"
          style={{ inset: `${safe}%` }}
        />
      ) : null}
    </div>
  )
}
