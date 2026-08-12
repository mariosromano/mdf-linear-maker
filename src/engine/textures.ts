import type { BitProfile, Edge, Panel, ReliefField } from './types';
import { makeWallSampler } from './geometry';

// ─── Height field (distance-field groove carving) ────────────────
// Computes mathematically exact groove profiles per bit type.
// Ball-end: hemispherical cross-section  depth(d) = D - R + sqrt(R² - d²)
// Flat-end: rectangular channel           depth(d) = D for d < R, 0 otherwise
// where R = bit radius, D = per-line carve depth, d = perpendicular distance.
// Each edge carries its own depth factor (edge.d × maxDepthFt).
export function generateHeightField(
  edges: Edge[],
  wallW: number,
  wallH: number,
  bitRadiusFt: number,
  maxDepthFt: number,
  bitProfile: BitProfile,
  resW: number,
  resH: number
): Float32Array {
  const hw = wallW / 2, hh = wallH / 2;
  const pxPerFt = resW / wallW;

  const R = bitRadiusFt;
  const RR = R * R;
  const invPxPerFt = 1 / pxPerFt;

  // 0 = surface, positive = carve depth (ft)
  const heightmap = new Float32Array(resW * resH);
  const isBallEnd = bitProfile === 'Ball-end';

  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    const D = maxDepthFt * (e.d ?? 1);
    if (D <= 0) continue;

    // Groove half-width for THIS line's depth
    const grooveHW = isBallEnd && D <= R ? Math.sqrt(2 * R * D - D * D) : R;
    const ghwPx = grooveHW * pxPerFt + 2;
    const ghwPxSq = ghwPx * ghwPx;

    const epx0 = (e.x0 + hw) * pxPerFt;
    const epy0 = (hh - e.y0) * pxPerFt; // Y-flip for canvas
    const epx1 = (e.x1 + hw) * pxPerFt;
    const epy1 = (hh - e.y1) * pxPerFt;

    const edx = epx1 - epx0, edy = epy1 - epy0;
    const lenSq = edx * edx + edy * edy;
    const invLenSq = lenSq > 0.001 ? 1 / lenSq : 0;

    const bx0 = Math.max(0, (Math.min(epx0, epx1) - ghwPx) | 0);
    const bx1 = Math.min(resW - 1, Math.ceil(Math.max(epx0, epx1) + ghwPx));
    const by0 = Math.max(0, (Math.min(epy0, epy1) - ghwPx) | 0);
    const by1 = Math.min(resH - 1, Math.ceil(Math.max(epy0, epy1) + ghwPx));

    for (let py = by0; py <= by1; py++) {
      const rowOff = py * resW;
      const dpy = py - epy0;

      for (let px = bx0; px <= bx1; px++) {
        const dpx = px - epx0;
        let distSq: number;

        if (invLenSq === 0) {
          distSq = dpx * dpx + dpy * dpy;
        } else {
          let t = (dpx * edx + dpy * edy) * invLenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const cx = epx0 + t * edx - px;
          const cy = epy0 + t * edy - py;
          distSq = cx * cx + cy * cy;
        }

        if (distSq >= ghwPxSq) continue;

        const distFt = Math.sqrt(distSq) * invPxPerFt;
        let depth: number;

        if (isBallEnd) {
          if (distFt >= R) continue;
          depth = D - R + Math.sqrt(RR - distFt * distFt);
          if (depth <= 0) continue;
        } else {
          if (distFt >= R) continue;
          depth = D;
        }

        const idx = rowOff + px;
        if (depth > heightmap[idx]) heightmap[idx] = depth;
      }
    }
  }

  return heightmap;
}

// ─── Relief height field (Image Relief mode) ─────────────────────
// Continuous 2.5D carve: image depth factor × max depth at every pixel.
export function generateReliefHeightField(
  relief: ReliefField,
  wallW: number,
  wallH: number,
  maxDepthFt: number,
  resW: number,
  resH: number
): Float32Array {
  const heightmap = new Float32Array(resW * resH);
  const sample = makeWallSampler(relief, wallW, wallH);
  const hw = wallW / 2, hh = wallH / 2;
  const ftPerPxX = wallW / resW, ftPerPxY = wallH / resH;
  for (let py = 0; py < resH; py++) {
    const y = hh - (py + 0.5) * ftPerPxY;
    const rowOff = py * resW;
    for (let px = 0; px < resW; px++) {
      const x = -hw + (px + 0.5) * ftPerPxX;
      heightmap[rowOff + px] = sample(x, y) * maxDepthFt;
    }
  }
  return heightmap;
}

/** Element-wise max of two height fields (grooves ∪ relief). */
export function combineHeightFields(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] > b[i] ? a[i] : b[i];
  return out;
}

// ─── Height field → displacement canvas ──────────────────────────
// White (255) = surface, Black (0) = maximum carve depth.
export function heightFieldToCanvas(
  heightmap: Float32Array,
  resW: number,
  resH: number,
  maxDepthFt: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = resW;
  canvas.height = resH;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(resW, resH);
  const data = imgData.data;
  const invD = 1 / maxDepthFt;

  for (let i = 0, len = heightmap.length; i < len; i++) {
    const normalized = heightmap[i] * invD;
    const val = ((1 - (normalized > 1 ? 1 : normalized)) * 255 + 0.5) | 0;
    const off = i << 2;
    data[off] = val;
    data[off + 1] = val;
    data[off + 2] = val;
    data[off + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** Draw panel seam lines onto the displacement canvas (interior edges only, deduplicated). */
export function drawPanelSeams(
  dispCanvas: HTMLCanvasElement,
  panels: Panel[],
  wallW: number,
  wallH: number
): void {
  const resW = dispCanvas.width, resH = dispCanvas.height;
  const pxPerFt = resW / wallW;
  const ctx = dispCanvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, (1 / 16 / 12) * pxPerFt); // 1/16" joint line
  ctx.lineCap = 'butt';
  ctx.beginPath();
  const drawn = new Set<string>();
  for (const p of panels) {
    const x0 = p.gx * 2, y0 = p.gy * 2;
    const x1 = x0 + p.w, y1 = y0 + p.h;
    const px0 = x0 * (resW / wallW), px1 = x1 * (resW / wallW);
    const cy0 = (wallH - y1) * (resH / wallH), cy1 = (wallH - y0) * (resH / wallH);
    if (x0 > 0) {
      const k = `V${x0}:${y0}:${y1}`;
      if (!drawn.has(k)) { drawn.add(k); ctx.moveTo(px0, cy0); ctx.lineTo(px0, cy1); }
    }
    if (x1 < wallW) {
      const k = `V${x1}:${y0}:${y1}`;
      if (!drawn.has(k)) { drawn.add(k); ctx.moveTo(px1, cy0); ctx.lineTo(px1, cy1); }
    }
    if (y0 > 0) {
      const k = `H${y0}:${x0}:${x1}`;
      if (!drawn.has(k)) { drawn.add(k); ctx.moveTo(px0, cy1); ctx.lineTo(px1, cy1); }
    }
    if (y1 < wallH) {
      const k = `H${y1}:${x0}:${x1}`;
      if (!drawn.has(k)) { drawn.add(k); ctx.moveTo(px0, cy0); ctx.lineTo(px1, cy0); }
    }
  }
  ctx.stroke();
}

// ─── Normal map from displacement (Sobel) ────────────────────────
export function generateNormalMap(dispCanvas: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = dispCanvas.width, h = dispCanvas.height;
  const srcCtx = dispCanvas.getContext('2d')!;
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const ctx = normCanvas.getContext('2d')!;
  const imgData = ctx.createImageData(w, h);
  const out = imgData.data;

  function ht(x: number, y: number): number {
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    return srcData[(y * w + x) * 4] / 255;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = ht(x - 1, y - 1), tc = ht(x, y - 1), tr = ht(x + 1, y - 1);
      const ml = ht(x - 1, y), mr = ht(x + 1, y);
      const bl = ht(x - 1, y + 1), bc = ht(x, y + 1), br = ht(x + 1, y + 1);

      const dx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const dy = bl + 2 * bc + br - (tl + 2 * tc + tr);

      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;

      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return normCanvas;
}
