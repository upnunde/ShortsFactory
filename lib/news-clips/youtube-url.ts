export function isYouTubeUrl(value: string) {
  return Boolean(extractYouTubeUrl(value))
}

export function extractYouTubeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const direct = normalizeYouTubeUrl(trimmed)
  if (direct) return direct
  const match = trimmed.match(
    /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]+|shorts\/[^\s]+|live\/[^\s]+|embed\/[^\s]+)|youtu\.be\/[^\s]+)/i
  )
  return match ? normalizeYouTubeUrl(match[0]) : ""
}

function normalizeYouTubeUrl(value: string) {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] ?? ""
      return id ? `https://youtu.be/${id}` : ""
    }
    if (host !== "youtube.com" && host !== "m.youtube.com") return ""
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v")
      return id ? `https://www.youtube.com/watch?v=${id}` : ""
    }
    const nested = url.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/)
    return nested ? `https://www.youtube.com/${nested[1]}/${nested[2]}` : ""
  } catch {
    return ""
  }
}
