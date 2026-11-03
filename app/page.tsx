import { Suspense } from "react"

import { StudioApp } from "@/components/studio/studio-app"
import { readAccountStatus } from "@/lib/server/accounts"
import { listProfiles } from "@/lib/server/profiles"

export default async function Page() {
  const [accounts, profiles] = await Promise.all([
    readAccountStatus(),
    listProfiles(),
  ])
  return (
    <Suspense>
      <StudioApp initialAccounts={accounts} initialProfiles={profiles} />
    </Suspense>
  )
}
