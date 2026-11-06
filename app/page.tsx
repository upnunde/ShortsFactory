import Link from "next/link"

import { Clapperboard, Newspaper, Settings } from "lucide-react"

export default function Page() {
  return (
    <main className="min-h-svh bg-background px-6 py-14 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="flex flex-col items-start justify-between gap-6 sm:flex-row">
          <div>
            <p className="text-sm text-muted">쇼츠 팩토리</p>
            <h1 className="mt-2 text-3xl font-semibold">
              어떤 방식으로 만들까요?
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              두 작업실은 채널 목록부터 설정·프로젝트·제작 파이프라인까지 서로
              완전히 분리됩니다.
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-separator bg-surface px-4 py-2.5 text-sm font-medium transition hover:border-foreground/25 hover:bg-default"
          >
            <Settings className="size-4" /> 플랫폼 설정
          </Link>
        </header>

        <section className="grid gap-5 md:grid-cols-2">
          <ModeCard
            href="/studio/character"
            icon={<Clapperboard className="size-6" />}
            eyebrow="character"
            title="캐릭터·AI 생성형 쇼츠"
            description="주제를 대본과 화면 연출로 바꾸고 캐릭터, TTS, 생성 영상으로 제작합니다."
          />
          <ModeCard
            href="/studio/news-clips"
            icon={<Newspaper className="size-6" />}
            eyebrow="news_clip"
            title="아나운서 뉴스 리포트 제작"
            description="뉴스 자료를 분석해 아나운서 보도 대본을 만들고, TTS와 근거 영상을 교차 편집합니다."
          />
        </section>
      </div>
    </main>
  )
}

function ModeCard({
  href,
  icon,
  eyebrow,
  title,
  description,
}: {
  href: string
  icon: React.ReactNode
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-64 flex-col justify-between rounded-2xl border border-separator bg-surface p-6 transition hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-lg"
    >
      <div>
        <div className="flex size-12 items-center justify-center rounded-xl bg-default text-foreground">
          {icon}
        </div>
        <p className="mt-6 text-xs tracking-[0.18em] text-muted">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
      </div>
      <p className="mt-6 text-sm font-medium group-hover:underline">
        작업실 열기 →
      </p>
    </Link>
  )
}
