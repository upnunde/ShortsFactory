import type { ReactNode } from "react"

import {
  fitCaption,
  subtitleCaptionUnits,
  titleCaptionUnits,
  type FrameLayout,
} from "@/lib/frame-layout"

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
    | "fontWeight"
    | "titleSize"
    | "subtitleSize"
    | "subtitleY"
    | "titleBandPercent"
  >
  className?: string
  media?: ReactNode
  caption?: string
}) {
  const titleLines = fitCaption(title, titleCaptionUnits(layout.titleSize))
  const subtitleLines = fitCaption(
    media ? caption || "" : subtitle,
    subtitleCaptionUnits(layout.subtitleSize)
  ).slice(0, 2)
  const titleSize = `${(layout.titleSize / 900) * 100}cqw`
  const subtitleSize = `${(layout.subtitleSize / 900) * 100}cqw`

  return (
    <div
      className={`[container-type:size] relative mx-auto aspect-[9/16] shrink-0 overflow-hidden bg-[#111111] ${className}`}
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-neutral-950"
        style={{ top: `${layout.titleBandPercent}%` }}
      >
        {media ?? (
          <div className="flex h-full items-center justify-center text-[4cqw] text-white/55">
            영상
          </div>
        )}
      </div>
      <div
        className="absolute inset-x-0 top-0 bg-[#111111]"
        style={{ height: `${layout.titleBandPercent}%` }}
      />
      <div
        className="absolute inset-x-0 flex -translate-y-full justify-center px-[7cqw] text-center font-[Pretendard] leading-[1.2] whitespace-pre-line text-white"
        style={{
          top: `${layout.titleBandPercent * 0.855}%`,
          fontSize: titleSize,
          fontWeight: layout.fontWeight,
        }}
      >
        <span>{titleLines.join("\n") || "제목"}</span>
      </div>
      {media && !caption ? null : (
        <div
          className="pointer-events-none absolute left-1/2 w-max max-w-[80cqw] -translate-x-1/2 overflow-hidden bg-black/50 px-[2.22cqw] py-[2.22cqw] text-center font-[Pretendard] leading-[1.2] whitespace-pre text-white"
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
