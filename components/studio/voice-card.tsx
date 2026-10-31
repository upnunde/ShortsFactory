"use client"

import { Card } from "@heroui/react"

export function VoiceCard() {
  return (
    <Card>
      <Card.Header>
        <Card.Title>목소리</Card.Title>
        <Card.Description>
          연결한 힉스필드 API에는 목소리를 고르는 목록이 없습니다. 소리는 영상을 만들 때 그 모델이 같이 붙입니다. 웹사이트의
          텍스트 음성 변환은 이 키로 불러올 수 없습니다.
        </Card.Description>
      </Card.Header>
    </Card>
  )
}
