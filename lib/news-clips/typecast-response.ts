type TypecastSpeechResponse = {
  audio?: unknown
  audio_format?: unknown
}

export type TypecastAlignmentSegment = {
  text: string
  start: number
  end: number
}

export type TypecastSpeechTiming = {
  audioDuration: number
  words: TypecastAlignmentSegment[]
  characters: TypecastAlignmentSegment[]
}

type TypecastTimestampResponse = TypecastSpeechResponse & {
  audio_duration?: unknown
  words?: unknown
  characters?: unknown
}

export async function typecastWavBytes(response: Response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (
    contentType.includes("audio/wav") ||
    contentType.includes("audio/x-wav") ||
    contentType.includes("application/octet-stream")
  ) {
    return validWavBytes(Buffer.from(await response.arrayBuffer()))
  }

  const body = (await response
    .json()
    .catch(() => null)) as TypecastSpeechResponse | null
  const encoded =
    typeof body?.audio === "string"
      ? body.audio.replace(/^data:audio\/[^;]+;base64,/, "")
      : ""
  if (!encoded || body?.audio_format !== "wav") return null
  return validWavBytes(Buffer.from(encoded, "base64"))
}

export async function typecastTimestampedWav(response: Response) {
  const body = (await response
    .json()
    .catch(() => null)) as TypecastTimestampResponse | null
  const encoded =
    typeof body?.audio === "string"
      ? body.audio.replace(/^data:audio\/[^;]+;base64,/, "")
      : ""
  if (!encoded || body?.audio_format !== "wav") return null
  const wav = validWavBytes(Buffer.from(encoded, "base64"))
  if (!wav) return null
  return {
    wav,
    timing: {
      audioDuration: finiteNonNegative(body.audio_duration),
      words: alignmentSegments(body.words),
      characters: alignmentSegments(body.characters),
    } satisfies TypecastSpeechTiming,
  }
}

function alignmentSegments(value: unknown): TypecastAlignmentSegment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const segment = item as { text?: unknown; start?: unknown; end?: unknown }
    if (
      typeof segment.text !== "string" ||
      typeof segment.start !== "number" ||
      !Number.isFinite(segment.start) ||
      typeof segment.end !== "number" ||
      !Number.isFinite(segment.end) ||
      segment.start < 0 ||
      segment.end < segment.start
    )
      return []
    return [
      {
        text: segment.text,
        start: segment.start,
        end: segment.end,
      },
    ]
  })
}

function finiteNonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

function validWavBytes(bytes: Buffer) {
  if (
    bytes.length <= 4_096 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WAVE"
  ) {
    return null
  }
  return bytes
}
