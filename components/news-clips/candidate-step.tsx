"use client"

import { useState } from "react"

import { Button, Card, Chip } from "@heroui/react"
import { Check } from "lucide-react"
import type { NewsClipCandidate, NewsClipProject } from "@/lib/news-clips/types"

const field =
  "w-full rounded-xl border border-separator bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"

export function NewsClipCandidateStep({
  project,
  note,
  onBack,
  onChoose,
}: {
  project: NewsClipProject
  note: string
  onBack: () => void
  onChoose: (candidate: NewsClipCandidate, title: string) => void
}) {
  const [selectedId, setSelectedId] = useState(
    project.selectedCandidateId || project.candidates[0]?.id || ""
  )
  const selected = project.candidates.find((item) => item.id === selectedId)
  const [title, setTitle] = useState(selected?.titleOptions[0] ?? "")

  return (
    <>
      <header>
        <h2 className="text-xl font-semibold">2. 후보 구간·제목 선택</h2>
        <p className="mt-1 text-sm text-muted">
          반응·맥락을 반영한 3개 후보입니다. 원본 순서는 유지됩니다.
        </p>
      </header>
      {note ? (
        <p className="rounded-xl bg-default p-3 text-sm text-muted">{note}</p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {project.candidates.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => {
              setSelectedId(candidate.id)
              setTitle(candidate.titleOptions[0] ?? "")
            }}
            className={`rounded-2xl border p-5 text-left transition ${
              selectedId === candidate.id
                ? "border-foreground bg-default"
                : "border-separator bg-surface hover:border-foreground/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <Chip
                size="sm"
                color={scoreColor(candidate.scores.total)}
                variant="soft"
              >
                {candidate.scores.total}점
              </Chip>
              <span className="text-xs text-muted">
                {time(candidate.sourceStart)} → {time(candidate.sourceEnd)}
              </span>
            </div>
            <p className="mt-4 line-clamp-4 text-sm leading-6">
              {candidate.preview}
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">
              {candidate.reason}
            </p>
            <div className="mt-4 flex items-center justify-between text-xs">
              <span>예상 {candidate.estimatedFinalSeconds.toFixed(1)}초</span>
              <span
                className={
                  candidate.contextRisk === "high"
                    ? "text-danger"
                    : "text-muted"
                }
              >
                맥락 위험 {risk(candidate.contextRisk)}
              </span>
            </div>
            {selectedId === candidate.id ? (
              <p className="mt-4 flex items-center gap-1 text-xs font-medium">
                <Check className="size-3" /> 선택됨
              </p>
            ) : null}
          </button>
        ))}
      </div>

      {selected ? (
        <Card>
          <Card.Header>
            <Card.Title>제목 후보</Card.Title>
            <Card.Description>
              선택한 제목이 프레임·본문·썸네일에 함께 적용됩니다.
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {selected.titleOptions.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-separator p-3"
              >
                <input
                  type="radio"
                  name="title"
                  checked={title === option}
                  onChange={() => setTitle(option)}
                />
                <span className="text-sm whitespace-pre-line">{option}</span>
              </label>
            ))}
            <label className="flex flex-col gap-2">
              <span className="text-sm">직접 수정</span>
              <textarea
                rows={2}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                className={field}
              />
            </label>
          </Card.Content>
        </Card>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-6 flex justify-end gap-2 border-t border-separator bg-background/95 px-6 py-3 backdrop-blur">
        <Button variant="outline" onPress={onBack}>
          이전
        </Button>
        <Button
          isDisabled={!selected || !title.trim()}
          onPress={() => selected && onChoose(selected, title.trim())}
        >
          선택
        </Button>
      </div>
    </>
  )
}

function time(seconds: number) {
  const minute = Math.floor(seconds / 60)
  return `${String(minute).padStart(2, "0")}:${(seconds - minute * 60)
    .toFixed(1)
    .padStart(4, "0")}`
}

function risk(value: NewsClipCandidate["contextRisk"]) {
  return value === "high" ? "높음" : value === "medium" ? "주의" : "낮음"
}

function scoreColor(value: number): "success" | "warning" | "default" {
  return value >= 78 ? "success" : value >= 62 ? "warning" : "default"
}
