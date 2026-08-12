// Image-driven carving styles — the compartment for everything that turns
// a picture into toolpaths. Each style is one self-contained generator
// registered in IMAGE_STYLE_GENERATORS; add or tune styles here without
// touching the rest of the engine.
//
// Pipeline: SourceImage → processImage() → ReliefField (depth factors)
//           → makeWallSampler() → per-style generator → Edge[]

import type { Edge, ImageStyle, ReliefField, SourceImage } from './types';
import { IMAGE_DEPTH_LEVELS } from './types';
import { clipSegment, parallelFamily } from './primitives';

// ─── Image processing ────────────────────────────────────────────

/** Separable box blur on a luminance field (radius in source pixels). */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.round(radius);
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const norm = 1 / (2 * r + 1);
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
 * Pipeline: blur → auto-contrast (0.2/99.8 percentile stretch — near-true
 * min/max, robust to stray pixels, no plateau clipping) → polarity →
 * depth-curve gamma.
 */
export function processImage(
  image: SourceImage,
  invert: boolean,
  smooth: number,
  gamma: number = 1
): ReliefField {
  const blurred = boxBlur(image.lum, image.w, image.h, smooth);
  const n = image.w * image.h;

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
 * factor. The image cover-fits the wall: spans the wall's larger dimension
 * fully, center-cropped on the other (px-per-foot is the SMALLER ratio —
 * the larger would leave part of the wall sampling clamped edge pixels).
 */
export function makeWallSampler(
  relief: ReliefField,
  wallW: number,
  wallH: number
): (x: number, y: number) => number {
  const { data, w, h } = relief;
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

/** Quantize a 0..1 factor to IMAGE_DEPTH_LEVELS (bounds DXF layer count). */
function qLevel(f: number): number {
  return Math.max(1, Math.round(f * IMAGE_DEPTH_LEVELS)) / IMAGE_DEPTH_LEVELS;
}

// ─── Style generators ────────────────────────────────────────────

export interface ImageStyleContext {
  wallW: number;
  wallH: number;
  angleDeg: number;
  spacingFt: number;
  jitter: number;
  sample: (x: number, y: number) => number;
  rng: () => number;
}

export interface ImageStyleResult {
  edges: Edge[];
  lineCount: number;
}

/**
 * Depth: straight lines dive deeper where the image is dark. Lines are
 * walked in ~1" steps, depth quantized and merged into runs; near-zero
 * depths are skipped so highlights stay uncarved.
 */
function depthStyle(ctx: ImageStyleContext): ImageStyleResult {
  const { wallW, wallH, angleDeg, spacingFt, jitter, sample, rng } = ctx;
  const base = parallelFamily(wallW, wallH, angleDeg, spacingFt, jitter, 'Uniform', rng);
  const stepFt = 1 / 12;
  const cutoff = 0.075;
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

/**
 * Wave: constant-depth lines that wiggle — amplitude follows the image,
 * so the picture emerges from how agitated each line is. Constant depth
 * also means constant tool load on the CNC.
 */
function waveStyle(ctx: ImageStyleContext): ImageStyleResult {
  const { wallW, wallH, angleDeg, spacingFt, jitter, sample, rng } = ctx;
  const hw = wallW / 2, hh = wallH / 2;
  const base = parallelFamily(wallW, wallH, angleDeg, spacingFt, jitter, 'Uniform', rng);
  const wavelength = spacingFt * 3;
  const step = wavelength / 8;
  const maxAmp = spacingFt * 0.45; // stay clear of the neighbor line
  const edges: Edge[] = [];

  for (const line of base) {
    const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < step) continue;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const n = Math.ceil(len / step);

    let px = 0, py = 0, has = false;
    for (let i = 0; i <= n; i++) {
      const t = Math.min(i * step, len);
      const cx = line.x0 + ux * t, cy = line.y0 + uy * t;
      const amp = maxAmp * sample(cx, cy);
      const off = amp * Math.sin((2 * Math.PI * t) / wavelength);
      const wx = cx + nx * off, wy = cy + ny * off;
      if (has) {
        const clipped = clipSegment(px, py, wx, wy, -hw, -hh, hw, hh);
        if (clipped) edges.push({ ...clipped, d: 1 });
      }
      px = wx;
      py = wy;
      has = true;
    }
  }
  return { edges, lineCount: base.length };
}

/**
 * Density: line spacing follows the image — lines bunch together where
 * the image is dark, like an engraving. Depth adds a soft assist.
 */
function densityStyle(ctx: ImageStyleContext): ImageStyleResult {
  const { wallW, wallH, angleDeg, spacingFt, sample } = ctx;
  const hw = wallW / 2, hh = wallH / 2;
  const theta = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const nxv = -dy, nyv = dx;
  const diag = Math.sqrt(wallW * wallW + wallH * wallH);
  const minS = spacingFt * 0.4;
  const maxS = spacingFt * 1.8;
  const edges: Edge[] = [];

  let o = -diag / 2;
  while (o <= diag / 2) {
    const cx = nxv * o, cy = nyv * o;
    const clipped = clipSegment(
      cx - dx * diag, cy - dy * diag,
      cx + dx * diag, cy + dy * diag,
      -hw, -hh, hw, hh
    );
    let mean = 0;
    if (clipped) {
      const K = 24;
      for (let k = 0; k < K; k++) {
        const t = (k + 0.5) / K;
        mean += sample(
          clipped.x0 + (clipped.x1 - clipped.x0) * t,
          clipped.y0 + (clipped.y1 - clipped.y0) * t
        );
      }
      mean /= K;
      edges.push({ ...clipped, d: qLevel(0.55 + 0.45 * mean) });
    }
    o += maxS - (maxS - minS) * mean;
  }
  return { edges, lineCount: edges.length };
}

/**
 * Dimples: staggered hex grid of ball-end drill pecks — depth (and with
 * it crater size) follows the image. Reads like a dot-screen print.
 */
function dimplesStyle(ctx: ImageStyleContext): ImageStyleResult {
  const { wallW, wallH, spacingFt, jitter, sample, rng } = ctx;
  const hw = wallW / 2, hh = wallH / 2;
  const rowH = spacingFt * 0.866; // hex stagger
  const cutoff = 0.06;
  const edges: Edge[] = [];

  for (let y = -hh + rowH / 2, row = 0; y < hh; y += rowH, row++) {
    const xOff = row % 2 === 0 ? 0 : spacingFt / 2;
    for (let x = -hw + spacingFt / 2 + xOff; x < hw; x += spacingFt) {
      let px = x, py = y;
      if (jitter > 0) {
        px += (rng() - 0.5) * jitter * spacingFt * 0.5;
        py += (rng() - 0.5) * jitter * rowH * 0.5;
      }
      if (px < -hw || px > hw || py < -hh || py > hh) continue;
      const f = sample(px, py);
      if (f < cutoff) continue;
      edges.push({ x0: px, y0: py, x1: px, y1: py, d: qLevel(f) });
    }
  }
  return { edges, lineCount: edges.length };
}

/**
 * Contour: lines shift sideways by the image's depth factor, bunching and
 * flowing around features like topographic contours — the Textured Panel
 * Maker's ribbon aesthetic translated to constant-depth CNC lines.
 */
function contourStyle(ctx: ImageStyleContext): ImageStyleResult {
  const { wallW, wallH, angleDeg, spacingFt, jitter, sample, rng } = ctx;
  const hw = wallW / 2, hh = wallH / 2;
  const base = parallelFamily(wallW, wallH, angleDeg, spacingFt, jitter, 'Uniform', rng);
  const step = Math.max(0.5 / 12, spacingFt / 2);
  const maxShift = spacingFt * 1.6; // how far a line can wander into its neighbors
  const edges: Edge[] = [];

  for (const line of base) {
    const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < step) continue;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const n = Math.ceil(len / step);

    let px = 0, py = 0, has = false;
    for (let i = 0; i <= n; i++) {
      const t = Math.min(i * step, len);
      const cx = line.x0 + ux * t, cy = line.y0 + uy * t;
      const off = maxShift * sample(cx, cy);
      const wx = cx + nx * off, wy = cy + ny * off;
      if (has) {
        const clipped = clipSegment(px, py, wx, wy, -hw, -hh, hw, hh);
        if (clipped) edges.push({ ...clipped, d: 1 });
      }
      px = wx;
      py = wy;
      has = true;
    }
  }
  return { edges, lineCount: base.length };
}

/**
 * Ribbon: the Textured Panel Maker's displacement logic as carve lines.
 * Coarse control points are displaced sideways AND in depth by the image,
 * then smoothed with a uniform cubic B-spline (TPM's approach) so the
 * lines flow like silk ribbons — bunching around features while rising
 * and falling with the image.
 */
function ribbonStyle(ctx: ImageStyleContext): ImageStyleResult {
  const { wallW, wallH, angleDeg, spacingFt, jitter, sample, rng } = ctx;
  const hw = wallW / 2, hh = wallH / 2;
  const base = parallelFamily(wallW, wallH, angleDeg, spacingFt, jitter, 'Uniform', rng);
  const ctrlStep = Math.max(4 / 12, spacingFt * 1.5); // coarse → smooth flowing curves
  const segsPerSpan = 6;
  const maxShift = spacingFt * 1.6;
  const minDepth = 0.25; // ribbon stays continuous — never fades out entirely
  const edges: Edge[] = [];

  // Uniform cubic B-spline basis (TPM smooths its rows the same way)
  const bspline = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const t2 = t * t, t3 = t2 * t;
    return (
      ((1 - 3 * t + 3 * t2 - t3) * p0 +
        (4 - 6 * t2 + 3 * t3) * p1 +
        (1 + 3 * t + 3 * t2 - 3 * t3) * p2 +
        t3 * p3) / 6
    );
  };

  for (const line of base) {
    const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < ctrlStep) continue;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;

    // Control points: position shifted sideways by the image, depth from it too
    const nCtrl = Math.max(4, Math.ceil(len / ctrlStep) + 1);
    const cxs: number[] = [], cys: number[] = [], cds: number[] = [];
    for (let i = 0; i < nCtrl; i++) {
      const t = (i / (nCtrl - 1)) * len;
      const px = line.x0 + ux * t, py = line.y0 + uy * t;
      const f = sample(px, py);
      cxs.push(px + nx * maxShift * f);
      cys.push(py + ny * maxShift * f);
      cds.push(minDepth + (1 - minDepth) * f);
    }
    // Clamp ends so the spline reaches the wall edges
    const at = (arr: number[], i: number) => arr[Math.max(0, Math.min(arr.length - 1, i))];

    let px = 0, py = 0, pd = 0, has = false;
    for (let span = -1; span < nCtrl; span++) {
      for (let k = span === -1 ? 0 : 1; k <= segsPerSpan; k++) {
        const t = k / segsPerSpan;
        const wx = bspline(at(cxs, span - 1), at(cxs, span), at(cxs, span + 1), at(cxs, span + 2), t);
        const wy = bspline(at(cys, span - 1), at(cys, span), at(cys, span + 1), at(cys, span + 2), t);
        const wd = bspline(at(cds, span - 1), at(cds, span), at(cds, span + 1), at(cds, span + 2), t);
        if (has) {
          const clipped = clipSegment(px, py, wx, wy, -hw, -hh, hw, hh);
          if (clipped) edges.push({ ...clipped, d: qLevel((pd + wd) / 2) });
        }
        px = wx;
        py = wy;
        pd = wd;
        has = true;
      }
    }
  }
  return { edges, lineCount: base.length };
}

// ─── Registry ────────────────────────────────────────────────────
export const IMAGE_STYLE_GENERATORS: Record<
  ImageStyle,
  (ctx: ImageStyleContext) => ImageStyleResult
> = {
  Depth: depthStyle,
  Wave: waveStyle,
  Density: densityStyle,
  Contour: contourStyle,
  Ribbon: ribbonStyle,
  Dimples: dimplesStyle,
};
