export function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    if (host === "youtu.be") return Boolean(url.pathname.slice(1))
    if (host !== "youtube.com" && host !== "m.youtube.com") return false
    if (url.pathname === "/watch") return Boolean(url.searchParams.get("v"))
    return /^\/(?:shorts|live|embed)\/[^/]+/.test(url.pathname)
  } catch {
    return false
  }
}
