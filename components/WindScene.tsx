"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createNoise3D } from "simplex-noise";

import { createSimulation, type SimulationHandle } from "@/lib/boids/simulation";
import { createGlyphAtlas } from "@/lib/boids/atlas";
import { createGlyphSprites } from "@/lib/boids/sprites";
import { createLetterAtlas } from "@/lib/boids/letterAtlas";
import { createLetters } from "@/lib/boids/letters";
import { hexToRgb01 } from "@/lib/palette";
import { BOID_COUNT } from "@/lib/boids/shaders";

const FRAME_MS = 1000 / 30;
const POLL_MS = 2000;
// A shown word starts dissolving ~1.6s after it appears (letters.ts: fade 600 + hold 1000).
// We seed the flock with its color at that moment, so "text becomes particles" reads clearly.
const RECOLOR_DELAY_MS = 1600;
// Cap how much of the flock the week's history pre-seeds on load (leaves room for live churn).
const SEED_CAP = Math.floor(BOID_COUNT * 0.6);
// Approx particles each live release recolors (clamp(len,6,30) midpoint); used so a
// reload re-seeds the flock to roughly the density the live dissolves would have built.
const AVG_SEED_PER_RELEASE = 12;

type Item = { id: string; text: string; color?: string; ts: number };

export function WindScene() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x0a0a0a, 1);

    const canvasEl = renderer.domElement;
    canvasEl.style.display = "block";
    canvasEl.style.width = "100vw";
    canvasEl.style.height = "100dvh";
    container.appendChild(canvasEl);

    let width = window.innerWidth;
    let height = window.innerHeight;
    renderer.setSize(width, height, false);

    let sim: SimulationHandle;
    try {
      sim = createSimulation(renderer, [width, height]);
    } catch (e) {
      console.error("[WindScene] simulation init failed", e);
      return;
    }

    const atlas = createGlyphAtlas();
    const sprites = createGlyphSprites([width, height], atlas, dpr);

    const letterAtlas = createLetterAtlas();
    const letters = createLetters(letterAtlas, [width, height], dpr);

    const scene = new THREE.Scene();
    scene.add(sprites.points);
    scene.add(letters.points);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    const baseNoise = createNoise3D();

    const onResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      renderer.setSize(width, height, false);
      sim.setBounds(width, height);
      sprites.material.uniforms.uBounds.value.set(width, height);
      letters.setBounds(width, height);
    };
    window.addEventListener("resize", onResize);

    const pending: { text: string; color: string }[] = [];
    // scheduled flock recolors: fire at `dueMs` so the seed coincides with dissolve
    const recolorQueue: { dueMs: number; n: number; rgb: [number, number, number] }[] = [];
    let lastTs = Date.now();
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/release?since=${lastTs}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: Item[] };
        if (cancelled || !data.items?.length) return;
        for (const it of data.items) {
          if (it.ts > lastTs) lastTs = it.ts;
          pending.push({ text: it.text, color: it.color ?? "#f5f3ee" });
        }
      } catch {
        // ignore transient network errors
      }
    };
    poll();
    const pollId = window.setInterval(poll, POLL_MS);

    // Pre-seed the flock from the week's history so accumulation survives reloads.
    (async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          counts?: Record<string, number>;
          total?: number;
        };
        if (cancelled || !data.counts) return;
        const total = data.total ?? 0;
        if (total <= 0) return;
        const budget = Math.min(SEED_CAP, total * AVG_SEED_PER_RELEASE);
        for (const [hex, count] of Object.entries(data.counts)) {
          const seed = Math.round((count / total) * budget);
          if (seed > 0) sprites.recolor(seed, hexToRgb01(hex));
        }
      } catch {
        // ignore
      }
    })();

    let raf = 0;
    let last = 0;
    let lastTickMs = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < FRAME_MS) return;

      const delta = Math.min(0.05, (now - lastTickMs) / 1000);
      lastTickMs = now;

      const t = now * 0.001;
      const slowX = Math.tanh(baseNoise(0, 0, t * 0.25) * 2.0);
      const slowY = baseNoise(100, 100, t * 0.2) * 0.7;
      const gustX = baseNoise(50, 0, t * 1.1) * 0.6;
      const gustY = baseNoise(0, 50, t * 0.9) * 0.6;
      const wind: [number, number] = [slowX + gustX, slowY + gustY];
      sim.compute(delta * 0.75, t, wind);

      if (pending.length && !letters.isBusy(now)) {
        const { text, color } = pending.shift()!;
        letters.showText(text, now, color);
        // seed the flock with this color as the word dissolves
        const n = Math.max(6, Math.min(30, text.length));
        recolorQueue.push({
          dueMs: now + RECOLOR_DELAY_MS,
          n,
          rgb: hexToRgb01(color),
        });
      }
      // fire any due flock recolors
      for (let i = recolorQueue.length - 1; i >= 0; i--) {
        if (now >= recolorQueue[i].dueMs) {
          const r = recolorQueue[i];
          sprites.recolor(r.n, r.rgb);
          recolorQueue.splice(i, 1);
        }
      }
      letters.update(delta, t, wind, now);

      sprites.material.uniforms.uPosition.value = sim.getPositionTexture();
      sprites.material.uniforms.uVelocity.value = sim.getVelocityTexture();

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      last = now;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearInterval(pollId);
      window.removeEventListener("resize", onResize);
      sim.dispose();
      atlas.dispose();
      sprites.material.dispose();
      sprites.points.geometry.dispose();
      letterAtlas.dispose();
      letters.dispose();
      renderer.dispose();
      if (canvasEl.parentNode) canvasEl.parentNode.removeChild(canvasEl);
    };
  }, []);

  return <div ref={containerRef} className="fixed inset-0 bg-ink" />;
}
