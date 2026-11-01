"use client"

import { useEffect, useRef, useState } from "react"

import { Card, Label, ListBox, Select } from "@heroui/react"
import { ShortsFrame } from "@/components/studio/shorts-frame"
import {
  defaultFrameLayout,
  FONT_WEIGHTS,
  setFontWeight,
  setSubtitleSize,
  setSubtitleY,
  setTitleSize,
  type FrameLayout,
} from "@/lib/frame-layout"

export function FrameLayoutCard() {
  const [layout, setLayout] = useState<FrameLayout>(defaultFrameLayout)
  const [note, setNote] = useState("")
  const layoutRef = useRef(defaultFrameLayout)

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

  function update(next: FrameLayout) {
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

  return (
    <Card>
      <Card.Header>
        <Card.Title>글꼴과 자막</Card.Title>
        <Card.Description>
          화면 형태는 고정입니다. 글꼴, 크기, 두께와 자막이 놓이는 높이만
          바꿉니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <ShortsFrame
          title={"제목이 2줄 일 경우\n예시 화면"}
          subtitle={"자막이 2줄 일 경우\n예시화면 최대 2줄까지만 허용"}
          layout={layout}
          className="w-40"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Select
            aria-label="글꼴"
            selectedKey={layout.fontFamily}
            onSelectionChange={() => undefined}
          >
            <Label>글꼴</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="pretendard" textValue="Pretendard">
                  Pretendard
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            aria-label="두께"
            selectedKey={String(layout.fontWeight)}
            onSelectionChange={(key) => {
              if (key == null) {
                return
              }
              void save(update(setFontWeight(layoutRef.current, Number(key))))
            }}
          >
            <Label>두께</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {FONT_WEIGHTS.map((item) => (
                  <ListBox.Item
                    key={item.weight}
                    id={String(item.weight)}
                    textValue={item.label}
                  >
                    {item.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <SizeSlider
            label="제목 크기"
            value={layout.titleSize}
            min={36}
            max={96}
            onChange={(value) => update(setTitleSize(layoutRef.current, value))}
            onChangeEnd={(value) =>
              void save(update(setTitleSize(layoutRef.current, value)))
            }
          />
          <SizeSlider
            label="자막 크기"
            value={layout.subtitleSize}
            min={28}
            max={80}
            onChange={(value) =>
              update(setSubtitleSize(layoutRef.current, value))
            }
            onChangeEnd={(value) =>
              void save(update(setSubtitleSize(layoutRef.current, value)))
            }
          />
          <SizeSlider
            label="자막 높이"
            value={layout.subtitleY}
            min={28}
            max={92}
            suffix="%"
            onChange={(value) => update(setSubtitleY(layoutRef.current, value))}
            onChangeEnd={(value) =>
              void save(update(setSubtitleY(layoutRef.current, value)))
            }
          />
          <p className="text-sm text-muted">
            크기는 900×1600 기준입니다. 자막 높이 75%가 기본 자리입니다.
          </p>
          {note ? <p className="text-sm text-muted">{note}</p> : null}
        </div>
      </Card.Content>
    </Card>
  )
}

function SizeSlider({
  label,
  value,
  min,
  max,
  suffix = "",
  onChange,
  onChangeEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
  onChangeEnd: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="text-sm text-muted">
          {value}
          {suffix}
        </span>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onPointerUp={(event) => onChangeEnd(Number(event.currentTarget.value))}
        onKeyUp={(event) => onChangeEnd(Number(event.currentTarget.value))}
        className="w-full accent-foreground"
      />
    </label>
  )
}
