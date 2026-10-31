export const CHARACTER_ANGLES = [
  { key: "three-quarter-face", label: "반측면 얼굴" },
  { key: "profile", label: "옆얼굴" },
  { key: "front-body", label: "정면 전신" },
  { key: "three-quarter-body", label: "반측면 전신" },
  { key: "back-body", label: "뒷모습 전신" },
] as const

export type CharacterAngleKey = (typeof CHARACTER_ANGLES)[number]["key"]
