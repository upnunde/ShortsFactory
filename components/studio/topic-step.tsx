"use client"

import { Button, Card, Label, TextArea, TextField } from "@heroui/react"
import { StepHeader } from "@/components/studio/chrome"
import { PlaceNote } from "@/components/studio/place-note"

export function TopicStep({
  topic,
  titleKo,
  topicEn,
  overviewKo,
  overviewEn,
  placeKo,
  planReady,
  onTopicChange,
  onTitleKoChange,
  onTopicEnChange,
  onOverviewChange,
  onOverviewEnChange,
  onPlaceChange,
  onWrite,
  onApply,
  onRewritePlace,
  writeBusy,
  applyBusy,
  placeBusy,
  error,
}: {
  topic: string
  titleKo: string
  topicEn: string
  overviewKo: string
  overviewEn: string
  placeKo: string
  planReady: boolean
  onTopicChange: (topic: string) => void
  onTitleKoChange: (titleKo: string) => void
  onTopicEnChange: (topicEn: string) => void
  onOverviewChange: (overviewKo: string) => void
  onOverviewEnChange: (overviewEn: string) => void
  onPlaceChange: (placeKo: string) => void
  onWrite: () => void
  onApply: () => void
  onRewritePlace: (note: string) => Promise<boolean>
  writeBusy: boolean
  applyBusy: boolean
  placeBusy: boolean
  error: string
}) {
  const busy = writeBusy || applyBusy || placeBusy

  return (
    <>
      <StepHeader
        title="주제"
        description="작성을 누르면 전체 내용과 진행 자리가 먼저 나옵니다. 캐릭터는 그 자리에서 설명하고, 주제 속으로 들어가지 않습니다."
      />

      <Card>
        <Card.Content className="flex flex-col gap-4">
          <TextField value={topic} onChange={onTopicChange} fullWidth>
            <Label>주제</Label>
            <TextArea rows={3} placeholder="갑자기 궁금한 내용을 한 줄로" />
          </TextField>
          <div className="flex justify-end">
            <Button isDisabled={topic.trim() === "" || busy} onPress={onWrite}>
              {writeBusy ? "쓰는 중" : "작성"}
            </Button>
          </div>
        </Card.Content>
      </Card>

      {planReady ? (
        <Card>
          <Card.Header>
            <Card.Title>작성 결과</Card.Title>
            <Card.Description>
              왼쪽은 한글, 오른쪽은 그 문장의 영어입니다. 제목은 말한 듯한
              한 문장이고, 영문 제목이 영상 위에 들어갑니다.
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <p className="text-sm font-medium">한글</p>
                <TextField value={titleKo} onChange={onTitleKoChange} fullWidth>
                  <Label>제목</Label>
                  <TextArea rows={2} />
                </TextField>
                <TextField value={overviewKo} onChange={onOverviewChange} fullWidth>
                  <Label>본문</Label>
                  <TextArea rows={10} />
                </TextField>
              </div>
              <div className="flex flex-col gap-4">
                <p className="text-sm font-medium">영문</p>
                <TextField value={topicEn} onChange={onTopicEnChange} fullWidth>
                  <Label>제목</Label>
                  <TextArea rows={2} />
                </TextField>
                <TextField
                  value={overviewEn}
                  onChange={onOverviewEnChange}
                  fullWidth
                >
                  <Label>본문</Label>
                  <TextArea rows={10} />
                </TextField>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">
                늘 같은 자리에서 설명합니다. 주제의 장소로 옮기거나 옷을 바꾸지
                않습니다.
              </p>
              <TextField value={placeKo} onChange={onPlaceChange} fullWidth>
                <Label>진행 자리</Label>
                <TextArea rows={4} />
              </TextField>
            </div>
            <PlaceNote
              busy={placeBusy}
              disabled={busy && !placeBusy}
              onRewrite={onRewritePlace}
            />
          </Card.Content>
        </Card>
      ) : null}

      <div className="flex flex-col items-end gap-2">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {planReady ? null : (
          <p className="text-right text-sm text-muted">
            작성을 먼저 누르면 대본을 만들 수 있습니다.
          </p>
        )}
        <Button
          isDisabled={
            busy ||
            !planReady ||
            overviewKo.trim() === "" ||
            placeKo.trim() === ""
          }
          onPress={onApply}
        >
          {applyBusy ? "만드는 중" : "대본 만들기"}
        </Button>
      </div>
    </>
  )
}
