import type { NewsTtsProvider } from "./types.ts"

export function selectNewsTtsProvider(
  preference: NewsTtsProvider,
  hasTypecastKey: boolean
) {
  if (hasTypecastKey && (preference === "auto" || preference === "typecast")) {
    return "typecast" as const
  }
  return "free" as const
}
