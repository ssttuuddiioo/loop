import * as THREE from "three";
import { BOID_COUNT, BOID_TEX_SIZE } from "./shaders";
import { GLYPH_COUNT } from "./atlas";

const vert = /* glsl */ `
  attribute float boidIndex;
  attribute vec4 aColor;
  uniform sampler2D uPosition;
  uniform sampler2D uVelocity;
  uniform vec2 uBounds;
  uniform float uPointSize;
  uniform float uDpr;
  varying float vDepth;
  varying float vGlyphIdx;
  varying vec4 vColor;

  float hash11(float n) {
    return fract(sin(n * 12.9898) * 43758.5453);
  }

  void main() {
    float texSize = ${BOID_TEX_SIZE}.0;
    vec2 texUv = vec2(
      mod(boidIndex, texSize) + 0.5,
      floor(boidIndex / texSize) + 0.5
    ) / texSize;
    vec2 pos = texture2D(uPosition, texUv).xy;
    vec2 vel = texture2D(uVelocity, texUv).xy;

    float depth = 0.35 + hash11(boidIndex + 1.0) * 0.65;
    vDepth = depth;

    float speed = length(vel);
    float idx = 1.0;
    if (speed >= 0.6) {
      float angle = atan(vel.y, vel.x);
      float a = mod(angle + 3.14159265, 3.14159265) / 3.14159265;
      if (a < 0.14 || a >= 0.86) idx = speed > 4.0 ? 3.0 : 2.0;
      else if (a < 0.38) idx = 5.0;
      else if (a < 0.62) idx = 4.0;
      else idx = 6.0;
    }
    if (hash11(boidIndex + 37.0) > 0.965) idx = 7.0;
    vGlyphIdx = idx;
    vColor = aColor;

    vec2 clip = pos / uBounds * 2.0 - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
    gl_PointSize = max(4.0, uPointSize * depth * uDpr);
  }
`;

const frag = /* glsl */ `
  precision mediump float;
  uniform sampler2D uGlyphAtlas;
  uniform vec3 uBone;
  uniform vec3 uRoyal;
  varying float vDepth;
  varying float vGlyphIdx;
  varying vec4 vColor;

  void main() {
    vec2 pc = gl_PointCoord;
    float glyphCount = ${GLYPH_COUNT}.0;
    vec2 atlasUv = vec2((vGlyphIdx + pc.x) / glyphCount, pc.y);
    vec4 glyph = texture2D(uGlyphAtlas, atlasUv);

    bool accent = vGlyphIdx > 6.5;
    // vColor.a > 0.5 marks a particle that has been "seeded" by a released word
    vec3 color = vColor.a > 0.5 ? vColor.rgb : (accent ? uRoyal : uBone);

    float alpha = glyph.a * (0.45 + vDepth * 0.55);
    if (alpha < 0.02) discard;

    gl_FragColor = vec4(color, alpha);
  }
`;

export function createGlyphSprites(
  bounds: [number, number],
  atlas: THREE.Texture,
  dpr: number,
) {
  const geom = new THREE.BufferGeometry();
  const indices = new Float32Array(BOID_COUNT);
  const positions = new Float32Array(BOID_COUNT * 3);
  // per-particle color: rgb + flag (a). a=0 → use default bone/royal; a=1 → custom.
  const colors = new Float32Array(BOID_COUNT * 4); // all zero = unseeded
  for (let i = 0; i < BOID_COUNT; i++) indices[i] = i;
  geom.setAttribute("boidIndex", new THREE.BufferAttribute(indices, 1));
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colorAttr = new THREE.BufferAttribute(colors, 4);
  geom.setAttribute("aColor", colorAttr);

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uPosition: { value: null },
      uVelocity: { value: null },
      uBounds: { value: new THREE.Vector2(bounds[0], bounds[1]) },
      uPointSize: { value: 18.0 },
      uDpr: { value: dpr },
      uGlyphAtlas: { value: atlas },
      uBone: { value: new THREE.Color("#f5f3ee") },
      uRoyal: { value: new THREE.Color("#4169e1") },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;

  // Recolor `count` random particles to rgb (each 0..1), persistently.
  // Overwrites already-seeded particles too, so the flock keeps churning.
  function recolor(count: number, rgb: [number, number, number]) {
    const n = Math.max(0, Math.min(count, BOID_COUNT));
    for (let k = 0; k < n; k++) {
      const i = Math.floor(Math.random() * BOID_COUNT);
      colors[i * 4] = rgb[0];
      colors[i * 4 + 1] = rgb[1];
      colors[i * 4 + 2] = rgb[2];
      colors[i * 4 + 3] = 1; // flag = seeded
    }
    colorAttr.needsUpdate = true;
  }

  return { points, material, recolor };
}
