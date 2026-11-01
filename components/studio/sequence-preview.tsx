"use client"

import { useRef, useState, type RefObject } from "react"

import { Button, Modal } from "@heroui/react"
import { ShortsFrame } from "@/components/studio/shorts-frame"
import type { FrameLayout } from "@/lib/frame-layout"
import { cueSlices } from "@/lib/frame-render"
import { narrationSeconds } from "@/lib/timing"

export type PreviewClip = {
  src: string
  parts: { subtitle: string; script: string }[]
}

export function SequencePreview({
  title,
  layout,
  clips,
}: {
  title: string
  layout: FrameLayout
  clips: PreviewClip[]
}) {
  const inlineRef = useRef<HTMLVideoElement>(null)
  const largeRef = useRef<HTMLVideoElement>(null)
  const [open, setOpen] = useState(false)
  const [inlineIndex, setInlineIndex] = useState(0)
  const [largeIndex, setLargeIndex] = useState(0)
  const [inlineCaption, setInlineCaption] = useState("")
  const [largeCaption, setLargeCaption] = useState("")
  const resume = useRef({ index: 0, time: 0 })

  return (
    <div className="flex flex-col items-center gap-3">
      <SequenceVideo
        videoRef={inlineRef}
        clips={clips}
        index={inlineIndex}
        title={title}
        layout={layout}
        caption={inlineCaption}
        label="합치기 전 미리보기"
        className="w-48 ring-1 ring-white/25"
        onIndex={setInlineIndex}
        onCaption={setInlineCaption}
      />
      <Modal
        isOpen={open}
        onOpenChange={(next) => {
          if (next) {
            resume.current = {
              index: inlineIndex,
              time: inlineRef.current?.currentTime ?? 0,
            }
            inlineRef.current?.pause()
            setLargeIndex(resume.current.index)
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
              <SequenceVideo
                videoRef={largeRef}
                clips={clips}
                index={largeIndex}
                title={title}
                layout={layout}
                caption={largeCaption}
                label="합치기 전 미리보기 크게"
                autoPlay
                className="h-[min(78vh,960px)] w-auto max-w-[92vw] ring-1 ring-white/25"
                onIndex={setLargeIndex}
                onCaption={setLargeCaption}
                onReady={(video) => {
                  if (video.dataset.clip === String(resume.current.index) && resume.current.time > 0) {
                    video.currentTime = resume.current.time
                  }
                }}
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

function SequenceVideo({
  videoRef,
  clips,
  index,
  title,
  layout,
  caption,
  label,
  className,
  autoPlay = false,
  onIndex,
  onCaption,
  onReady,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  clips: PreviewClip[]
  index: number
  title: string
  layout: FrameLayout
  caption: string
  label: string
  className: string
  autoPlay?: boolean
  onIndex: (index: number) => void
  onCaption: (caption: string) => void
  onReady?: (video: HTMLVideoElement) => void
}) {
  const clip = clips[index] ?? clips[0]
  if (!clip) {
    return null
  }

  return (
    <ShortsFrame
      title={title}
      subtitle=""
      layout={layout}
      caption={caption}
      className={className}
      media={
        <video
          ref={videoRef}
          key={clip.src}
          src={clip.src}
          data-clip={index}
          controls
          playsInline
          preload="metadata"
          autoPlay={autoPlay || index > 0}
          aria-label={label}
          className="h-full w-full bg-black object-cover"
          onLoadedMetadata={(event) => {
            onReady?.(event.currentTarget)
            onCaption(captionAt(clip, 0, event.currentTarget.duration))
          }}
          onTimeUpdate={(event) => onCaption(captionAt(clip, event.currentTarget.currentTime, event.currentTarget.duration))}
          onEnded={() => {
            if (index + 1 < clips.length) {
              onCaption("")
              onIndex(index + 1)
            }
          }}
        />
      }
    />
  )
}

function captionAt(clip: PreviewClip, time: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return ""
  }
  const weights = clip.parts.map((part) => Math.max(0.1, narrationSeconds(part.script)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  for (let index = 0; index < clip.parts.length; index += 1) {
    const part = clip.parts[index]
    const length =
      index === clip.parts.length - 1 ? duration - cursor : (duration * weights[index]) / total
    if (time < cursor + length || index === clip.parts.length - 1) {
      const cues = cueSlices(part?.subtitle || "", length)
      let cueCursor = 0
      for (const cue of cues) {
        if (time - cursor < cueCursor + cue.duration) {
          return cue.text
        }
        cueCursor += cue.duration
      }
      return ""
    }
    cursor += length
  }
  return ""
}
