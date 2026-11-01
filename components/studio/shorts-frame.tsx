import type { ReactNode } from "react"

import { fitCaption, captionUnits, type FrameLayout } from "@/lib/frame-layout"

export function ShortsFrame({
  title,
  subtitle,
  layout,
  className = "w-48",
  media,
  caption,
}: {
  title: string
  subtitle: string
  layout: Pick<
    FrameLayout,
    "fontWeight" | "titleSize" | "subtitleSize" | "subtitleY"
  >
  className?: string
  media?: ReactNode
  caption?: string
}) {
  const titleLines = fitCaption(title, captionUnits(layout.titleSize))
  const subtitleLines = fitCaption(
    media ? caption || "" : subtitle,
    captionUnits(layout.subtitleSize)
  ).slice(0, 2)
  const titleSize = `${(layout.titleSize / 900) * 100}cqw`
  const subtitleSize = `${(layout.subtitleSize / 900) * 100}cqw`

  return (
    <div
      className={`relative mx-auto aspect-[9/16] shrink-0 overflow-hidden bg-[#111111] [container-type:size] ${className}`}
    >
      <div className="absolute inset-x-0 top-1/4 bottom-0 bg-neutral-950">
        {media ?? (
          <div className="flex h-full items-center justify-center text-[4cqw] text-white/55">
            영상
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 top-0 h-1/4 bg-[#111111]" />
      <div
        className="absolute inset-x-0 top-[21.375%] flex -translate-y-full justify-center px-[4cqw] text-center font-[Pretendard] leading-[1.2] whitespace-pre-line text-white"
        style={{ fontSize: titleSize, fontWeight: layout.fontWeight }}
      >
        <span>{titleLines.join("\n") || "제목"}</span>
      </div>
      {media && !caption ? null : (
        <div
          className="pointer-events-none absolute left-1/2 w-max max-w-[calc(100%-4.44cqw)] -translate-x-1/2 overflow-hidden bg-black/50 px-[2.22cqw] py-[2.22cqw] text-center font-[Pretendard] leading-[1.2] whitespace-pre text-white"
          style={{
            top: `${layout.subtitleY}%`,
            fontSize: subtitleSize,
            fontWeight: layout.fontWeight,
          }}
        >
          <span>{subtitleLines.join("\n") || (media ? "" : "자막")}</span>
        </div>
      )}
    </div>
  )
}
