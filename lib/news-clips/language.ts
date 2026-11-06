export function isPrimarilyKorean(...values: string[]) {
  const text = values
    .join(" ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " ")
  const hangulCount = (text.match(/[\uac00-\ud7a3]/g) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length
  if (hangulCount < 2) return false
  if (latinCount === 0) return true
  return hangulCount / (hangulCount + latinCount) >= 0.3
}
