"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { Card, Slider } from "@heroui/react"
import {
  defaultFrameLayout,
  setFrameBand,
  videoHeight,
  type FrameLayout,
} from "@/lib/frame-layout"

export function FrameLayoutCard() {
  const [layout, setLayout] = useState<FrameLayout>(defaultFrameLayout)
  const [note, setNote] = useState("")
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  useEffect(() => {
    void fetch("/api/layout")
      .then(async (response) => {
        if (response.ok) {
          const saved = (await response.json()) as FrameLayout
          layoutRef.current = saved
          setLayout(saved)
        }
      })
      .catch(() => undefined)
  }, [])

  function apply(band: "title" | "subtitle", value: number | number[]) {
    const next = setFrameBand(layoutRef.current, band, typeof value === "number" ? value : value[0])
    layoutRef.current = next
    setLayout(next)
    return next
  }

  async function save(next: FrameLayout) {
    setNote("")
    const response = await fetch("/api/layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    })
    setNote(response.ok ? "저장했습니다." : "저장하지 못했습니다.")
  }

  const picture = videoHeight(layout)

  return (
    <Card>
      <Card.Header>
        <Card.Title>화면 칸</Card.Title>
        <Card.Description>
          9:16 화면을 제목, 영상, 자막으로 나눕니다. 제목과 자막 높이를 바꾸면 영상 높이는 남은 칸이 됩니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="mx-auto flex aspect-[9/16] w-40 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
          <Band height={layout.titleHeight} className="bg-foreground text-background">
            제목 {layout.titleHeight}%
          </Band>
          <Band height={picture} className="bg-surface-secondary text-foreground">
            영상 {picture}%
          </Band>
          <Band height={layout.subtitleHeight} className="bg-foreground text-background">
            자막 {layout.subtitleHeight}%
          </Band>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <HeightSlider
            label="제목 높이"
            value={layout.titleHeight}
            maxValue={Math.min(40, 60 - layout.subtitleHeight)}
            onChange={(value) => apply("title", value)}
            onChangeEnd={(value) => void save(apply("title", value))}
          />
          <HeightSlider
            label="자막 높이"
            value={layout.subtitleHeight}
            maxValue={Math.min(30, 60 - layout.titleHeight)}
            onChange={(value) => apply("subtitle", value)}
            onChangeEnd={(value) => void save(apply("subtitle", value))}
          />
          <p className="text-sm text-muted">영상 높이 {picture}%. 가운데 칸은 직접 줄이지 않습니다.</p>
          {note ? <p className="text-sm text-muted">{note}</p> : null}
        </div>
      </Card.Content>
    </Card>
  )
}

function Band({
  height,
  className,
  children,
}: {
  height: number
  className: string
  children: ReactNode
}) {
  return (
    <div className={`flex items-center justify-center px-2 text-center text-xs ${className}`} style={{ height: `${height}%` }}>
      {children}
    </div>
  )
}

function HeightSlider({
  label,
  value,
  maxValue,
  onChange,
  onChangeEnd,
}: {
  label: string
  value: number
  maxValue: number
  onChange: (value: number | number[]) => void
  onChangeEnd: (value: number | number[]) => void
}) {
  return (
    <Slider
      aria-label={label}
      minValue={10}
      maxValue={maxValue}
      step={1}
      value={value}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{label}</span>
        <Slider.Output className="text-sm text-muted" />
      </div>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  )
}
