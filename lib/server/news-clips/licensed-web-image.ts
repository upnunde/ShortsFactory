const licensedWebImageMimeTypes = new Map<string, ".jpg" | ".png" | ".webp">([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
] as const)

export const LICENSED_WEB_IMAGE_MAX_BYTES = 32 * 1024 * 1024

export type LicensedWebImageDownloadValidation =
  | {
      ok: true
      url: string
      mimeType: "image/jpeg" | "image/png" | "image/webp"
      extension: ".jpg" | ".png" | ".webp"
    }
  | {
      ok: false
      reason:
        | "invalid-web-image-url"
        | "unsupported-web-image"
        | "web-image-too-large"
    }

/** Wikimedia 원본 CDN만 허용하고 MIME·용량을 순수 함수로 검증한다. */
export function validateLicensedWebImageDownload(input: {
  url: string
  declaredMimeType?: string
  responseMimeType?: string
  contentLength?: number
}): LicensedWebImageDownloadValidation {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return { ok: false, reason: "invalid-web-image-url" }
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "upload.wikimedia.org" ||
    Boolean(url.username || url.password) ||
    (url.port !== "" && url.port !== "443")
  ) {
    return { ok: false, reason: "invalid-web-image-url" }
  }

  const declaredMimeType = normalizedMimeType(input.declaredMimeType)
  const responseMimeType = normalizedMimeType(input.responseMimeType)
  if (
    declaredMimeType &&
    responseMimeType &&
    declaredMimeType !== responseMimeType
  ) {
    return { ok: false, reason: "unsupported-web-image" }
  }
  const mimeType = responseMimeType || declaredMimeType
  const extension = licensedWebImageMimeTypes.get(mimeType)
  if (!extension) return { ok: false, reason: "unsupported-web-image" }

  const contentLength = Number(input.contentLength)
  if (
    Number.isFinite(contentLength) &&
    contentLength > LICENSED_WEB_IMAGE_MAX_BYTES
  ) {
    return { ok: false, reason: "web-image-too-large" }
  }
  return {
    ok: true,
    url: url.toString(),
    mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp",
    extension,
  }
}

function normalizedMimeType(value: string | undefined) {
  return (value || "").split(";", 1)[0].trim().toLowerCase()
}
