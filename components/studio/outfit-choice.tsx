"use client"

import { useEffect, useState } from "react"

import { Label, ListBox, Select } from "@heroui/react"

type OutfitOption = {
  id: string
  name: string
  active: boolean
  imageCount: number
}

function resolveOutfit(outfits: OutfitOption[], outfitId: string | null) {
  if (outfitId) {
    const picked = outfits.find((outfit) => outfit.id === outfitId)
    if (picked) {
      return picked
    }
  }
  return outfits.find((outfit) => outfit.active) ?? null
}

function useOutfits() {
  const [outfits, setOutfits] = useState<OutfitOption[]>([])

  useEffect(() => {
    void fetch("/api/character")
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          body: {
            outfits?: {
              id: string
              name: string
              active: boolean
              front: { url: string } | null
              angles: { image: { url: string } | null }[]
            }[]
          } | null,
        ) => {
          setOutfits(
            (body?.outfits ?? []).map((outfit) => ({
              id: outfit.id,
              name: outfit.name,
              active: outfit.active,
              imageCount: (outfit.front ? 1 : 0) + outfit.angles.filter((angle) => angle.image).length,
            })),
          )
        },
      )
  }, [])

  return outfits
}

export function OutfitPicker({
  outfitId,
  onChange,
}: {
  outfitId: string | null
  onChange: (outfitId: string | null) => void
}) {
  const outfits = useOutfits()
  const selected = resolveOutfit(outfits, outfitId)

  function pick(value: string) {
    const active = outfits.find((outfit) => outfit.active)
    onChange(active && value === active.id ? null : value)
  }

  if (!selected) {
    return null
  }

  return (
    <Select
      aria-label="이번 영상 캐릭터"
      selectedKey={selected.id}
      onSelectionChange={(key) => {
        if (key != null) {
          pick(String(key))
        }
      }}
    >
      <Label>이번 영상 캐릭터</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {outfits.map((outfit) => (
            <ListBox.Item key={outfit.id} id={outfit.id} textValue={outfit.name}>
              {outfit.name}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

export function OutfitUsage({ outfitId }: { outfitId: string | null }) {
  const outfits = useOutfits()
  const selected = resolveOutfit(outfits, outfitId)
  if (!selected) {
    return null
  }
  const followingActive = !outfitId || selected.active
  return (
    <p className="text-sm text-muted">
      {followingActive
        ? `이 영상에는 켜 둔 ${selected.name} 사진 ${selected.imageCount}장이 같이 나갑니다.`
        : `이 영상에는 고른 ${selected.name} 사진 ${selected.imageCount}장이 같이 나갑니다.`}
    </p>
  )
}
