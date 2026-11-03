"use client"

import { useEffect, useState } from "react"
import Image from "next/image"

import {
  AlertDialog,
  Button,
  Card,
  Chip,
  Input,
  Switch,
  TextField,
} from "@heroui/react"
import {
  CHARACTER_ANGLES,
  CHARACTER_SOURCE_GROUPS,
} from "@/lib/character-angles"

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
  hostId: string
  canGenerate: boolean
  activeReferences: { id: string; url: string }[]
}

const emptyLibrary: CharacterLibrary = {
  outfits: [],
  hostId: "",
  canGenerate: false,
  activeReferences: [],
}

export function CharacterPanel({ profileId }: { profileId: string }) {
  const [library, setLibrary] = useState<CharacterLibrary>(emptyLibrary)
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    void fetch(`/api/character?profileId=${encodeURIComponent(profileId)}`)
      .then(async (response) => {
        if (response.ok && !stop) {
          setLibrary((await response.json()) as CharacterLibrary)
        }
      })
      .catch(() => undefined)
    return () => {
      stop = true
    }
  }, [profileId])

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
    const response = await fetch(
      `/api/character/outfits?profileId=${encodeURIComponent(profileId)}`,
      { method: "POST" }
    )
    setPending(false)
    await applyLibrary(response, "인물을 추가했습니다.")
  }

  async function uploadFront(outfitId: string, file: File | undefined) {
    if (!file) {
      return
    }
    setPending(true)
    const form = new FormData()
    form.append("outfitId", outfitId)
    form.append("front", file)
    const response = await fetch(
      `/api/character?profileId=${encodeURIComponent(profileId)}`,
      {
        method: "POST",
        body: form,
      }
    )
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
    setNote("정면을 보고 누락된 캐릭터 소스만 그리는 중입니다.")
    const response = await fetch(
      `/api/character/angles?outfitId=${encodeURIComponent(outfitId)}&profileId=${encodeURIComponent(profileId)}`,
      { method: "POST" }
    )
    setPending(false)
    setDrawingId(null)
    if (!response.ok) {
      setNote("각도를 그리지 못했습니다.")
      return
    }
    setLibrary((await response.json()) as CharacterLibrary)
    setNote("누락된 캐릭터 소스를 이 섹션에 등록했습니다.")
  }

  async function deleteSection() {
    if (!confirmDeleteId) {
      return
    }
    setPending(true)
    const response = await fetch(
      `/api/character/outfits/${encodeURIComponent(confirmDeleteId)}?profileId=${encodeURIComponent(profileId)}`,
      { method: "DELETE" }
    )
    setPending(false)
    setConfirmDeleteId(null)
    await applyLibrary(response, "인물을 삭제했습니다.")
  }

  async function rename(outfitId: string, name: string) {
    const response = await fetch(
      `/api/character/outfits/${encodeURIComponent(outfitId)}?profileId=${encodeURIComponent(profileId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }
    )
    if (response.ok) {
      setLibrary((await response.json()) as CharacterLibrary)
    }
  }

  async function setActive(outfitId: string, active: boolean) {
    if (outfitId === library.hostId) {
      return
    }
    setPending(true)
    const response = await fetch(
      `/api/character/outfits/${encodeURIComponent(outfitId)}?profileId=${encodeURIComponent(profileId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      }
    )
    setPending(false)
    await applyLibrary(
      response,
      active ? "이 인물을 활용합니다." : "이 인물은 대본에서 고르지 않습니다."
    )
  }

  const deleteOutfit = library.outfits.find(
    (outfit) => outfit.id === confirmDeleteId
  )

  return (
    <>
      <p className="text-sm text-muted">
        인물마다 정면과 각도를 등록합니다. 진행자는 항상 활용되고, 켠 보조
        인물만 대본에서 고를 수 있습니다. 끈 인물은 지워지지 않습니다.
      </p>

      <div className="flex flex-col gap-4">
        {library.outfits.map((outfit) => (
          <OutfitSection
            key={`${outfit.id}:${outfit.name}`}
            outfit={outfit}
            pending={pending}
            drawing={drawingId === outfit.id}
            host={outfit.id === library.hostId}
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
        <Button
          variant="outline"
          isDisabled={pending}
          onPress={() => void addSection()}
        >
          인물 추가
        </Button>
      </div>

      <AlertDialog
        isOpen={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container placement="center">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>이 인물을 삭제할까요?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {deleteOutfit
                  ? `${deleteOutfit.name}과 그 안의 정면, 나머지 각도 이미지가 삭제됩니다.`
                  : "이 인물과 그 안의 이미지가 삭제됩니다."}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="outline"
                  isDisabled={pending}
                  onPress={() => setConfirmDeleteId(null)}
                >
                  취소
                </Button>
                <Button
                  variant="danger"
                  isDisabled={pending}
                  onPress={() => void deleteSection()}
                >
                  인물 삭제
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
  host,
  onRename,
  onActive,
  onDelete,
  onUpload,
  onMakeAngles,
}: {
  outfit: CharacterOutfit
  pending: boolean
  drawing: boolean
  host: boolean
  onRename: (name: string) => void
  onActive: (active: boolean) => void
  onDelete: () => void
  onUpload: (file: File | undefined) => void
  onMakeAngles: () => void
}) {
  const [name, setName] = useState(outfit.name)

  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-separator p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {host ? (
            <Chip size="sm" variant="soft">
              진행자
            </Chip>
          ) : null}
          <TextField
            aria-label="인물 이름"
            value={name}
            onChange={setName}
            className="w-40"
          >
            <Input
              onBlur={() => {
                if (name.trim() && name.trim() !== outfit.name) {
                  onRename(name.trim())
                }
              }}
            />
          </TextField>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            isSelected={host || outfit.active}
            isDisabled={pending || host}
            onChange={onActive}
            aria-label="이 인물 활용"
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              이 인물 활용
            </Switch.Content>
          </Switch>
          {host ? null : (
            <Button variant="outline" isDisabled={pending} onPress={onDelete}>
              인물 삭제
            </Button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-fit self-start">
          <Card.Header>
            <Card.Title>정면</Card.Title>
            <Card.Description>
              이 인물의 기준이 되는 한 장입니다.
            </Card.Description>
          </Card.Header>
          <Card.Content className="grow-0">
            <FrontDrop
              image={outfit.front}
              pending={pending}
              onFile={onUpload}
            />
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>캐릭터 소스</Card.Title>
            <Card.Description>
              기본 각도, 제스처, 표정과 부리를 이 인물에서만 씁니다.
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            {CHARACTER_SOURCE_GROUPS.map((group) => {
              const definitions = CHARACTER_ANGLES.filter(
                (angle) => angle.group === group.id
              )
              const slots = definitions.map(
                (definition) =>
                  outfit.angles.find(
                    (angle) => angle.key === definition.key
                  ) ?? { ...definition, image: null }
              )
              return (
                <section key={group.id} className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium">{group.label}</h4>
                  <div className="grid grid-cols-3 gap-3 xl:grid-cols-5">
                    {slots.map((angle) => (
                      <figure key={angle.key} className="flex flex-col gap-2">
                        {angle.image ? (
                          <Image
                            src={angle.image.url}
                            alt={angle.label}
                            width={240}
                            height={320}
                            unoptimized
                            className="aspect-[3/4] w-full rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg border border-dashed border-separator px-2 text-center text-xs text-muted">
                            만들기 전
                          </div>
                        )}
                        <figcaption className="text-center text-sm">
                          {angle.label}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              )
            })}
            <div className="mt-auto flex flex-col items-end gap-2">
              {outfit.angles.some((angle) => !angle.image) ? (
                <Button
                  isDisabled={pending || !outfit.front}
                  onPress={onMakeAngles}
                >
                  {drawing ? "그리는 중" : "누락된 소스만 만들기"}
                </Button>
              ) : (
                <p className="text-right text-sm text-muted">
                  등록된 각도입니다. 이 칸을 지우기 전까지 이 묶음을 씁니다.
                </p>
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
      <Image
        src={image.url}
        alt="등록한 정면 캐릭터"
        width={256}
        height={341}
        unoptimized
        className="aspect-[3/4] w-full rounded-lg object-cover"
      />
    )
  }

  return (
    <label
      className="flex min-h-80 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-separator px-4 py-6 text-center text-sm break-keep text-muted"
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
