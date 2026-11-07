import { NextResponse } from "next/server"

import { readTypecastSubscriptionUsage } from "@/lib/server/news-clips/typecast-subscription"

export const runtime = "nodejs"

export async function GET() {
  const result = await readTypecastSubscriptionUsage()
  if (!result.ok) {
    const message =
      result.code === "missing-key"
        ? "Typecast API 키가 없습니다."
        : result.code === "auth"
          ? "Typecast API 키를 확인해 주세요."
          : result.code === "temporary"
            ? "Typecast 사용량을 잠시 후 다시 확인해 주세요."
            : "Typecast 사용량을 불러오지 못했습니다."
    return NextResponse.json(
      { message, code: result.code },
      {
        status:
          result.code === "missing-key"
            ? 400
            : result.code === "auth"
              ? 401
              : result.code === "temporary"
                ? 503
                : 502,
      }
    )
  }

  return NextResponse.json(result.usage)
}
