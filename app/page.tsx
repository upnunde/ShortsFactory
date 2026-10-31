import { Suspense } from "react"

import { StudioApp } from "@/components/studio/studio-app"
import { readAccountStatus } from "@/lib/server/accounts"

export default async function Page() {
  const accounts = await readAccountStatus()
  return (
    <Suspense>
      <StudioApp initialAccounts={accounts} />
    </Suspense>
  )
}
