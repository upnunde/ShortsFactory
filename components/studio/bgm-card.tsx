"use client"

import { useEffect, useRef, useState } from "react"

import { Button, Card, Chip, Label, ListBox, Select } from "@heroui/react"

export type BgmTrack = {
  id: string
  name: string
}

type BgmLibrary = {
  defaultId: string
  tracks: BgmTrack[]
}

export function useBgmLibrary() {
  const [library, setLibrary] = useState<BgmLibrary>({
    defaultId: "stella-waltz",
    tracks: [],
  })

  useEffect(() => {
    void fetch("/api/bgm")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: BgmLibrary | null) => {
        if (body?.tracks) {
          setLibrary(body)
        }
      })
      .catch(() => undefined)
  }, [])

  return library
}

export function BgmSettingsCard() {
  const [library, setLibrary] = useState<BgmLibrary>({
    defaultId: "stella-waltz",
    tracks: [],
  })
  const [note, setNote] = useState("")
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load(setLibrary)
  }, [])

  async function add(file: File | undefined) {
    if (!file) {
      return
    }
    setPending(true)
    setNote("")
    const form = new FormData()
    form.set("file", file)
    try {
      const response = await fetch("/api/bgm", { method: "POST", body: form })
      const body = (await response.json()) as BgmLibrary & { message?: string }
      if (!response.ok || !body.tracks) {
        setNote(body.message || "곡을 추가하지 못했습니다.")
        return
      }
      setLibrary(body)
      setNote("곡을 추가했습니다.")
    } catch {
      setNote("곡을 추가하지 못했습니다.")
    } finally {
      setPending(false)
      if (inputRef.current) {
        inputRef.current.value = ""
      }
    }
  }

  async function remove(id: string) {
    setPending(true)
    setNote("")
    try {
      const response = await fetch(`/api/bgm/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      const body = (await response.json()) as BgmLibrary & { message?: string }
      if (!response.ok || !body.tracks) {
        setNote(body.message || "곡을 지우지 못했습니다.")
        return
      }
      setLibrary(body)
    } catch {
      setNote("곡을 지우지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3">
        <div>
          <Card.Title>배경음악</Card.Title>
          <Card.Description>
            기본 곡은 Stella Princess Waltz입니다. 여기서 추가한 곡을 영상을
            합칠 때 고를 수 있습니다.
          </Card.Description>
        </div>
        <Button isDisabled={pending} onPress={() => inputRef.current?.click()}>
          곡 추가
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.wav,.m4a,.aac,.flac,audio/*"
          className="hidden"
          onChange={(event) => void add(event.target.files?.[0])}
        />
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {library.tracks.map((track) => (
          <div key={track.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm">{track.name}</p>
                {track.id === library.defaultId ? (
                  <Chip size="sm" variant="soft">
                    기본
                  </Chip>
                ) : null}
              </div>
              {track.id === library.defaultId ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={pending}
                  onPress={() => void remove(track.id)}
                >
                  삭제
                </Button>
              )}
            </div>
            <ReadyAudio id={track.id} />
          </div>
        ))}
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </Card.Content>
    </Card>
  )
}

export function BgmPicker({
  bgmId,
  onChange,
}: {
  bgmId: string
  onChange: (bgmId: string) => void
}) {
  const library = useBgmLibrary()
  const selected =
    library.tracks.find((track) => track.id === bgmId) ??
    library.tracks.find((track) => track.id === library.defaultId)

  if (!selected) {
    return <p className="text-sm text-muted">배경음악을 불러오는 중입니다.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <Select
        aria-label="이번 영상 배경음악"
        selectedKey={selected.id}
        onSelectionChange={(key) => {
          if (key != null) {
            onChange(String(key))
          }
        }}
      >
        <Label>이번 영상 배경음악</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {library.tracks.map((track) => (
              <ListBox.Item key={track.id} id={track.id} textValue={track.name}>
                {track.name}
                {track.id === library.defaultId ? " · 기본" : ""}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <ReadyAudio id={selected.id} />
      <p className="text-sm text-muted">볼륨은 20%로 고정입니다.</p>
    </div>
  )
}

const audioSources = new Map<string, Promise<string>>()

function audioSource(id: string) {
  const cached = audioSources.get(id)
  if (cached) {
    return cached
  }
  const pending = fetch(`/api/bgm/${encodeURIComponent(id)}/file`).then(
    async (response) => {
      if (!response.ok) {
        throw new Error("missing")
      }
      return URL.createObjectURL(await response.blob())
    }
  )
  audioSources.set(id, pending)
  pending.catch(() => audioSources.delete(id))
  return pending
}

function ReadyAudio({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let stop = false
    setSrc(null)
    setFailed(false)
    void audioSource(id).then(
      (url) => {
        if (!stop) {
          setSrc(url)
        }
      },
      () => {
        if (!stop) {
          setFailed(true)
        }
      }
    )
    return () => {
      stop = true
    }
  }, [id])

  if (failed) {
    return <p className="text-sm text-muted">음악을 불러오지 못했습니다.</p>
  }
  if (!src) {
    return <p className="text-sm text-muted">음악을 불러오는 중입니다.</p>
  }
  return <audio controls preload="auto" src={src} className="w-full" />
}

async function load(setLibrary: (library: BgmLibrary) => void) {
  try {
    const response = await fetch("/api/bgm")
    if (!response.ok) {
      return
    }
    const body = (await response.json()) as BgmLibrary
    if (body.tracks) {
      setLibrary(body)
    }
  } catch {
    return
  }
}
