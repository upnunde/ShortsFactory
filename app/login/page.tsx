import type { Metadata } from "next"

import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react"

import { sanitizeReturnTo } from "@/lib/auth"

export const metadata: Metadata = {
  title: "로그인 | 쇼츠 팩토리",
}

type LoginPageProps = {
  searchParams: Promise<{
    error?: string | string[]
    next?: string | string[]
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const error = first(params.error)
  const returnTo = sanitizeReturnTo(first(params.next))

  return (
    <main className="relative grid min-h-svh place-items-center overflow-x-hidden bg-background px-5 py-10 text-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden="true"
      >
        <div className="bg-primary/15 absolute top-[-18rem] left-1/2 size-[36rem] -translate-x-1/2 rounded-full blur-3xl" />
        <div className="bg-secondary/10 absolute right-[-14rem] bottom-[-20rem] size-[34rem] rounded-full blur-3xl" />
      </div>

      <section className="relative w-full max-w-md rounded-3xl border border-separator bg-surface/95 p-7 shadow-2xl shadow-black/25 backdrop-blur sm:p-9">
        <div className="flex size-12 items-center justify-center rounded-2xl border border-separator bg-default text-foreground">
          <LockKeyhole className="size-5" />
        </div>

        <div className="mt-7">
          <div className="flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-muted uppercase">
            <Sparkles className="size-3.5" />
            Shorts Factory
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            작업실 로그인
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            발급받은 아이디와 비밀번호를 입력해.
          </p>
        </div>

        <form action="/api/auth/login" method="post" className="mt-8 space-y-5">
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="block space-y-2">
            <span className="text-sm font-medium">아이디</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              required
              maxLength={200}
              className="bg-field-background h-12 w-full rounded-xl border border-separator px-4 text-sm transition outline-none placeholder:text-muted focus:border-foreground/35 focus:ring-2 focus:ring-foreground/10"
              placeholder="아이디 입력"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">비밀번호</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={500}
              className="bg-field-background h-12 w-full rounded-xl border border-separator px-4 text-sm transition outline-none placeholder:text-muted focus:border-foreground/35 focus:ring-2 focus:ring-foreground/10"
              placeholder="비밀번호 입력"
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {error === "config"
                ? "로그인 계정 설정이 아직 적용되지 않았어."
                : "아이디 또는 비밀번호가 맞지 않아."}
            </p>
          ) : null}

          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            로그인
            <ArrowRight className="size-4" />
          </button>
        </form>
      </section>
    </main>
  )
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
