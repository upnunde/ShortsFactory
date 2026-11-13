const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php"
const DEFAULT_LIMIT = 16
const DEFAULT_MIN_SHORT_SIDE = 720
const DEFAULT_MIN_LONG_SIDE = 1280
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])

type WikimediaMetadataValue = {
  value?: unknown
}

type WikimediaImageInfo = {
  url?: unknown
  descriptionurl?: unknown
  thumburl?: unknown
  width?: unknown
  height?: unknown
  size?: unknown
  mime?: unknown
  extmetadata?: Record<string, WikimediaMetadataValue | undefined>
}

type WikimediaPage = {
  pageid?: unknown
  title?: unknown
  canonicalurl?: unknown
  imageinfo?: WikimediaImageInfo[]
}

type WikimediaApiResponse = {
  query?: {
    pages?: WikimediaPage[]
  }
}

export type WikimediaCommonsLicense = {
  name: string
  url: string
  usageTerms: string
  attributionRequired: boolean
}

export type WikimediaCommonsImage = {
  id: string
  provider: "wikimedia_commons"
  mediaType: "image"
  title: string
  titleKo: string
  titleEn: string
  descriptionKo: string
  descriptionEn: string
  author: string
  mimeType: string
  width: number
  height: number
  fileSizeBytes: number
  pageUrl: string
  downloadUrl: string
  previewUrl: string
  license: WikimediaCommonsLicense
}

export type WikimediaCommonsSearchOptions = {
  limit?: number
  minShortSide?: number
  minLongSide?: number
  fetchImpl?: WikimediaFetch
}

export type WikimediaFetch = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean
  json: () => Promise<unknown>
}>

/**
 * API 키가 필요 없는 Wikimedia Commons 공식 API에서 재사용 가능한
 * 고화질 정적 이미지만 찾는다. 한국어·영어 설명을 함께 보존해 이후
 * 대본 연관성 검사와 출처 표기에 쓸 수 있게 한다.
 */
export async function searchWikimediaCommonsImages(
  query: string,
  options: WikimediaCommonsSearchOptions = {}
): Promise<WikimediaCommonsImage[]> {
  const searchQuery = normalizeQuery(query)
  if (!searchQuery) return []

  const limit = clampInteger(options.limit, 1, 30, DEFAULT_LIMIT)
  const minShortSide = clampInteger(
    options.minShortSide,
    0,
    10_000,
    DEFAULT_MIN_SHORT_SIDE
  )
  const minLongSide = clampInteger(
    options.minLongSide,
    0,
    20_000,
    DEFAULT_MIN_LONG_SIDE
  )
  const fetchImpl: WikimediaFetch =
    options.fetchImpl ?? ((input, init) => fetch(input, init))

  const [koResult, enResult] = await Promise.allSettled([
    fetchCommonsPages(searchQuery, "ko", limit, fetchImpl),
    fetchCommonsPages(searchQuery, "en", limit, fetchImpl),
  ])
  if (koResult.status === "rejected" && enResult.status === "rejected") {
    throw new Error("wikimedia-search-failed")
  }

  const koPages = koResult.status === "fulfilled" ? koResult.value : []
  const enPages = enResult.status === "fulfilled" ? enResult.value : []
  const koById = pageMap(koPages)
  const enById = pageMap(enPages)
  const orderedKeys = unique([
    ...koPages.map(pageKey),
    ...enPages.map(pageKey),
  ]).filter(Boolean)

  return orderedKeys
    .map((key) =>
      toCommonsImage(koById.get(key), enById.get(key), {
        minShortSide,
        minLongSide,
      })
    )
    .filter((candidate): candidate is WikimediaCommonsImage =>
      Boolean(candidate)
    )
    .slice(0, limit)
}

async function fetchCommonsPages(
  query: string,
  language: "ko" | "en",
  limit: number,
  fetchImpl: WikimediaFetch
) {
  const url = new URL(COMMONS_API_URL)
  url.searchParams.set("action", "query")
  url.searchParams.set("generator", "search")
  url.searchParams.set("gsrsearch", query)
  url.searchParams.set("gsrnamespace", "6")
  url.searchParams.set("gsrlimit", String(limit))
  url.searchParams.set("prop", "imageinfo|info")
  url.searchParams.set("inprop", "url")
  url.searchParams.set("iiprop", "url|size|mime|extmetadata")
  url.searchParams.set("iiurlwidth", "1920")
  url.searchParams.set("iiextmetadatalanguage", language)
  url.searchParams.set("uselang", language)
  url.searchParams.set("format", "json")
  url.searchParams.set("formatversion", "2")
  url.searchParams.set("origin", "*")

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/json",
      "Api-User-Agent": "ShortsFactory/1.0 (Wikimedia Commons media search)",
    },
  })
  if (!response.ok) throw new Error("wikimedia-search-failed")
  const result = (await response.json()) as WikimediaApiResponse
  return Array.isArray(result.query?.pages) ? result.query.pages : []
}

function toCommonsImage(
  koPage: WikimediaPage | undefined,
  enPage: WikimediaPage | undefined,
  quality: { minShortSide: number; minLongSide: number }
): WikimediaCommonsImage | null {
  const primary = koPage ?? enPage
  const info = primary?.imageinfo?.[0] ?? enPage?.imageinfo?.[0]
  if (!primary || !info) return null

  const mimeType = text(info.mime).toLowerCase()
  const width = positiveInteger(info.width)
  const height = positiveInteger(info.height)
  const shortSide = Math.min(width, height)
  const longSide = Math.max(width, height)
  if (
    !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) ||
    shortSide < quality.minShortSide ||
    longSide < quality.minLongSide
  ) {
    return null
  }

  const downloadUrl = secureUrl(info.url)
  const pageUrl =
    secureUrl(info.descriptionurl) ||
    secureUrl(primary.canonicalurl) ||
    commonsPageUrl(text(primary.title))
  if (!downloadUrl || !pageUrl) return null

  const koMetadata = koPage?.imageinfo?.[0]?.extmetadata
  const enMetadata = enPage?.imageinfo?.[0]?.extmetadata
  const fallbackTitle = fileTitle(text(primary.title))
  const localizedTitleKo = metadataText(koMetadata, "ObjectName")
  const localizedTitleEn = metadataText(enMetadata, "ObjectName")
  const titleKo = localizedTitleKo || fallbackTitle
  const titleEn = localizedTitleEn || fallbackTitle
  const licenseName =
    metadataText(koMetadata, "LicenseShortName") ||
    metadataText(enMetadata, "LicenseShortName") ||
    metadataText(koMetadata, "UsageTerms") ||
    metadataText(enMetadata, "UsageTerms")
  const licenseUrl =
    secureUrl(metadataText(koMetadata, "LicenseUrl")) ||
    secureUrl(metadataText(enMetadata, "LicenseUrl"))
  if (!isClearlyReusableLicense(licenseName, licenseUrl)) return null

  const attributionRaw =
    metadataText(koMetadata, "AttributionRequired") ||
    metadataText(enMetadata, "AttributionRequired")
  return {
    id: `wikimedia-${text(primary.pageid) || stablePageId(primary.title)}`,
    provider: "wikimedia_commons",
    mediaType: "image",
    title: localizedTitleKo || localizedTitleEn || fallbackTitle,
    titleKo,
    titleEn,
    descriptionKo: metadataText(koMetadata, "ImageDescription"),
    descriptionEn: metadataText(enMetadata, "ImageDescription"),
    author:
      metadataText(koMetadata, "Artist") ||
      metadataText(enMetadata, "Artist") ||
      metadataText(koMetadata, "Credit") ||
      metadataText(enMetadata, "Credit"),
    mimeType,
    width,
    height,
    fileSizeBytes: positiveInteger(info.size),
    pageUrl,
    downloadUrl,
    previewUrl: secureUrl(info.thumburl) || downloadUrl,
    license: {
      name: licenseName,
      url: licenseUrl,
      usageTerms:
        metadataText(koMetadata, "UsageTerms") ||
        metadataText(enMetadata, "UsageTerms"),
      attributionRequired:
        /^(?:true|yes|y|1|required)$/i.test(attributionRaw) ||
        /\bcc[ -]?by\b/i.test(licenseName),
    },
  }
}

function pageMap(pages: WikimediaPage[]) {
  return new Map(
    pages.map((page) => [pageKey(page), page] as const).filter(([key]) => key)
  )
}

function pageKey(page: WikimediaPage) {
  const pageId = text(page.pageid)
  return pageId || text(page.title).toLowerCase()
}

function metadataText(
  metadata: Record<string, WikimediaMetadataValue | undefined> | undefined,
  key: string
) {
  return cleanHtml(text(metadata?.[key]?.value))
}

function cleanHtml(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity
    const hex = code[1]?.toLowerCase() === "x"
    const parsed = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10)
    return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity
  })
}

function isClearlyReusableLicense(name: string, url: string) {
  const value = `${name} ${url}`.toLowerCase()
  if (
    /(?:by[ _-]?(?:nc|nd)|non[ _-]?commercial|no[ _-]?derivatives|비영리|변경[ _-]?금지)/i.test(
      value
    )
  ) {
    return false
  }
  return /(?:cc0|cc[ -]?by(?:[ -]?sa)?|creativecommons\.org\/(?:licenses\/(?:by|by-sa)|publicdomain)\/|public[ _-]?domain|publicdomain|퍼블릭 도메인|gfdl|free art|open government licen[cs]e)/i.test(
    value
  )
}

function secureUrl(value: unknown) {
  const candidate = text(value)
  if (!candidate) return ""
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" ? url.toString() : ""
  } catch {
    return ""
  }
}

function commonsPageUrl(title: string) {
  if (!title) return ""
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(
    title.replace(/\s+/g, "_")
  )}`
}

function fileTitle(value: string) {
  return cleanHtml(value.replace(/^(?:File|파일):/i, "").replace(/_/g, " "))
}

function stablePageId(value: unknown) {
  const input = text(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalizeQuery(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180)
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value as number)))
}

function text(value: unknown) {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  return ""
}

function unique(values: string[]) {
  return [...new Set(values)]
}
