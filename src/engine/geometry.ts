import type { Edge, LinearParams, Panel, ReliefField, SourceImage } from './types';
import { clipSegment, depthFactors, mulberry32, parallelFamily } from './primitives';
import { IMAGE_STYLE_GENERATORS, makeWallSampler, processImage } from './imageStyles';

// Re-exported so existing imports (textures.ts, tests) keep working
export { makeWallSampler, processImage } from './imageStyles';
export { mulberry32 } from './primitives';

// ─── Linear pattern generators ───────────────────────────────────
// All work in wall space: feet, origin at wall center, x right, y up.

/** Horizontal rows of polylines shaped by `shape(x)` — used for Chevron and Waves. */
function rowFamily(
  wallW: number, wallH: number,
  spacingFt: number, jitter: number,
  shape: (x: number) => number,
  sampleStepFt: number,
  depthMode: LinearParams['depthMode'], rng: () => number
): Edge[] {
  const hw = wallW / 2, hh = wallH / 2;
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
  depthMode: LinearParams['depthMode'], rng: () => number
): Edge[] {
  const hw = wallW / 2, hh = wallH / 2;
  const fx = 0, fy = -hh - wallH * 0.35;
  const reach = Math.sqrt(hw * hw + (hh - fy) * (hh - fy)) * 1.05;
  const midDist = Math.abs(-fy);
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
      const half = periodFt / 2;
      const tri = (x: number) => {
        const t = ((x % periodFt) + periodFt) % periodFt;
        return t < half
          ? -ampFt + (2 * ampFt * t) / half
          : ampFt - (2 * ampFt * (t - half)) / half;
      };
      edges = rowFamily(w, h, spacingFt, jitter, tri, half, depthMode, rng);
      lineCount = Math.max(1, Math.floor((h + 2) / spacingFt) + 2);
      break;
    }

    case 'Waves': {
      const sine = (x: number) => ampFt * Math.sin((2 * Math.PI * x) / periodFt);
      edges = rowFamily(w, h, spacingFt, jitter, sine, periodFt / 24, depthMode, rng);
      lineCount = Math.max(1, Math.floor((h + 2) / spacingFt) + 2);
      break;
    }

    case 'Fan':
      edges = fanFamily(w, h, spacingFt, jitter, depthMode, rng);
      lineCount = edges.length;
      break;

    case 'Image Lines': {
      if (!relief) break;
      const result = IMAGE_STYLE_GENERATORS[params.imageStyle]({
        wallW: w,
        wallH: h,
        angleDeg: params.angle,
        spacingFt,
        jitter,
        sample: makeWallSampler(relief, w, h),
        rng,
      });
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
