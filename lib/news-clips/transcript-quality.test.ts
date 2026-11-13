import assert from "node:assert/strict"
import test from "node:test"

import {
  assessTranscriptQuality,
  nearbyPhraseRegeneration,
  selectTranscriptRangeReplacement,
  transcriptTextConflict,
  wordConfidenceStats,
} from "./transcript-quality.ts"
import type { TranscriptSegment } from "./types.ts"

function transcriptSegment({
  id,
  text,
  start,
  end,
  confidences,
}: {
  id: string
  text: string
  start: number
  end: number
  confidences?: number[]
}): TranscriptSegment {
  const chunks = text.split(" ").filter(Boolean)
  const duration = (end - start) / Math.max(1, chunks.length)
  return {
    id,
    text,
    start,
    end,
    speaker: "speaker-0",
    words: chunks.map((word, index) => ({
      text: word,
      start: start + duration * index,
      end: start + duration * (index + 0.9),
      confidence: confidences?.[index] ?? confidences?.at(-1),
    })),
  }
}

test("신뢰도 높은 자연 발화는 허용한다", () => {
  const candidate = [
    transcriptSegment({
      id: "natural",
      text: "대한민국 법치주의가 무너지고 있다는 주장이 현장에서 나왔습니다",
      start: 10,
      end: 15,
      confidences: Array(8).fill(0.94),
    }),
  ]
  const assessment = assessTranscriptQuality({ candidate })

  assert.equal(assessment.decision, "accept")
  assert.equal(assessment.suspicious, false)
  assert.ok(Math.abs((assessment.averageConfidence ?? 0) - 0.94) < 1e-9)
})

test("긴 전사의 전체 평균에 묻힌 국소 저신뢰 구간도 찾는다", () => {
  const segments = [
    transcriptSegment({
      id: "good-before",
      text: Array(24).fill("정상발화").join(" "),
      start: 0,
      end: 24,
      confidences: Array(24).fill(0.96),
    }),
    transcriptSegment({
      id: "bad-pocket",
      text: "한 사람 오로지 이재명의 모든 죄를 없애기",
      start: 24,
      end: 30,
      confidences: [0.057, 0.734, 0.027, 0.6, 0.0004, 0.108, 0.163],
    }),
    transcriptSegment({
      id: "good-after",
      text: Array(24).fill("후속발화").join(" "),
      start: 30,
      end: 54,
      confidences: Array(24).fill(0.95),
    }),
  ]
  const stats = wordConfidenceStats(segments)

  assert.ok((stats.averageConfidence ?? 0) > 0.8)
  assert.ok(stats.confidencePockets.length >= 1)
  assert.ok((stats.worstWindowAverageConfidence ?? 1) < 0.3)
})

test("실제 탈옥법 구간처럼 앞 문장을 저신뢰도로 조합 복사하면 거부한다", () => {
  const candidate = [
    transcriptSegment({
      id: "before",
      text: "공소 취소 특권법은 딱 한 사람 오로지 이재명을 위한 법입니다 범죄자 이재명의 모든 죄를 없애기 위한 법입니다",
      start: 108,
      end: 119.8,
      confidences: Array(17).fill(0.95),
    }),
    transcriptSegment({
      id: "hallucinated",
      text: "한 사람 오로지 이재명의 모든 죄를 없애기 위한 법입니다",
      start: 119.96,
      end: 125.66,
      confidences: [0.057, 0.734, 0.027, 0.6, 0.0004, 0.108, 0.163],
    }),
    transcriptSegment({
      id: "after",
      text: "한 사람을 위한 법을 만드는 나라 그것이 바로 독재 국가입니다 지금 대한민국이 독재 국가가 되고 있습니다",
      start: 125.8,
      end: 141,
      confidences: Array(16).fill(0.94),
    }),
  ]
  const baseline = [
    candidate[0]!,
    transcriptSegment({
      id: "actual-srt",
      text: "환호 한마디로 이재명 탈옥법입니다",
      start: 119.96,
      end: 125.66,
    }),
    candidate[2]!,
  ]
  const regeneration = nearbyPhraseRegeneration(candidate, [])
  const assessment = assessTranscriptQuality({
    candidate,
    baseline,
    range: { start: 108, end: 141 },
  })

  assert.equal(regeneration.regenerated, true)
  assert.ok(regeneration.longestMatchLength >= 5)
  assert.equal(assessment.decision, "reject")
  assert.ok(assessment.reasons.includes("nearby-phrase-regeneration"))
  assert.ok(assessment.reasons.includes("local-low-confidence-pocket"))
})

test("저장된 실제 7단어 탈옥법 환각 fixture는 전체 평균이 높아도 거부한다", () => {
  const hallucinatedWords = [
    "한",
    "사람",
    "오로지",
    "이재명의",
    "모든",
    "죄를",
    "법입니다.",
  ]
  const probabilities = [
    0.0568, 0.734, 0.0273, 0.5996, 0.00036, 0.1082, 0.16345,
  ]
  const hallucinationStart = 119.96
  const hallucinationEnd = 125.66
  const wordDuration =
    (hallucinationEnd - hallucinationStart) / hallucinatedWords.length
  const storedHallucination: TranscriptSegment = {
    id: "stored-hallucination",
    text: "한 사람 오로지 이재명의 모든 죄를 없애기 위한 법입니다.",
    start: hallucinationStart,
    end: hallucinationEnd,
    speaker: "speaker-0",
    words: hallucinatedWords.map((text, index) => ({
      text,
      start: hallucinationStart + wordDuration * index,
      end: hallucinationStart + wordDuration * (index + 0.9),
      confidence: probabilities[index],
    })),
  }
  const candidate = [
    transcriptSegment({
      id: "long-good-before",
      text: "공소 취소 특권법은 딱 한 사람 오로지 이재명을 위한 법입니다 범죄자 이재명의 모든 죄를 없애기 위한 법입니다",
      start: 83,
      end: 119.8,
      confidences: Array(17).fill(0.95),
    }),
    storedHallucination,
    transcriptSegment({
      id: "long-good-after",
      text: "한 사람을 위한 법을 만드는 나라 그것이 바로 독재 국가입니다 지금 대한민국이 독재 국가가 되고 있습니다 우리가 막아야 하지 않겠습니까",
      start: 125.8,
      end: 159,
      confidences: Array(19).fill(0.94),
    }),
  ]
  const baseline = [
    candidate[0]!,
    transcriptSegment({
      id: "stored-baseline",
      text: "[환호] 한마디로 이재명 탈옥법입니다.",
      start: hallucinationStart,
      end: hallucinationEnd,
    }),
    candidate[2]!,
  ]
  const assessment = assessTranscriptQuality({
    candidate,
    baseline,
    range: { start: 83, end: 159 },
  })

  assert.ok((assessment.averageConfidence ?? 0) > 0.75)
  assert.ok((assessment.worstWindowAverageConfidence ?? 1) < 0.3)
  assert.equal(assessment.regeneration.longestMatchLength, 3)
  assert.ok(assessment.regeneration.overlapRatio >= 0.65)
  assert.equal(assessment.regeneration.regenerated, true)
  assert.equal(assessment.decision, "reject")
  assert.ok(assessment.reasons.includes("local-low-confidence-pocket"))
  assert.ok(assessment.reasons.includes("baseline-text-conflict"))
})

test("짧고 신뢰도 높은 실제 군중 구호는 반복만으로 거부하지 않는다", () => {
  const candidate = [
    transcriptSegment({
      id: "chant",
      text: Array(18).fill("재개하라").join(" "),
      start: 50,
      end: 54,
      confidences: Array(18).fill(0.96),
    }),
  ]
  const assessment = assessTranscriptQuality({ candidate })

  assert.equal(assessment.hallucinated, true)
  assert.equal(assessment.decision, "accept")
})

test("기준 SRT와 달라도 신뢰도 높은 STT는 불일치 하나만으로 거부하지 않는다", () => {
  const candidate = [
    transcriptSegment({
      id: "candidate",
      text: "정부 발표와 달리 현장에서는 전혀 다른 증언이 나왔습니다",
      start: 10,
      end: 15,
      confidences: Array(8).fill(0.97),
    }),
  ]
  const baseline = [
    transcriptSegment({
      id: "baseline",
      text: "오늘 날씨는 맑고 바람이 약하게 불겠습니다",
      start: 10,
      end: 15,
    }),
  ]
  const conflict = transcriptTextConflict(candidate, baseline)
  const assessment = assessTranscriptQuality({ candidate, baseline })

  assert.equal(conflict.conflict, true)
  assert.equal(assessment.decision, "accept")
  assert.ok(assessment.reasons.includes("baseline-text-conflict"))
})

test("저신뢰 후보가 독립 기준 전사와도 충돌하면 재시도한다", () => {
  const candidate = [
    transcriptSegment({
      id: "candidate",
      text: "전혀 관계없는 문장을 잘못 만들어 냈습니다",
      start: 20,
      end: 25,
      confidences: Array(6).fill(0.18),
    }),
  ]
  const baseline = [
    transcriptSegment({
      id: "baseline",
      text: "국회 표결 결과가 현장에서 발표됐습니다",
      start: 20,
      end: 25,
    }),
  ]
  const assessment = assessTranscriptQuality({ candidate, baseline })

  assert.equal(assessment.decision, "retry")
  assert.ok(assessment.reasons.includes("low-word-confidence"))
  assert.ok(assessment.reasons.includes("baseline-text-conflict"))
})

test("길고 저신뢰인 단일 구호 반복은 환각으로 거부한다", () => {
  const candidate = [
    transcriptSegment({
      id: "long-repeat",
      text: Array(30).fill("재개하라").join(" "),
      start: 400,
      end: 460,
      confidences: Array(30).fill(0.12),
    }),
  ]
  const assessment = assessTranscriptQuality({ candidate })

  assert.equal(assessment.hallucinated, true)
  assert.equal(assessment.decision, "reject")
})

test("거부된 구간 전사는 기준 타임라인을 덮어쓰지 않는다", () => {
  const baseline = [
    transcriptSegment({
      id: "baseline",
      text: "한마디로 이재명 탈옥법입니다",
      start: 120,
      end: 126,
    }),
  ]
  const candidate = [
    transcriptSegment({
      id: "hallucinated",
      text: Array(18).fill("이재명의 모든 죄를 없애기").join(" "),
      start: 120,
      end: 132,
      confidences: Array(90).fill(0.08),
    }),
  ]
  const result = selectTranscriptRangeReplacement({
    baseline,
    candidate,
    range: { start: 120, end: 132 },
  })

  assert.equal(result.accepted, false)
  assert.equal(result.assessment.decision, "reject")
  assert.strictEqual(result.transcript, baseline)
})
