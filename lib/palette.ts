// Single source of truth for the release palette.
// Each color carries a sentiment label (not NLP — the label IS the meaning).
// Edit the words freely; the rest of the app reads from here.

export type Swatch = { hex: string; sentiment: string };

export const PALETTE: Swatch[] = [
  { hex: "#E37610", sentiment: "anger" },
  { hex: "#001AFF", sentiment: "fear" },
  { hex: "#D8F8E5", sentiment: "peace" },
  { hex: "#41DC7F", sentiment: "hope" },
  { hex: "#A21272", sentiment: "grief" },
];

const HEXES = PALETTE.map((s) => s.hex.toUpperCase());

/** Pick a random swatch (used on each landing load). */
export function pickRandom(): Swatch {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

/** True only for hexes that are part of the palette. */
export function isValidHex(hex: unknown): hex is string {
  return typeof hex === "string" && HEXES.includes(hex.toUpperCase());
}

/** Map a hex to its swatch (case-insensitive); falls back to palette[0]. */
export function swatchOf(hex: string): Swatch {
  const up = hex.toUpperCase();
  return PALETTE.find((s) => s.hex.toUpperCase() === up) ?? PALETTE[0];
}

/** Convert "#RRGGBB" to [r,g,b] in 0..1 for three.js / WebGL. */
export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
