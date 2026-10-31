import { NextResponse } from "next/server"

import { addOutfit } from "@/lib/server/character"

export async function POST() {
  return NextResponse.json(await addOutfit())
}
