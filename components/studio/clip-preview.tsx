"use client"

import { useRef, useState, type RefObject } from "react"

import { Button, Modal } from "@heroui/react"
import { ShortsFrame } from "@/components/studio/shorts-frame"
import type { FrameLayout } from "@/lib/frame-layout"

export function ClipPreview({
  src,
  label,
  title,
  layout,
}: {
  src: string
  label: string
  title?: string
  layout?: FrameLayout
}) {
  const inlineRef = useRef<HTMLVideoElement>(null)
  const largeRef = useRef<HTMLVideoElement>(null)
  const resumeAt = useRef(0)
  const [open, setOpen] = useState(false)
  const framed = title !== undefined && layout !== undefined

  return (
    <div className="flex flex-col items-center gap-3">
      <PreviewVideo
        videoRef={inlineRef}
        src={src}
        label={label}
        title={title}
        layout={layout}
        framed={framed}
        className="w-48 ring-1 ring-white/25"
      />
      <Modal
        isOpen={open}
        onOpenChange={(next) => {
          if (next) {
            resumeAt.current = inlineRef.current?.currentTime ?? 0
            inlineRef.current?.pause()
          } else {
            largeRef.current?.pause()
          }
          setOpen(next)
        }}
      >
        <Modal.Trigger>
          <Button size="sm" variant="outline">
            크게 보기
          </Button>
        </Modal.Trigger>
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="full">
            <Modal.Dialog className="items-center justify-center bg-black">
              <PreviewVideo
                videoRef={largeRef}
                src={src}
                label={`${label} 크게`}
                title={title}
                layout={layout}
                framed={framed}
                autoPlay
                onReady={(video) => {
                  if (resumeAt.current > 0) {
                    video.currentTime = resumeAt.current
                  }
                }}
                className="h-[min(78vh,960px)] w-auto max-w-[92vw] ring-1 ring-white/25"
              />
              <Button className="mt-4" variant="outline" onPress={() => setOpen(false)}>
                닫기
              </Button>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}

function PreviewVideo({
  videoRef,
  src,
  label,
  title,
  layout,
  framed,
  className,
  autoPlay = false,
  onReady,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  src: string
  label: string
  title?: string
  layout?: FrameLayout
  framed: boolean
  className: string
  autoPlay?: boolean
  onReady?: (video: HTMLVideoElement) => void
}) {
  const video = (
    <video
      ref={videoRef}
      src={src}
      controls
      playsInline
      preload="metadata"
      autoPlay={autoPlay}
      aria-label={label}
      onLoadedMetadata={(event) => onReady?.(event.currentTarget)}
      className={`h-full w-full bg-black ${framed ? "object-cover" : "object-contain"}`}
    />
  )

  if (framed && title !== undefined && layout !== undefined) {
    return (
      <ShortsFrame
        title={title}
        subtitle=""
        layout={layout}
        media={video}
        className={className}
      />
    )
  }

  return (
    <div className={`mx-auto aspect-[9/16] shrink-0 overflow-hidden bg-black ${className}`}>
      {video}
    </div>
  )
}
