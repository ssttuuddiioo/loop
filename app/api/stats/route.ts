import { NextResponse } from "next/server";
import { counts } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const c = await counts();
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  return NextResponse.json({ counts: c, total });
}
