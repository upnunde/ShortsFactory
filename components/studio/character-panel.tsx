"use client"

import { useEffect, useState } from "react"

import { AlertDialog, Button, Card, Input, Switch, TextField } from "@heroui/react"
import { CHARACTER_ANGLES } from "@/lib/character-angles"
import { StepHeader } from "@/components/studio/chrome"

type CharacterFile = {
  id: string
  url: string
}

type CharacterOutfit = {
  id: string
  name: string
  active: boolean
  front: CharacterFile | null
  angles: { key: string; label: string; image: CharacterFile | null }[]
}

type CharacterLibrary = {
  outfits: CharacterOutfit[]
  canGenerate: boolean
  activeReferences: { id: string; url: string }[]
}

const emptyLibrary: CharacterLibrary = {
  outfits: [],
  canGenerate: false,
  activeReferences: [],
}

export function CharacterPanel() {
  const [library, setLibrary] = useState<CharacterLibrary>(emptyLibrary)
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    const response = await fetch("/api/character")
    if (response.ok) {
      setLibrary((await response.json()) as CharacterLibrary)
    }
  }

  async function applyLibrary(response: Response, message: string) {
    if (!response.ok) {
      setNote("저장하지 못했습니다.")
      return
    }
    setLibrary((await response.json()) as CharacterLibrary)
    setNote(message)
  }

  async function addSection() {
    setPending(true)
    const response = await fetch("/api/character/outfits", { method: "POST" })
    setPending(false)
    await applyLibrary(response, "착장 섹션을 추가했습니다.")
  }

  async function uploadFront(outfitId: string, file: File | undefined) {
    if (!file) {
      return
    }
    setPending(true)
    const form = new FormData()
    form.append("outfitId", outfitId)
    form.append("front", file)
    const response = await fetch("/api/character", { method: "POST", body: form })
    setPending(false)
    if (!response.ok) {
      setNote("png, jpg, webp 정면 한 장만 올릴 수 있습니다.")
      return
    }
    setLibrary((await response.json()) as CharacterLibrary)
    setNote("정면을 등록했습니다. 나머지 각도는 오른쪽에서 한 번만 만듭니다.")
  }

  async function makeAngles(outfitId: string) {
    setPending(true)
    setDrawingId(outfitId)
    setNote("정면을 보고 각도를 그리는 중입니다.")
    const response = await fetch(`/api/character/angles?outfitId=${encodeURIComponent(outfitId)}`, { method: "POST" })
    setPending(false)
    setDrawingId(null)
    if (!response.ok) {
      setNote("각도를 그리지 못했습니다.")
      return
    }
    setLibrary((await response.json()) as CharacterLibrary)
    setNote("나머지 각도를 그려 이 섹션에 등록했습니다.")
  }

  async function deleteSection() {
    if (!confirmDeleteId) {
      return
    }
    setPending(true)
    const response = await fetch(`/api/character/outfits/${encodeURIComponent(confirmDeleteId)}`, {
      method: "DELETE",
    })
    setPending(false)
    setConfirmDeleteId(null)
    await applyLibrary(response, "섹션을 삭제했습니다.")
  }

  async function rename(outfitId: string, name: string) {
    const response = await fetch(`/api/character/outfits/${encodeURIComponent(outfitId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      setLibrary((await response.json()) as CharacterLibrary)
    }
  }

  async function setActive(outfitId: string, active: boolean) {
    if (!active) {
      return
    }
    setPending(true)
    const response = await fetch(`/api/character/outfits/${encodeURIComponent(outfitId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    })
    setPending(false)
    await applyLibrary(response, "이 착장만 영상 요청에 같이 나갑니다.")
  }

  const deleteOutfit = library.outfits.find((outfit) => outfit.id === confirmDeleteId)

  return (
    <>
      <StepHeader
        title="대표 캐릭터"
        description="착장마다 정면과 각도를 따로 등록합니다. 켠 착장 하나만 영상 요청에 같이 나가고, 끈 착장은 지워지지 않습니다."
      />

      <div className="flex items-start gap-4 overflow-x-auto pb-1">
        {library.outfits.map((outfit) => (
          <OutfitSection
            key={outfit.id}
            outfit={outfit}
            pending={pending}
            drawing={drawingId === outfit.id}
            beside={library.outfits.length > 1}
            onRename={(name) => void rename(outfit.id, name)}
            onActive={(active) => void setActive(outfit.id, active)}
            onDelete={() => setConfirmDeleteId(outfit.id)}
            onUpload={(file) => void uploadFront(outfit.id, file)}
            onMakeAngles={() => void makeAngles(outfit.id)}
          />
        ))}
      </div>

      {note ? <p className="text-right text-sm text-muted">{note}</p> : null}

      <div className="flex justify-end">
        <Button variant="outline" isDisabled={pending} onPress={() => void addSection()}>
          착장 추가
        </Button>
      </div>

      <AlertDialog isOpen={confirmDeleteId !== null} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container placement="center">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>이 섹션을 삭제할까요?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {deleteOutfit
                  ? `${deleteOutfit.name} 섹션과 그 안의 정면, 나머지 각도 이미지가 삭제됩니다.`
                  : "이 섹션과 그 안의 이미지가 삭제됩니다."}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="outline" isDisabled={pending} onPress={() => setConfirmDeleteId(null)}>
                  취소
                </Button>
                <Button variant="danger" isDisabled={pending} onPress={() => void deleteSection()}>
                  섹션 삭제
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </>
  )
}

function OutfitSection({
  outfit,
  pending,
  drawing,
  beside,
  onRename,
  onActive,
  onDelete,
  onUpload,
  onMakeAngles,
}: {
  outfit: CharacterOutfit
  pending: boolean
  drawing: boolean
  beside: boolean
  onRename: (name: string) => void
  onActive: (active: boolean) => void
  onDelete: () => void
  onUpload: (file: File | undefined) => void
  onMakeAngles: () => void
}) {
  const [name, setName] = useState(outfit.name)

  useEffect(() => {
    setName(outfit.name)
  }, [outfit.name])

  return (
    <section
      className={`flex shrink-0 flex-col gap-4 rounded-xl border border-separator p-4 ${beside ? "w-[42rem]" : "w-full"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TextField aria-label="착장 이름" value={name} onChange={setName} className="w-40">
          <Input
            onBlur={() => {
              if (name.trim() && name.trim() !== outfit.name) {
                onRename(name.trim())
              }
            }}
          />
        </TextField>
        <div className="flex items-center gap-3">
          <Switch isSelected={outfit.active} isDisabled={pending} onChange={onActive} aria-label="이 착장 사용">
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              이 착장 사용
            </Switch.Content>
          </Switch>
          <Button variant="outline" isDisabled={pending} onPress={onDelete}>
            섹션 삭제
          </Button>
        </div>
      </div>

      <div className="grid items-stretch gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-full">
          <Card.Header>
            <Card.Title>정면</Card.Title>
            <Card.Description>이 착장의 기준이 되는 한 장입니다.</Card.Description>
          </Card.Header>
          <Card.Content className="h-full">
            <FrontDrop image={outfit.front} pending={pending} onFile={onUpload} />
          </Card.Content>
        </Card>

        <Card className="h-full">
          <Card.Header>
            <Card.Title>나머지 각도</Card.Title>
            <Card.Description>이 착장에서만 씁니다.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3 xl:grid-cols-5">
              {(outfit.angles.length > 0 ? outfit.angles : CHARACTER_ANGLES.map((angle) => ({ ...angle, image: null }))).map(
                (angle) => (
                  <figure key={angle.key} className="flex flex-col gap-2">
                    {angle.image ? (
                      <img
                        src={angle.image.url}
                        alt={angle.label}
                        className="aspect-[3/4] w-full rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg border border-dashed border-separator px-2 text-center text-xs text-muted">
                        만들기 전
                      </div>
                    )}
                    <figcaption className="text-center text-sm">{angle.label}</figcaption>
                  </figure>
                ),
              )}
            </div>
            <div className="mt-auto flex flex-col items-end gap-2">
              {outfit.angles.some((angle) => !angle.image) ? (
                <Button isDisabled={pending || !outfit.front} onPress={onMakeAngles}>
                  {drawing ? "그리는 중" : "나머지 각도 만들기"}
                </Button>
              ) : (
                <p className="text-right text-sm text-muted">등록된 각도입니다. 이 칸을 지우기 전까지 이 묶음을 씁니다.</p>
              )}
            </div>
          </Card.Content>
        </Card>
      </div>
    </section>
  )
}

function FrontDrop({
  image,
  pending,
  onFile,
}: {
  image: CharacterFile | null
  pending: boolean
  onFile: (file: File | undefined) => void
}) {
  if (image) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-separator px-4 py-6">
        <img src={image.url} alt="등록한 정면 캐릭터" className="aspect-[3/4] w-full max-w-52 rounded-lg object-cover" />
      </div>
    )
  }

  return (
    <label
      className="flex h-full min-h-80 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-separator px-4 py-6 text-center text-sm break-keep text-muted"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onFile(event.dataTransfer.files[0])
      }}
    >
      <span>
        정면 한 장
        <br />
        놓거나 눌러서 선택
      </span>
      <input
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={pending}
        onChange={(event) => {
          onFile(event.target.files?.[0])
          event.target.value = ""
        }}
      />
    </label>
  )
}
