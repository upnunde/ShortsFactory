import * as koreanRomanizerModule from "@romanize/korean"

const DIGITS = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]
const SMALL_UNITS = ["", "십", "백", "천"]
const LARGE_UNITS = ["", "만", "억", "조", "경"]

export function koreanTtsInput(value: string) {
  const spoken = normalizeKoreanSpeechText(value)
  return romanize(spoken).replace(/\s+/g, " ").trim()
}

export function normalizeKoreanSpeechText(value: string) {
  return value
    .replace(/-?\d[\d,]*(?:\.\d+)?/g, (number) => numberToKorean(number))
    .replace(/%/g, " 퍼센트")
    .replace(/℃/g, " 도")
    .replace(/\s+/g, " ")
    .trim()
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
