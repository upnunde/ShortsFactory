import { claudeText } from "@/lib/server/anthropic"
import {
  includeLeadingContext,
  lockAngleRangeToTranscript,
  normalizeAngleOptions,
  type NewsAngleOption,
} from "@/lib/news-clips/angles"
import { snapSourceRangeToCompleteUtterance } from "@/lib/news-clips/speech-bounds"
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
    focus?: string
  }
): Promise<NewsAngleOption[]> {
  const fullTranscript = parseTranscript(transcriptText)
  const promptTranscript = fullTranscript.slice(0, 160)
  const transcript = promptTranscript
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
      "첫 발언만 들어도 누가·무엇이·어떻게 됐는지 이해되어야 한다. '살았습니다', '문제였습니다'처럼 주어나 대상이 빠진 결론부터 시작하지 않는다.",
      "구간에 해당 각도의 핵심 발언이 실제로 들어 있어야 한다. 다른 각도 구간과 과도하게 겹치지 않게 한다.",
      options.directSource
        ? "사용자가 지정한 원본 영상이다. 영상 내용 자체를 기준으로 각도를 뽑는다."
        : "선택된 이슈가 있으면 그 이슈와 연결되는 각도를 우선한다.",
      options.focus?.trim()
        ? "사용자가 focus에 원하는 키워드나 주요 내용을 적었다. 원본에서 실제로 확인되는 내용 중 focus와 의미가 가까운 주장·근거·발언을 최우선으로 다시 요약한다. 단어가 정확히 일치하지 않아도 같은 논점이면 포함하되, 원본에 없는 내용은 만들지 않는다."
        : "",
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
      focus: options.focus?.trim() ?? "",
      transcript,
    }),
    1400
  )
  return normalizeAngleOptions(JSON.parse(stripFence(response))).map((angle) => {
    const completed = snapSourceRangeToCompleteUtterance(
      angle.sourceStart,
      angle.sourceEnd,
      fullTranscript
    )
    const locked = includeLeadingContext(
      lockAngleRangeToTranscript(
        {
          ...angle,
          sourceStart: completed.start,
          sourceEnd: completed.end,
        },
        fullTranscript
      ),
      fullTranscript
    )
    return {
      ...locked,
      evidence: transcript
        .filter(
          (segment) =>
            segment.end > locked.sourceStart &&
            segment.start < locked.sourceEnd
        )
        .map((segment) => segment.text.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 260),
    }
  })
}
