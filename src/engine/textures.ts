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

/**
 * Burn panel seam lines into the height field (interior edges only,
 * deduplicated). 1/16" wide, fixed shallow depth — a discreet joint line.
 */
export function burnPanelSeams(
  heightmap: Float32Array,
  resW: number,
  resH: number,
  panels: Panel[],
  wallW: number,
  wallH: number,
  seamDepthFt: number
): void {
  const pxPerFtX = resW / wallW, pxPerFtY = resH / wallH;
  const halfWidthPx = Math.max(0.5, ((1 / 16 / 12) * pxPerFtX) / 2);

  const burnV = (xFt: number, y0Ft: number, y1Ft: number) => {
    const px = xFt * pxPerFtX;
    const x0 = Math.max(0, Math.round(px - halfWidthPx));
    const x1 = Math.min(resW - 1, Math.round(px + halfWidthPx));
    const r0 = Math.max(0, Math.round((wallH - y1Ft) * pxPerFtY));
    const r1 = Math.min(resH - 1, Math.round((wallH - y0Ft) * pxPerFtY));
    for (let ry = r0; ry <= r1; ry++)
      for (let rx = x0; rx <= x1; rx++) {
        const i = ry * resW + rx;
        if (heightmap[i] < seamDepthFt) heightmap[i] = seamDepthFt;
      }
  };
  const burnH = (yFt: number, x0Ft: number, x1Ft: number) => {
    const py = (wallH - yFt) * pxPerFtY;
    const r0 = Math.max(0, Math.round(py - halfWidthPx));
    const r1 = Math.min(resH - 1, Math.round(py + halfWidthPx));
    const x0 = Math.max(0, Math.round(x0Ft * pxPerFtX));
    const x1 = Math.min(resW - 1, Math.round(x1Ft * pxPerFtX));
    for (let ry = r0; ry <= r1; ry++)
      for (let rx = x0; rx <= x1; rx++) {
        const i = ry * resW + rx;
        if (heightmap[i] < seamDepthFt) heightmap[i] = seamDepthFt;
      }
  };

  const drawn = new Set<string>();
  for (const p of panels) {
    const x0 = p.gx * 2, y0 = p.gy * 2;
    const x1 = x0 + p.w, y1 = y0 + p.h;
    if (x0 > 0 && !drawn.has(`V${x0}:${y0}:${y1}`)) { drawn.add(`V${x0}:${y0}:${y1}`); burnV(x0, y0, y1); }
    if (x1 < wallW && !drawn.has(`V${x1}:${y0}:${y1}`)) { drawn.add(`V${x1}:${y0}:${y1}`); burnV(x1, y0, y1); }
    if (y0 > 0 && !drawn.has(`H${y0}:${x0}:${x1}`)) { drawn.add(`H${y0}:${x0}:${x1}`); burnH(y0, x0, x1); }
    if (y1 < wallH && !drawn.has(`H${y1}:${x0}:${x1}`)) { drawn.add(`H${y1}:${x0}:${x1}`); burnH(y1, x0, x1); }
  }
}

// ─── Normal map from the float height field (Sobel) ──────────────
// Computed from full-precision heights so smooth relief slopes shade
// cleanly — no 8-bit contour banding.
export function generateNormalMapFromField(
  heightmap: Float32Array,
  w: number,
  h: number,
  maxDepthFt: number,
  strength: number
): HTMLCanvasElement {
  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const ctx = normCanvas.getContext('2d')!;
  const imgData = ctx.createImageData(w, h);
  const out = imgData.data;
  const invD = 1 / maxDepthFt;

  function ht(x: number, y: number): number {
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    const norm = heightmap[y * w + x] * invD;
    return 1 - (norm > 1 ? 1 : norm); // 1 = surface, 0 = deepest
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
