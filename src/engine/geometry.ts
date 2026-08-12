import type { DepthMode, Edge, LinearParams, Panel, ReliefField, SourceImage } from './types';
import { IMAGE_DEPTH_LEVELS, MIN_DEPTH_FACTOR } from './types';

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

// ─── Image processing ────────────────────────────────────────────

/** Separable box blur on a luminance field (radius in source pixels). */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.round(radius);
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const norm = 1 / (2 * r + 1);
  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm;
      const xAdd = Math.min(w - 1, x + r + 1);
      const xSub = Math.max(0, x - r);
      acc += src[row + xAdd] - src[row + xSub];
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * norm;
      const yAdd = Math.min(h - 1, y + r + 1);
      const ySub = Math.max(0, y - r);
      acc += tmp[yAdd * w + x] - tmp[ySub * w + x];
    }
  }
  return out;
}

/**
 * Luminance image → per-pixel depth factor (0..1).
 * Pipeline: blur → auto-contrast (2nd/98th percentile stretch, so washed-out
 * photos still carve the full depth range) → polarity → depth-curve gamma.
 */
export function processImage(
  image: SourceImage,
  invert: boolean,
  smooth: number,
  gamma: number = 1
): ReliefField {
  const blurred = boxBlur(image.lum, image.w, image.h, smooth);
  const n = image.w * image.h;

  // Auto-contrast: stretch to the 0.2% / 99.8% luminance percentiles.
  // Near-true min/max (robust to stray pixels after the blur) so washed-out
  // photos use the full depth range WITHOUT flattening smooth gradients
  // into clipped plateaus the way an aggressive percentile stretch would.
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    hist[Math.max(0, Math.min(255, (blurred[i] * 255) | 0))]++;
  }
  const loCount = n * 0.002, hiCount = n * 0.998;
  let acc = 0, lo = 0, hi = 255;
  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (acc <= loCount) lo = b;
    if (acc <= hiCount) hi = b;
  }
  const loF = lo / 255, hiF = Math.max(hi / 255, loF + 1 / 255);
  const invRange = 1 / (hiF - loF);

  const g = Math.max(0.1, gamma);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = (blurred[i] - loF) * invRange;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    v = invert ? v : 1 - v; // default: dark carves deepest
    data[i] = g === 1 ? v : Math.pow(v, g);
  }
  return { data, w: image.w, h: image.h };
}

/**
 * Sampler mapping wall space (feet, centered origin, y up) → relief depth
 * factor. The image cover-fits the wall: fills it completely, center-cropped.
 */
export function makeWallSampler(
  relief: ReliefField,
  wallW: number,
  wallH: number
): (x: number, y: number) => number {
  const { data, w, h } = relief;
  // Cover-fit: the image spans the wall's larger dimension fully and is
  // center-cropped on the other — px-per-foot is the SMALLER ratio, else
  // part of the wall would sample clamped edge pixels as flat streaks.
  const scale = Math.min((w - 1) / wallW, (h - 1) / wallH);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  return (x: number, y: number): number => {
    const px = Math.max(0, Math.min(w - 1.001, cx + x * scale));
    const py = Math.max(0, Math.min(h - 1.001, cy - y * scale)); // y up → row down
    const x0 = px | 0, y0 = py | 0;
    const fx = px - x0, fy = py - y0;
    const i00 = data[y0 * w + x0];
    const i10 = data[y0 * w + x0 + 1];
    const i01 = data[(y0 + 1) * w + x0];
    const i11 = data[(y0 + 1) * w + x0 + 1];
    return (i00 * (1 - fx) + i10 * fx) * (1 - fy) + (i01 * (1 - fx) + i11 * fx) * fy;
  };
}

/**
 * Image Lines: parallel lines whose depth follows the image. Each line is
 * walked in ~1" steps, depth quantized to IMAGE_DEPTH_LEVELS and merged
 * into runs; near-zero depths are skipped so highlights become uncarved.
 */
function imageLineFamily(
  wallW: number, wallH: number,
  angleDeg: number, spacingFt: number, jitter: number,
  sample: (x: number, y: number) => number,
  rng: () => number
): { edges: Edge[]; lineCount: number } {
  const base = parallelFamily(wallW, wallH, angleDeg, spacingFt, jitter, 'Uniform', rng);
  const stepFt = 1 / 12; // sample every inch along the line
  const cutoff = 0.075;  // below this factor, leave the surface uncarved
  const edges: Edge[] = [];

  for (const line of base) {
    const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < stepFt) continue;
    const n = Math.ceil(len / stepFt);
    const ux = dx / len, uy = dy / len;

    let runStart = -1;
    let runLevel = -1;
    const flush = (endIdx: number) => {
      if (runStart < 0) return;
      const s = runStart * stepFt, e = Math.min(endIdx * stepFt, len);
      edges.push({
        x0: line.x0 + ux * s, y0: line.y0 + uy * s,
        x1: line.x0 + ux * e, y1: line.y0 + uy * e,
        d: runLevel / IMAGE_DEPTH_LEVELS,
      });
      runStart = -1;
    };

    for (let i = 0; i <= n; i++) {
      const t = Math.min(i * stepFt, len);
      const f = sample(line.x0 + ux * t, line.y0 + uy * t);
      const level = f < cutoff ? 0 : Math.max(1, Math.round(f * IMAGE_DEPTH_LEVELS));
      if (level !== runLevel) {
        flush(i);
        if (level > 0) {
          runStart = i;
          runLevel = level;
        } else {
          runLevel = 0;
        }
      }
    }
    flush(n);
  }

  return { edges, lineCount: base.length };
}

function generatePattern(
  params: LinearParams,
  relief: ReliefField | null
): { edges: Edge[]; lineCount: number } {
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

    case 'Image Lines': {
      if (!relief) break;
      const sample = makeWallSampler(relief, w, h);
      const result = imageLineFamily(w, h, params.angle, spacingFt, jitter, sample, rng);
      edges = result.edges;
      lineCount = result.lineCount;
      break;
    }

    case 'Image Relief':
      // No line edges — the relief field itself is the carve geometry.
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
  /** Present only in Image Relief mode — continuous depth field. */
  relief: ReliefField | null;
}

export function computePattern(params: LinearParams, image: SourceImage | null): LinearPattern {
  const isImageMode = params.pattern === 'Image Lines' || params.pattern === 'Image Relief';
  const relief = isImageMode && image
    ? processImage(image, params.imageInvert, params.imageSmooth, params.imageGamma)
    : null;
  const { edges, lineCount } = generatePattern(params, relief);
  const panels = tilePanels(params.wallWidth, params.wallHeight);
  return {
    edges,
    panels,
    wallW: params.wallWidth,
    wallH: params.wallHeight,
    lineCount,
    relief: params.pattern === 'Image Relief' ? relief : null,
  };
}
