import * as THREE from "three";
import {
  LETTER_GLYPH_COUNT,
  charIndex,
  randomBoidGlyphIndex,
} from "./letterAtlas";

const MAX_LETTERS = 320;
const CELL_W = 40;
const LINE_H = 90;
const SIZE_TEXT = 70;
const SIZE_BOID = 45;

const FADE_IN_MS = 600;
const SHOW_MS = 1000;
const DISINTEGRATE_MS = 5000;
const TOTAL_MS = FADE_IN_MS + SHOW_MS + DISINTEGRATE_MS;

export type LettersHandle = {
  points: THREE.Points;
  showText(text: string, nowMs: number, color?: string): void;
  update(
    deltaSec: number,
    timeSec: number,
    baseWind: [number, number],
    nowMs: number,
  ): void;
  isBusy(nowMs: number): boolean;
  setBounds(w: number, h: number): void;
  setDpr(dpr: number): void;
  dispose(): void;
};

const vert = /* glsl */ `
  attribute float aGlyph;
  attribute float aAlpha;
  attribute float aSize;
  uniform vec2 uBounds;
  uniform float uDpr;
  varying float vGlyph;
  varying float vAlpha;

  void main() {
    vGlyph = aGlyph;
    vAlpha = aAlpha;
    vec2 clip = position.xy / uBounds * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
    gl_PointSize = max(4.0, aSize * uDpr);
  }
`;

const frag = /* glsl */ `
  precision mediump float;
  uniform sampler2D uAtlas;
  uniform float uGlyphCount;
  uniform vec3 uColor;
  varying float vGlyph;
  varying float vAlpha;

  void main() {
    if (vAlpha < 0.01) discard;
    vec2 pc = gl_PointCoord;
    vec2 uv = vec2((vGlyph + pc.x) / uGlyphCount, pc.y);
    vec4 glyph = texture2D(uAtlas, uv);
    float alpha = glyph.a * vAlpha;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export function createLetters(
  atlas: THREE.Texture,
  bounds: [number, number],
  dpr: number,
): LettersHandle {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(MAX_LETTERS * 3);
  const glyph = new Float32Array(MAX_LETTERS);
  const alpha = new Float32Array(MAX_LETTERS);
  const size = new Float32Array(MAX_LETTERS);
  for (let i = 0; i < MAX_LETTERS; i++) size[i] = SIZE_TEXT;

  const posAttr = new THREE.BufferAttribute(positions, 3);
  const glyphAttr = new THREE.BufferAttribute(glyph, 1);
  const alphaAttr = new THREE.BufferAttribute(alpha, 1);
  const sizeAttr = new THREE.BufferAttribute(size, 1);
  geom.setAttribute("position", posAttr);
  geom.setAttribute("aGlyph", glyphAttr);
  geom.setAttribute("aAlpha", alphaAttr);
  geom.setAttribute("aSize", sizeAttr);
  geom.setDrawRange(0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uAtlas: { value: atlas },
      uGlyphCount: { value: LETTER_GLYPH_COUNT },
      uBounds: { value: new THREE.Vector2(bounds[0], bounds[1]) },
      uDpr: { value: dpr },
      uColor: { value: new THREE.Color("#f5f3ee") },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;

  // per-particle state (CPU-side)
  const anchorX = new Float32Array(MAX_LETTERS);
  const anchorY = new Float32Array(MAX_LETTERS);
  const posX = new Float32Array(MAX_LETTERS);
  const posY = new Float32Array(MAX_LETTERS);
  const velX = new Float32Array(MAX_LETTERS);
  const velY = new Float32Array(MAX_LETTERS);
  const spawnMs = new Float32Array(MAX_LETTERS);
  const flipAtMs = new Float32Array(MAX_LETTERS);
  const flipGlyph = new Float32Array(MAX_LETTERS);
  const active = new Uint8Array(MAX_LETTERS);
  const released = new Uint8Array(MAX_LETTERS);
  const flipped = new Uint8Array(MAX_LETTERS);
  let count = 0;
  let boundsX = bounds[0];
  let boundsY = bounds[1];

  function layout(text: string, w: number, h: number) {
    const maxLineWidth = Math.min(w * 0.9, 1600);
    const maxCols = Math.max(8, Math.floor(maxLineWidth / CELL_W));
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      let w2 = word;
      while (w2.length > maxCols) {
        if (cur) {
          lines.push(cur);
          cur = "";
        }
        lines.push(w2.slice(0, maxCols));
        w2 = w2.slice(maxCols);
      }
      if (!cur) cur = w2;
      else if (cur.length + 1 + w2.length <= maxCols) cur += " " + w2;
      else {
        lines.push(cur);
        cur = w2;
      }
    }
    if (cur) lines.push(cur);

    const blockH = lines.length * LINE_H;
    // y-up coordinate space: top of block sits above center
    const topY = h / 2 + blockH / 2 - LINE_H / 2;

    const placed: Array<{ x: number; y: number; ch: string }> = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lineW = line.length * CELL_W;
      const leftX = w / 2 - lineW / 2 + CELL_W / 2;
      const y = topY - li * LINE_H;
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci];
        if (ch === " ") continue;
        placed.push({ x: leftX + ci * CELL_W, y, ch });
      }
    }
    return placed;
  }

  return {
    points,
    setBounds(w, h) {
      boundsX = w;
      boundsY = h;
      material.uniforms.uBounds.value.set(w, h);
    },
    setDpr(d) {
      material.uniforms.uDpr.value = d;
    },
    showText(text, nowMs, color) {
      if (color) material.uniforms.uColor.value.set(color);
      const placed = layout(text, boundsX, boundsY);
      const n = Math.min(placed.length, MAX_LETTERS);
      for (let i = 0; i < n; i++) {
        const p = placed[i];
        glyph[i] = charIndex(p.ch);
        anchorX[i] = p.x;
        anchorY[i] = p.y;
        posX[i] = p.x;
        posY[i] = p.y;
        velX[i] = 0;
        velY[i] = 0;
        spawnMs[i] = nowMs;
        flipAtMs[i] = 400 + Math.random() * (DISINTEGRATE_MS - 1200);
        flipGlyph[i] = randomBoidGlyphIndex();
        active[i] = 1;
        released[i] = 0;
        flipped[i] = 0;
        alpha[i] = 0;
        size[i] = SIZE_TEXT;
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = 0;
      }
      for (let i = n; i < count; i++) {
        active[i] = 0;
        alpha[i] = 0;
      }
      count = Math.max(count, n);
      geom.setDrawRange(0, count);
      posAttr.needsUpdate = true;
      glyphAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
    },
    update(deltaSec, timeSec, baseWind, nowMs) {
      if (count === 0) return;
      const scaledDelta = deltaSec * 0.75;
      const baseScale = 0.5 * 40;
      const swirlScale = 14.0;
      const speedLimit = 4.5;
      const posScale = scaledDelta * 60;
      const bwx = baseWind[0];
      const bwy = baseWind[1];

      let dirty = false;

      for (let i = 0; i < count; i++) {
        if (!active[i]) continue;
        const age = nowMs - spawnMs[i];

        if (age < FADE_IN_MS) {
          alpha[i] = age / FADE_IN_MS;
          dirty = true;
          continue;
        }
        if (age < FADE_IN_MS + SHOW_MS) {
          if (alpha[i] !== 1) {
            alpha[i] = 1;
            dirty = true;
          }
          continue;
        }
        if (age >= TOTAL_MS) {
          if (alpha[i] !== 0) {
            alpha[i] = 0;
            active[i] = 0;
            dirty = true;
          }
          continue;
        }

        const disAge = age - FADE_IN_MS - SHOW_MS;
        const t = disAge / DISINTEGRATE_MS;

        if (!released[i]) {
          const a = Math.random() * Math.PI * 2;
          const s = 0.6 + Math.random() * 1.2;
          velX[i] = Math.cos(a) * s;
          // slight upward bias (y-up) — reads as "let go"
          velY[i] = Math.sin(a) * s + 0.9;
          released[i] = 1;
        }

        if (!flipped[i] && disAge >= flipAtMs[i]) {
          glyph[i] = flipGlyph[i];
          flipped[i] = 1;
        }

        size[i] = SIZE_TEXT + (SIZE_BOID - SIZE_TEXT) * t;
        alpha[i] = 1 - t;

        // match GLSL swirl exactly so letters ride the flock's field
        const x = posX[i];
        const y = posY[i];
        const sa = Math.sin(x * 0.011 + timeSec * 0.6) *
          Math.cos(y * 0.009 - timeSec * 0.45);
        const sb = Math.cos(x * 0.008 - timeSec * 0.5) *
          Math.sin(y * 0.012 + timeSec * 0.35);
        const sc = Math.sin((x + y) * 0.006 + timeSec * 0.25);
        const swirlX = sa + sc * 0.4;
        const swirlY = sb - sc * 0.4;

        const accX = bwx * baseScale + swirlX * swirlScale;
        const accY = bwy * baseScale + swirlY * swirlScale;

        let vx = velX[i] + accX * scaledDelta;
        let vy = velY[i] + accY * scaledDelta;
        const sp = Math.hypot(vx, vy);
        if (sp > speedLimit) {
          vx = (vx / sp) * speedLimit;
          vy = (vy / sp) * speedLimit;
        }
        velX[i] = vx;
        velY[i] = vy;
        posX[i] = x + vx * posScale;
        posY[i] = y + vy * posScale;
        positions[i * 3] = posX[i];
        positions[i * 3 + 1] = posY[i];
        dirty = true;
      }

      if (dirty) {
        posAttr.needsUpdate = true;
        glyphAttr.needsUpdate = true;
        alphaAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
      }
    },
    isBusy(nowMs) {
      for (let i = 0; i < count; i++) {
        if (active[i] && nowMs - spawnMs[i] < TOTAL_MS) return true;
      }
      return false;
    },
    dispose() {
      geom.dispose();
      material.dispose();
    },
  };
}
