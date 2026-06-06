import { NextResponse } from "next/server";
import { push, since } from "@/lib/store";
import { isValidHex, PALETTE } from "@/lib/palette";

const RATE_MS = 10_000;
const rate = new Map<string, number>();

function ipOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "local";
}

function clean(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(/<[^>]*>/g, "").trim();
  if (!stripped) return null;
  if (stripped.length > 280) return null;
  return stripped;
}

export async function POST(req: Request) {
  const ip = ipOf(req);
  const now = Date.now();
  const last = rate.get(ip) ?? 0;
  if (now - last < RATE_MS) {
    return NextResponse.json({ ok: false, error: "slow down" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }

  const text = clean((body as { text?: unknown })?.text);
  if (!text) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const rawColor = (body as { color?: unknown })?.color;
  const color = isValidHex(rawColor) ? rawColor : PALETTE[0].hex;

  rate.set(ip, now);
  const item = await push(text, color);
  return NextResponse.json({ ok: true, id: item.id, ts: item.ts, color });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sinceParam = Number(searchParams.get("since") ?? "0");
  const cutoff = Number.isFinite(sinceParam) ? sinceParam : 0;
  return NextResponse.json({ items: await since(cutoff) });
}
