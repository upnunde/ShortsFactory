import assert from "node:assert/strict"
import test from "node:test"

import { scoreSourceRelevance } from "./source-relevance.ts"

const context = {
  title: "농어촌 기본소득 예산과 지역화폐 논란",
  keywords: ["농어촌", "기본소득", "예산", "지역화폐"],
}

test("핵심 인물·사건과 근거가 겹치는 자료만 통과한다", () => {
  const relevant = scoreSourceRelevance(context, {
    title: "농어촌 기본소득 예산 국회 공방",
    description: "지역화폐 지급 근거와 시범사업 예산을 따져봅니다.",
    publishedAt: new Date().toISOString(),
  })
  const unrelated = scoreSourceRelevance(context, {
    title: "해외 축구 경기 하이라이트",
    description: "주말 경기 결과입니다.",
    publishedAt: new Date().toISOString(),
  })

  assert.equal(relevant.passes, true)
  assert.ok(relevant.score >= 65)
  assert.equal(unrelated.passes, false)
})

test("제목만 관련 있고 실제 자막에 근거가 없으면 실제 구간에서 제외할 수 있다", () => {
  const result = scoreSourceRelevance(context, {
    title: "농어촌 기본소득 예산 논란",
    description: "",
    transcriptExcerpt: "오늘은 전혀 다른 지역 축제 소식입니다.",
  })

  assert.equal(result.transcriptMatches.length, 0)
})

test("검색 메타데이터에 자막이 없어도 제목 핵심어 두 개가 맞으면 통과한다", () => {
  const result = scoreSourceRelevance(context, {
    title: "농어촌 기본소득 시범사업 지역 현장",
    description: "",
    transcriptExcerpt: "",
    publishedAt: new Date().toISOString(),
  })

  assert.equal(result.passes, true)
  assert.ok(result.score >= 55)
})

test("기존 프로젝트의 핵심어가 어긋나도 현재 이슈 제목을 우선한다", () => {
  const result = scoreSourceRelevance(
    {
      title: "대통령 지지율 부동산 정책 부정평가",
      keywords: ["홍콩", "매수", "의향", "해외투자"],
    },
    {
      title: "대통령 지지율 하락, 부동산 정책 부정평가 커져",
      description: "",
      publishedAt: new Date().toISOString(),
    }
  )

  assert.equal(result.passes, true)
  assert.ok(result.titleMatches.includes("지지율"))
  assert.equal(result.titleMatches.includes("홍콩"), false)
})

test("같은 정책의 일반 영상보다 선택 이슈의 구체 논점이 맞는 영상을 높게 평가한다", () => {
  const financeContext = {
    title: "월 15만원 농어촌 기본소득 확대 지자체 재정 부담 커지나",
    keywords: ["농어촌", "기본소득", "지자체", "재정", "부담"],
  }
  const generic = scoreSourceRelevance(financeContext, {
    title: "옥천 농어촌 기본소득 첫 지급 월 15만 원",
    description: "지역경제 활성화와 전입 증가 효과를 살펴봅니다.",
    publishedAt: new Date().toISOString(),
  })
  const focused = scoreSourceRelevance(financeContext, {
    title: "농어촌 기본소득 지방재정 부담, 복지 예산 삭감 논란",
    description: "지자체 분담금과 재원 문제를 따져봅니다.",
    publishedAt: new Date().toISOString(),
  })

  assert.ok(focused.score > generic.score)
})
