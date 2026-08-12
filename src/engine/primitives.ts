// Shared low-level building blocks used by both the linear pattern
// generators (geometry.ts) and the image-driven styles (imageStyles.ts).

import type { DepthMode, Edge } from './types';
import { MIN_DEPTH_FACTOR } from './types';

// ─── Seeded RNG ─────────────────────────────────────────────────
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Segment clipping (Liang–Barsky) ─────────────────────────────
export function clipSegment(
  x0: number, y0: number, x1: number, y1: number,
  xmin: number, ymin: number, xmax: number, ymax: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  let t0 = 0, t1 = 1;
  const dxv = x1 - x0, dyv = y1 - y0;
  const p = [-dxv, dxv, -dyv, dyv];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-10) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t0) t0 = r;
      } else {
        if (r < t1) t1 = r;
      }
    }
  }
  if (t0 > t1) return null;
  return {
    x0: x0 + t0 * dxv, y0: y0 + t0 * dyv,
    x1: x0 + t1 * dxv, y1: y0 + t1 * dyv,
  };
}

// ─── Depth factor per line index ─────────────────────────────────
export function depthFactors(n: number, mode: DepthMode, rng: () => number): number[] {
  const f: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    switch (mode) {
      case 'Uniform':
        f[i] = 1;
        break;
      case 'Alternating':
        f[i] = i % 2 === 0 ? 1 : MIN_DEPTH_FACTOR + (1 - MIN_DEPTH_FACTOR) * 0.3;
        break;
      case 'Gradient':
        f[i] = n <= 1 ? 1 : MIN_DEPTH_FACTOR + (1 - MIN_DEPTH_FACTOR) * (i / (n - 1));
        break;
      case 'Random':
        f[i] = MIN_DEPTH_FACTOR + (1 - MIN_DEPTH_FACTOR) * rng();
        break;
    }
  }
  return f;
}

// ─── Parallel line family ────────────────────────────────────────
/** One family of straight parallel lines at `angleDeg`, spaced `spacingFt` apart. */
export function parallelFamily(
  wallW: number, wallH: number,
  angleDeg: number, spacingFt: number, jitter: number,
  depthMode: DepthMode, rng: () => number
): Edge[] {
  const hw = wallW / 2, hh = wallH / 2;
  const theta = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const nxv = -dy, nyv = dx;
  const diag = Math.sqrt(wallW * wallW + wallH * wallH);
  const count = Math.max(1, Math.floor(diag / spacingFt) + 1);
  const start = -((count - 1) / 2) * spacingFt;
  const factors = depthFactors(count, depthMode, rng);

  const edges: Edge[] = [];
  for (let i = 0; i < count; i++) {
    const offset = start + i * spacingFt + (jitter > 0 ? (rng() - 0.5) * jitter * spacingFt : 0);
    const cx = nxv * offset, cy = nyv * offset;
    const clipped = clipSegment(
      cx - dx * diag, cy - dy * diag,
      cx + dx * diag, cy + dy * diag,
      -hw, -hh, hw, hh
    );
    if (clipped) edges.push({ ...clipped, d: factors[i] });
  }
  return edges;
}
