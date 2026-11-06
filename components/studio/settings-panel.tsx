"use client"

import { Tabs } from "@heroui/react"
import { AccountsPanel } from "@/components/studio/accounts-panel"
import { BgmSettingsCard } from "@/components/studio/bgm-card"
import { ChannelSettingsCard } from "@/components/studio/channel-card"
import { CharacterPanel } from "@/components/studio/character-panel"
import { StepHeader } from "@/components/studio/chrome"
import { FrameLayoutCard } from "@/components/studio/frame-layout-card"
import { VideoSettingsCard } from "@/components/studio/video-settings-card"
import { VoiceCard } from "@/components/studio/voice-card"
import { WritingGuideCard } from "@/components/studio/writing-guide-card"
import type { AccountPlatform, AccountStatus } from "@/lib/server/accounts"
import type { ChannelProfile } from "@/lib/types"

export function SettingsPanel({
  initialTab = "frame",
  accountNotice = null,
  initialAccounts,
  profile,
  onProfileSaved,
}: {
  initialTab?: "character" | "frame" | "accounts"
  accountNotice?: { kind: "connected" | "error"; platform: string } | null
  initialAccounts: Record<AccountPlatform, AccountStatus>
  profile: ChannelProfile
  onProfileSaved: (profile: ChannelProfile) => void
}) {
  return (
    <>
      <StepHeader
        title={`${profile.name} 설정`}
        description="이 채널의 캐릭터, 목소리, 배경음악, 영상 폼과 업로드 계정을 관리합니다. API 연결은 플랫폼 공통 설정에서 관리합니다."
      />
      <Tabs defaultSelectedKey={initialTab}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="설정 구분">
            <Tabs.Tab id="character">
              캐릭터
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="frame">
              영상 설정
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="accounts">
              업로드 계정
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="character" className="flex flex-col gap-6">
          <CharacterPanel profileId={profile.id} />
        </Tabs.Panel>
        <Tabs.Panel id="frame" className="flex flex-col gap-6">
          <ChannelSettingsCard
            key={profile.id}
            profile={profile}
            onSaved={onProfileSaved}
          />
          <WritingGuideCard profileId={profile.id} />
          <VoiceCard profileId={profile.id} />
          <BgmSettingsCard />
          <VideoSettingsCard profileId={profile.id} />
          <FrameLayoutCard profileId={profile.id} />
        </Tabs.Panel>
        <Tabs.Panel id="accounts" className="flex flex-col gap-6">
          <AccountsPanel
            notice={accountNotice}
            initialStatus={initialAccounts}
            profileId={profile.id}
          />
        </Tabs.Panel>
      </Tabs>
    </>
  )
}
