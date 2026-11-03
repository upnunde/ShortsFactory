import { readChannelAccountStatus } from "@/lib/server/accounts"

export async function GET(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  return Response.json(await readChannelAccountStatus(profileId))
}
