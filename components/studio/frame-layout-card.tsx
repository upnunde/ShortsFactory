"use client"

import { useEffect, useRef, useState } from "react"

import { Card, Label, ListBox, Select } from "@heroui/react"
import { ShortsFrame } from "@/components/studio/shorts-frame"
import {
  defaultFrameLayout,
  FONT_WEIGHTS,
  OUTPUT_SIZES,
  setFontWeight,
  setOutputSize,
  setSubtitleSize,
  setSubtitleY,
  setTitleBandPercent,
  setTitleSize,
  titleCharacterLimit,
  type FrameLayout,
} from "@/lib/frame-layout"

export function FrameLayoutCard({ profileId }: { profileId: string }) {
  const [layout, setLayout] = useState<FrameLayout>(defaultFrameLayout)
  const [note, setNote] = useState("")
  const layoutRef = useRef(defaultFrameLayout)

  useEffect(() => {
    void fetch(`/api/layout?profileId=${encodeURIComponent(profileId)}`)
      .then(async (response) => {
        if (response.ok) {
          const saved = (await response.json()) as FrameLayout
          layoutRef.current = saved
          setLayout(saved)
        }
      })
      .catch(() => undefined)
  }, [profileId])

  function update(next: FrameLayout) {
    layoutRef.current = next
    setLayout(next)
    return next
  }

  async function save(next: FrameLayout) {
    setNote("")
    const response = await fetch(
      `/api/layout?profileId=${encodeURIComponent(profileId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      }
    )
    setNote(response.ok ? "저장했습니다." : "저장하지 못했습니다.")
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>글꼴과 자막</Card.Title>
        <Card.Description>
          최종 쇼츠 해상도와 제목 영역, 글꼴과 자막 위치를 정합니다. 장면 영상은
          제목 아래 영역에 들어갑니다.
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
            aria-label="최종 해상도"
            selectedKey={layout.outputSize}
            onSelectionChange={(key) => {
              if (key != null) {
                void save(update(setOutputSize(layoutRef.current, String(key))))
              }
            }}
          >
            <Label>최종 쇼츠 해상도</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {OUTPUT_SIZES.map((item) => (
                  <ListBox.Item
                    key={item.id}
                    id={item.id}
                    textValue={item.label}
                  >
                    {item.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
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
            label="제목 영역 높이"
            value={layout.titleBandPercent}
            min={18}
            max={35}
            suffix="%"
            onChange={(value) =>
              update(setTitleBandPercent(layoutRef.current, value))
            }
            onChangeEnd={(value) =>
              void save(update(setTitleBandPercent(layoutRef.current, value)))
            }
          />
          <SizeSlider
            label={`제목 크기 · 영문 최대 ${titleCharacterLimit(layout.titleSize)}자`}
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
            글자 크기는 900px 너비 기준입니다. 자막 높이 75%가 기본 자리입니다.
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
