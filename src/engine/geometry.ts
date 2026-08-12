import type { DepthMode, Edge, LinearParams, Panel } from './types';
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
function clipSegment(
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
function depthFactors(n: number, mode: DepthMode, rng: () => number): number[] {
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

// ─── Pattern generators ──────────────────────────────────────────
// All work in wall space: feet, origin at wall center, x right, y up.

/** One family of straight parallel lines at `angleDeg`, spaced `spacingFt` apart. */
function parallelFamily(
  wallW: number, wallH: number,
  angleDeg: number, spacingFt: number, jitter: number,
  depthMode: DepthMode, rng: () => number
): Edge[] {
  const hw = wallW / 2, hh = wallH / 2;
  const theta = (angleDeg * Math.PI) / 180;
  // Line direction and its normal
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const nxv = -dy, nyv = dx;
  // Cover the whole wall along the normal
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

/** Horizontal rows of polylines shaped by `shape(x)` — used for Chevron and Waves. */
function rowFamily(
  wallW: number, wallH: number,
  spacingFt: number, jitter: number,
  shape: (x: number) => number,
  sampleStepFt: number,
  depthMode: DepthMode, rng: () => number
): Edge[] {
  const hw = wallW / 2, hh = wallH / 2;
  // Rows must cover the wall even when the shape swings ±amplitude
  const count = Math.max(1, Math.floor((wallH + 2) / spacingFt) + 2);
  const start = -((count - 1) / 2) * spacingFt;
  const factors = depthFactors(count, depthMode, rng);

  const edges: Edge[] = [];
  for (let i = 0; i < count; i++) {
    const y0 = start + i * spacingFt + (jitter > 0 ? (rng() - 0.5) * jitter * spacingFt : 0);
    let px = -hw, py = y0 + shape(-hw);
    for (let x = -hw + sampleStepFt; x <= hw + 1e-9; x += sampleStepFt) {
      const qx = Math.min(x, hw);
      const qy = y0 + shape(qx);
      const clipped = clipSegment(px, py, qx, qy, -hw, -hh, hw, hh);
      if (clipped) edges.push({ ...clipped, d: factors[i] });
      px = qx;
      py = qy;
    }
  }
  return edges;
}

/** Lines radiating from below the bottom-center of the wall. */
function fanFamily(
  wallW: number, wallH: number,
  spacingFt: number, jitter: number,
  depthMode: DepthMode, rng: () => number
): Edge[] {
  const hw = wallW / 2, hh = wallH / 2;
  // Focus sits below the wall so rays spread gracefully across it
  const fx = 0, fy = -hh - wallH * 0.35;
  const reach = Math.sqrt(hw * hw + (hh - fy) * (hh - fy)) * 1.05;
  // Angular pitch chosen so ray spacing ≈ `spacingFt` at mid-wall
  const midDist = Math.abs(-fy); // distance from focus to wall vertical center (y=0)
  const dTheta = spacingFt / midDist;
  const halfSweep = Math.atan2(hw, hh - fy) + dTheta;
  const count = Math.max(1, Math.floor((2 * halfSweep) / dTheta) + 1);
  const factors = depthFactors(count, depthMode, rng);

  const edges: Edge[] = [];
  for (let i = 0; i < count; i++) {
    let theta = -halfSweep + i * dTheta;
    if (jitter > 0) theta += (rng() - 0.5) * jitter * dTheta;
    const dx = Math.sin(theta), dy = Math.cos(theta);
    const clipped = clipSegment(fx, fy, fx + dx * reach, fy + dy * reach, -hw, -hh, hw, hh);
    if (clipped) edges.push({ ...clipped, d: factors[i] });
  }
  return edges;
}

function generatePattern(params: LinearParams): { edges: Edge[]; lineCount: number } {
  const { wallWidth: w, wallHeight: h, pattern, jitter, depthMode } = params;
  const rng = mulberry32(params.seed);
  const spacingFt = Math.max(0.5 / 12, params.spacing / 12);
  const ampFt = params.waveAmplitude / 12;
  const periodFt = Math.max(2 / 12, params.wavePeriod / 12);

  let edges: Edge[] = [];
  let lineCount = 0;

  switch (pattern) {
    case 'Parallel':
      edges = parallelFamily(w, h, params.angle, spacingFt, jitter, depthMode, rng);
      lineCount = edges.length;
      break;

    case 'Crosshatch': {
      const a = parallelFamily(w, h, params.angle, spacingFt, jitter, depthMode, rng);
      const b = parallelFamily(w, h, params.angle + params.crossAngle, spacingFt, jitter, depthMode, rng);
      edges = [...a, ...b];
      lineCount = a.length + b.length;
      break;
    }

    case 'Chevron': {
      // Triangle wave: straight zig-zag peaks
      const half = periodFt / 2;
      const tri = (x: number) => {
        const t = ((x % periodFt) + periodFt) % periodFt;
        return t < half
          ? -ampFt + (2 * ampFt * t) / half
          : ampFt - (2 * ampFt * (t - half)) / half;
      };
      // Sample exactly at peaks so chevrons stay crisp
      const rows = rowFamily(w, h, spacingFt, jitter, tri, half, depthMode, rng);
      edges = rows;
      lineCount = Math.max(1, Math.floor((h + 2) / spacingFt) + 2);
      break;
    }

    case 'Waves': {
      const sine = (x: number) => ampFt * Math.sin((2 * Math.PI * x) / periodFt);
      const rows = rowFamily(w, h, spacingFt, jitter, sine, periodFt / 24, depthMode, rng);
      edges = rows;
      lineCount = Math.max(1, Math.floor((h + 2) / spacingFt) + 2);
      break;
    }

    case 'Fan':
      edges = fanFamily(w, h, spacingFt, jitter, depthMode, rng);
      lineCount = edges.length;
      break;
  }

  return { edges, lineCount };
}

// ─── Panel Tiling (greedy, largest-first on 2ft grid) ────────────
export function tilePanels(wallW: number, wallH: number): Panel[] {
  const gridCols = wallW / 2;
  const gridRows = wallH / 2;
  const used = new Uint8Array(gridCols * gridRows);
  const panels: Panel[] = [];

  function isFree(gx: number, gy: number, cw: number, ch: number): boolean {
    if (gx + cw > gridCols || gy + ch > gridRows) return false;
    for (let dy = 0; dy < ch; dy++)
      for (let dx = 0; dx < cw; dx++)
        if (used[(gy + dy) * gridCols + gx + dx]) return false;
    return true;
  }

  function mark(gx: number, gy: number, cw: number, ch: number): void {
    for (let dy = 0; dy < ch; dy++)
      for (let dx = 0; dx < cw; dx++)
        used[(gy + dy) * gridCols + gx + dx] = 1;
  }

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      if (used[gy * gridCols + gx]) continue;
      if (isFree(gx, gy, 2, 2)) { mark(gx, gy, 2, 2); panels.push({ gx, gy, w: 4, h: 4 }); }
      else if (isFree(gx, gy, 2, 1)) { mark(gx, gy, 2, 1); panels.push({ gx, gy, w: 4, h: 2 }); }
      else if (isFree(gx, gy, 1, 2)) { mark(gx, gy, 1, 2); panels.push({ gx, gy, w: 2, h: 4 }); }
      else { mark(gx, gy, 1, 1); panels.push({ gx, gy, w: 2, h: 2 }); }
    }
  }

  return panels;
}

export function panelBreakdown(panels: Panel[]): string {
  const counts: Record<string, number> = {};
  for (const p of panels) {
    const key = `${p.w}′×${p.h}′`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const order = ['4′×4′', '4′×2′', '2′×4′', '2′×2′'];
  return order.filter((k) => counts[k]).map((k) => `${counts[k]}× ${k}`).join('  +  ');
}

// ─── Full pattern computation ────────────────────────────────────
export interface LinearPattern {
  edges: Edge[];
  panels: Panel[];
  wallW: number;
  wallH: number;
  lineCount: number;
}

export function computePattern(params: LinearParams): LinearPattern {
  const { edges, lineCount } = generatePattern(params);
  const panels = tilePanels(params.wallWidth, params.wallHeight);
  return { edges, panels, wallW: params.wallWidth, wallH: params.wallHeight, lineCount };
}
