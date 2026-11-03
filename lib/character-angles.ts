export const CHARACTER_ANGLES = [
  { key: "three-quarter-face", label: "반측면 얼굴", group: "angle" },
  { key: "profile", label: "옆얼굴", group: "angle" },
  { key: "front-body", label: "정면 전신", group: "angle" },
  { key: "three-quarter-body", label: "반측면 전신", group: "angle" },
  { key: "back-body", label: "뒷모습 전신", group: "angle" },
  { key: "gesture-explain", label: "양날개 설명", group: "gesture" },
  { key: "gesture-point-left", label: "왼쪽 가리키기", group: "gesture" },
  { key: "gesture-point-right", label: "오른쪽 가리키기", group: "gesture" },
  { key: "gesture-thinking", label: "생각하기", group: "gesture" },
  { key: "gesture-wave", label: "인사하기", group: "gesture" },
  { key: "mouth-small", label: "작은 부리 발화", group: "expression" },
  { key: "mouth-wide", label: "큰 부리 발화", group: "expression" },
  { key: "expression-smile", label: "미소", group: "expression" },
  { key: "expression-surprised", label: "놀람", group: "expression" },
  { key: "expression-serious", label: "진지함", group: "expression" },
] as const

export type CharacterAngleKey = (typeof CHARACTER_ANGLES)[number]["key"]
export type CharacterSourceGroup = (typeof CHARACTER_ANGLES)[number]["group"]

export const CHARACTER_SOURCE_GROUPS: {
  id: CharacterSourceGroup
  label: string
}[] = [
  { id: "angle", label: "기본 각도" },
  { id: "gesture", label: "날개 제스처" },
  { id: "expression", label: "표정과 부리" },
]
