import assert from "node:assert/strict"
import test from "node:test"

import { scriptMatchesIssueFocus } from "./issue-focus.ts"

const issue = {
  title: "월 15만원 농어촌 기본소득 확대 지자체 재정 부담 커지나",
  keywords: ["농어촌", "기본소득", "지자체", "재정", "부담"],
}

test("같은 정책이어도 선택 이슈의 재정 부담 논점이 빠진 대본은 거절한다", () => {
  assert.equal(
    scriptMatchesIssueFocus(
      "농어촌 기본소득 지급 뒤 옥천 전입자가 늘고 시장 손님도 증가했습니다.",
      issue
    ),
    false
  )
})

test("선택 이슈의 대상과 구체 논점을 함께 다룬 대본은 허용한다", () => {
  assert.equal(
    scriptMatchesIssueFocus(
      "농어촌 기본소득 사업비의 상당 부분을 지자체가 부담합니다. 결국 지방 재정과 기존 복지 예산을 압박하는 구조입니다.",
      issue
    ),
    true
  )
})
