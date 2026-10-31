import { readAccountStatus } from "@/lib/server/accounts"

export async function GET() {
  return Response.json(await readAccountStatus())
}
