import "server-only"

import { readTypecastKey } from "@/lib/server/credentials"

export type TypecastSubscriptionUsage = {
  plan: string
  planCredits: number
  usedCredits: number
  remainingCredits: number
  usedPercent: number
}

export async function readTypecastSubscriptionUsage(): Promise<
  | { ok: true; usage: TypecastSubscriptionUsage }
  | { ok: false; code: "missing-key" | "auth" | "temporary" | "failed" }
> {
  const apiKey = await readTypecastKey()
  if (!apiKey) return { ok: false, code: "missing-key" }

  const response = await fetch(
    "https://api.typecast.ai/v1/users/me/subscription",
    {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
        "User-Agent": "ShortsFactory/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  ).catch(() => null)

  if (!response) return { ok: false, code: "temporary" }
  if (response.status === 401 || response.status === 403)
    return { ok: false, code: "auth" }
  if (response.status === 429 || response.status >= 500)
    return { ok: false, code: "temporary" }
  if (!response.ok) return { ok: false, code: "failed" }

  const body = (await response.json().catch(() => null)) as {
    plan?: unknown
    credits?: { plan_credits?: unknown; used_credits?: unknown }
  } | null
  const planCredits = numberValue(body?.credits?.plan_credits)
  const usedCredits = numberValue(body?.credits?.used_credits)
  if (planCredits === null || usedCredits === null) {
    return { ok: false, code: "failed" }
  }

  const remainingCredits = Math.max(0, planCredits - usedCredits)
  const usedPercent =
    planCredits > 0
      ? Math.min(100, Math.round((usedCredits / planCredits) * 1000) / 10)
      : 0

  return {
    ok: true,
    usage: {
      plan: typeof body?.plan === "string" ? body.plan : "",
      planCredits,
      usedCredits,
      remainingCredits,
      usedPercent,
    },
  }
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value)
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim())
  }
  return null
}
