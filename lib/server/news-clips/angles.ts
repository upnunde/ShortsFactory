import { claudeText } from "@/lib/server/anthropic"
import {
  normalizeAngleOptions,
  type NewsAngleOption,
} from "@/lib/news-clips/angles"
import { parseTranscript } from "@/lib/news-clips/transcript"
import type { NewsClipProductionMode } from "@/lib/news-clips/types"

function stripFence(value: string) {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
}

export async function extractNewsAngles(
  transcriptText: string,
  options: {
    productionMode: NewsClipProductionMode
    sourceTitle?: string
    issueTitle?: string
    directSource?: boolean
  }
): Promise<NewsAngleOption[]> {
  const transcript = parseTranscript(transcriptText)
    .slice(0, 160)
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
    }))
  if (transcript.length === 0) return []

  const response = await claudeText(
    [
      "너는 시사 쇼츠 기획자다.",
      "원본 자막을 보고, 이 영상으로 만들 수 있는 핵심 콘텐츠 각도 5~6개를 뽑는다.",
      "각 항목은 원본에 실제로 나온 주장·수치·장면·발언만 근거로 한다. 없는 사실을 만들지 않는다.",
      "항목끼리 논점이 겹치지 않게 서로 다른 각도여야 한다.",
      "title은 시청자가 고르기 쉬운 짧은 한국어 훅(18자 내외)이다.",
      "summary는 무엇을 다룰지 보여주는 한 줄 설명이다.",
      "keywords는 원본 자막에서 확인되는 핵심어 2~4개다.",
      "각 각도마다 그 주제를 가장 잘 보여주는 연속 발언 구간 sourceStart·sourceEnd(초)를 반드시 넣는다.",
      "sourceStart/sourceEnd는 transcript의 start/end 타임코드를 따른다.",
      "고정된 목표 시간은 없다. 자연스럽게 시작하고 현재 문장과 생각이 완전히 끝나는 지점까지 포함한다.",
      "구간에 해당 각도의 핵심 발언이 실제로 들어 있어야 한다. 다른 각도 구간과 과도하게 겹치지 않게 한다.",
      options.directSource
        ? "사용자가 지정한 원본 영상이다. 영상 내용 자체를 기준으로 각도를 뽑는다."
        : "선택된 이슈가 있으면 그 이슈와 연결되는 각도를 우선한다.",
      options.productionMode === "buildup2"
        ? "빌드업형: 짧은 TTS 서두에서 원본 핵심 발언으로 자연스럽게 넘길 수 있는 각도를 우선한다."
        : "보도형: 짧은 논평 대본으로 풀어낼 수 있는 각도를 우선한다.",
      "JSON 배열만 출력한다: [{id,title,summary,keywords:string[],sourceStart:number,sourceEnd:number}]",
    ].join("\n"),
    JSON.stringify({
      productionMode: options.productionMode,
      sourceTitle: options.sourceTitle ?? "",
      issueTitle: options.issueTitle ?? "",
      directSource: options.directSource === true,
      transcript,
    }),
    1400
  )
  return normalizeAngleOptions(JSON.parse(stripFence(response))).map(
    (angle) => ({
      ...angle,
      evidence: transcript
        .filter(
          (segment) =>
            segment.end > angle.sourceStart && segment.start < angle.sourceEnd
        )
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 260),
    })
  )
}
