import * as koreanRomanizerModule from "@romanize/korean"

const DIGITS = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]
const SMALL_UNITS = ["", "십", "백", "천"]
const LARGE_UNITS = ["", "만", "억", "조", "경"]
const NATIVE_ONES = [
  "",
  "한",
  "두",
  "세",
  "네",
  "다섯",
  "여섯",
  "일곱",
  "여덟",
  "아홉",
]
const NATIVE_TENS = [
  "",
  "열",
  "스물",
  "서른",
  "마흔",
  "쉰",
  "예순",
  "일흔",
  "여든",
  "아흔",
]

export type KoreanSpeechUnit = {
  text: string
  pauseAfterSeconds: number
}

export function koreanTtsInput(value: string) {
  const spoken = normalizeKoreanSpeechText(value)
  return romanize(spoken).replace(/\s+/g, " ").trim()
}

export function normalizeKoreanSpeechText(value: string) {
  return value
    .replace(
      /(-?\d[\d,]*)\s*(명|개|번|살|마리|잔|권|대|곳|가지)/g,
      (_, number: string, counter: string) =>
        `${counterNumberToKorean(number)} ${counter}`
    )
    .replace(
      /(-?\d[\d,]*)\s*시(?!간)/g,
      (_, number: string) => `${counterNumberToKorean(number)} 시`
    )
    .replace(/-?\d[\d,]*(?:\.\d+)?/g, (number) => numberToKorean(number))
    .replace(/%/g, " 퍼센트")
    .replace(/℃/g, " 도")
    .replace(/\s+/g, " ")
    .trim()
}

export function koreanSpeechUnits(value: string): KoreanSpeechUnit[] {
  const paragraphs = value
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => normalizeKoreanSpeechText(line))
    .filter(Boolean)
  return paragraphs.flatMap((paragraph, paragraphIndex) => {
    const units = splitSpokenClauses(paragraph)
    return units.map((unit, unitIndex) => {
      const lastInParagraph = unitIndex === units.length - 1
      const hasNextParagraph = paragraphIndex < paragraphs.length - 1
      return {
        text: unit,
        pauseAfterSeconds:
          lastInParagraph && hasNextParagraph ? 0.4 : pauseAfterClause(unit),
      }
    })
  })
}

function numberToKorean(value: string) {
  const negative = value.startsWith("-")
  const normalized = value.replace(/^-/, "").replace(/,/g, "")
  const [integer = "0", decimal] = normalized.split(".")
  const integerText = integerToKorean(integer)
  const decimalText = decimal
    ? `점${[...decimal].map((digit) => DIGITS[Number(digit)]).join("")}`
    : ""
  return `${negative ? "마이너스" : ""}${integerText}${decimalText}`
}

function counterNumberToKorean(value: string) {
  const negative = value.startsWith("-")
  const parsed = Number(value.replace(/^-/, "").replace(/,/g, ""))
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 100) {
    return numberToKorean(value)
  }
  const tens = Math.floor(parsed / 10)
  const ones = parsed % 10
  const native =
    parsed === 20
      ? "스무"
      : `${NATIVE_TENS[tens] ?? ""}${NATIVE_ONES[ones] ?? ""}`
  return `${negative ? "마이너스 " : ""}${native}`
}

function splitSpokenClauses(value: string) {
  const units: string[] = []
  let cursor = ""
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ""
    cursor += character
    if (!/[,，;；:：.!?。！？]/.test(character)) continue
    while (/[\]\)}'\"’”]/.test(value[index + 1] ?? "")) {
      index += 1
      cursor += value[index]
    }
    if (cursor.trim()) units.push(cursor.trim())
    cursor = ""
  }
  if (cursor.trim()) units.push(cursor.trim())
  return units
}

function pauseAfterClause(value: string) {
  if (/[.!?。！？][\]\)}'\"’”]*$/.test(value)) return 0.25
  if (/[,，;；:：][\]\)}'\"’”]*$/.test(value)) return 0.12
  return 0
}

function integerToKorean(value: string) {
  const digits = value.replace(/^0+(?=\d)/, "")
  if (digits === "0") return DIGITS[0]
  if (digits.length > LARGE_UNITS.length * 4) {
    return [...digits].map((digit) => DIGITS[Number(digit)]).join("")
  }

  const padded = digits.padStart(Math.ceil(digits.length / 4) * 4, "0")
  const groups = padded.match(/.{4}/g) ?? []
  return groups
    .map((group, index) => {
      if (group === "0000") return ""
      const largeUnit = LARGE_UNITS[groups.length - index - 1]
      return `${fourDigitGroupToKorean(group)}${largeUnit}`
    })
    .join("")
}

function fourDigitGroupToKorean(group: string) {
  return [...group]
    .map((digit, index) => {
      const value = Number(digit)
      if (value === 0) return ""
      const unit = SMALL_UNITS[group.length - index - 1]
      return `${value === 1 && unit ? "" : DIGITS[value]}${unit}`
    })
    .join("")
}

function romanize(value: string) {
  const packageExports =
    koreanRomanizerModule as typeof koreanRomanizerModule & {
      default?: typeof koreanRomanizerModule
    }
  const converter = packageExports.romanize ?? packageExports.default?.romanize
  if (!converter) throw new Error("korean-romanizer-unavailable")
  return converter(value)
}
