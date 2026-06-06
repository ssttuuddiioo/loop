import { Redis } from "@upstash/redis";

export type Item = { id: string; text: string; color: string; ts: number };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_S = 7 * 24 * 60 * 60;

const ENTRIES_KEY = "loop:entries"; // sorted set, score = ts, member = Item
const COUNTS_KEY = "loop:counts"; // hash, field = hex, value = count

// ---- backend selection -------------------------------------------------
// Shared (Upstash / Vercel KV) when env is present; otherwise a per-instance
// in-memory fallback so local dev and tests run without any setup.
function makeRedis(): Redis | null {
  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = makeRedis();

if (redis) {
  console.log("[store] KV mode — shared store (Upstash/Vercel KV).");
} else {
  console.warn(
    "[store] No KV env — in-memory store (per-instance, NOT shared across serverless instances). Set KV_REST_API_URL / KV_REST_API_TOKEN for production.",
  );
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

// ---- in-memory fallback ------------------------------------------------
const g = globalThis as unknown as {
  __loopItems?: Item[];
  __loopCounts?: Record<string, number>;
};
const memItems: Item[] = (g.__loopItems ??= []);
const memCounts: Record<string, number> = (g.__loopCounts ??= {});

function memPrune() {
  const cutoff = Date.now() - WEEK_MS;
  while (memItems.length && memItems[0].ts < cutoff) memItems.shift();
}

// ---- public API --------------------------------------------------------
export async function push(text: string, color: string): Promise<Item> {
  const item: Item = { id: newId(), text, color, ts: Date.now() };
  if (redis) {
    await redis.zadd(ENTRIES_KEY, { score: item.ts, member: item });
    await redis.zremrangebyscore(ENTRIES_KEY, 0, item.ts - WEEK_MS);
    await redis.hincrby(COUNTS_KEY, color, 1);
    await redis.expire(ENTRIES_KEY, WEEK_S);
    await redis.expire(COUNTS_KEY, WEEK_S);
  } else {
    memPrune();
    memItems.push(item);
    memCounts[color] = (memCounts[color] ?? 0) + 1;
  }
  return item;
}

export async function since(ts: number): Promise<Item[]> {
  if (redis) {
    // exclusive lower bound so the cursor item isn't re-sent
    const items = await redis.zrange<Item[]>(ENTRIES_KEY, `(${ts}`, "+inf", {
      byScore: true,
    });
    return items ?? [];
  }
  memPrune();
  return memItems.filter((i) => i.ts > ts);
}

export async function counts(): Promise<Record<string, number>> {
  if (redis) {
    const h =
      (await redis.hgetall<Record<string, string | number>>(COUNTS_KEY)) ?? {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(h)) out[k] = Number(v) || 0;
    return out;
  }
  memPrune();
  return { ...memCounts };
}
