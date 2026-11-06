import { Suspense } from "react"

import { NewsClipsApp } from "@/components/news-clips/news-clips-app"
import { listNewsChannels } from "@/lib/server/news-clips/channels"

export const dynamic = "force-dynamic"

export default async function NewsClipsPage() {
  const profiles = await listNewsChannels()
  return (
    <Suspense>
      <NewsClipsApp profiles={profiles} />
    </Suspense>
  )
}
