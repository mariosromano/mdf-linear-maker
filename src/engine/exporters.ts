import type { BitProfile, Edge, Panel, ReliefField } from './types';
import { PANEL_THICKNESS_IN } from './types';
import { combineHeightFields, generateHeightField, generateReliefHeightField } from './textures';

// ─── DXF Export (2D cut file — drives the CNC) ───────────────────
// Pattern lines are grouped by carve depth: one layer per depth
// (e.g. CUT_D0250 = carve 0.250" deep), so multi-depth toolpaths can
// be assigned per layer in CAM.
export function buildDXF(
  edges: Edge[],
  panels: Panel[],
  wallW: number,
  wallH: number,
  maxDepthIn: number,
  bitRadiusIn: number = 0.25
): string {
  const hw = wallW / 2, hh = wallH / 2;

  // Convert feet (centered at origin) → inches (origin at bottom-left)
  function toInches(x: number, y: number): [string, string] {
    return [((x + hw) * 12).toFixed(4), ((y + hh) * 12).toFixed(4)];
  }

  const wIn = (wallW * 12).toFixed(4);
  const hIn = (wallH * 12).toFixed(4);

  // Group pattern edges by their actual carve depth in inches
  const byDepth = new Map<string, Edge[]>();
  for (const e of edges) {
    const depthIn = maxDepthIn * (e.d ?? 1);
    const layer = `CUT_D${String(Math.round(depthIn * 1000)).padStart(4, '0')}`;
    if (!byDepth.has(layer)) byDepth.set(layer, []);
    byDepth.get(layer)!.push(e);
  }
  const depthLayers = [...byDepth.keys()].sort();

  let dxf = '';
  dxf += '0\nSECTION\n2\nHEADER\n';
  dxf += '9\n$ACADVER\n1\nAC1009\n';
  dxf += '9\n$INSUNITS\n70\n1\n'; // inches
  dxf += '0\nENDSEC\n';

  dxf += '0\nSECTION\n2\nTABLES\n';
  dxf += `0\nTABLE\n2\nLAYER\n70\n${depthLayers.length + 2}\n`;
  depthLayers.forEach((layer, i) => {
    dxf += `0\nLAYER\n2\n${layer}\n70\n0\n62\n${(i % 7) + 1}\n6\nCONTINUOUS\n`;
  });
  dxf += '0\nLAYER\n2\nPANELS\n70\n0\n62\n8\n6\nCONTINUOUS\n';
  dxf += '0\nLAYER\n2\nBOUNDARY\n70\n0\n62\n3\n6\nCONTINUOUS\n';
  dxf += '0\nENDTAB\n';
  dxf += '0\nENDSEC\n';

  dxf += '0\nSECTION\n2\nENTITIES\n';

  for (const [layer, group] of byDepth) {
    for (const e of group) {
      const [ix0, iy0] = toInches(e.x0, e.y0);
      if (e.x0 === e.x1 && e.y0 === e.y1) {
        // Dimple — a CIRCLE at bit radius so CAM can treat it as a drill op
        dxf += `0\nCIRCLE\n8\n${layer}\n10\n${ix0}\n20\n${iy0}\n30\n0.0\n40\n${bitRadiusIn.toFixed(4)}\n`;
      } else {
        const [ix1, iy1] = toInches(e.x1, e.y1);
        dxf += `0\nLINE\n8\n${layer}\n10\n${ix0}\n20\n${iy0}\n30\n0.0\n11\n${ix1}\n21\n${iy1}\n31\n0.0\n`;
      }
    }
  }

  for (const p of panels) {
    const x0In = (p.gx * 2 * 12).toFixed(4);
    const y0In = (p.gy * 2 * 12).toFixed(4);
    const x1In = ((p.gx * 2 + p.w) * 12).toFixed(4);
    const y1In = ((p.gy * 2 + p.h) * 12).toFixed(4);
    dxf += `0\nLINE\n8\nPANELS\n10\n${x0In}\n20\n${y0In}\n30\n0.0\n11\n${x1In}\n21\n${y0In}\n31\n0.0\n`;
    dxf += `0\nLINE\n8\nPANELS\n10\n${x1In}\n20\n${y0In}\n30\n0.0\n11\n${x1In}\n21\n${y1In}\n31\n0.0\n`;
    dxf += `0\nLINE\n8\nPANELS\n10\n${x1In}\n20\n${y1In}\n30\n0.0\n11\n${x0In}\n21\n${y1In}\n31\n0.0\n`;
    dxf += `0\nLINE\n8\nPANELS\n10\n${x0In}\n20\n${y1In}\n30\n0.0\n11\n${x0In}\n21\n${y0In}\n31\n0.0\n`;
  }

  dxf += `0\nLINE\n8\nBOUNDARY\n10\n0.0\n20\n0.0\n30\n0.0\n11\n${wIn}\n21\n0.0\n31\n0.0\n`;
  dxf += `0\nLINE\n8\nBOUNDARY\n10\n${wIn}\n20\n0.0\n30\n0.0\n11\n${wIn}\n21\n${hIn}\n31\n0.0\n`;
  dxf += `0\nLINE\n8\nBOUNDARY\n10\n${wIn}\n20\n${hIn}\n30\n0.0\n11\n0.0\n21\n${hIn}\n31\n0.0\n`;
  dxf += `0\nLINE\n8\nBOUNDARY\n10\n0.0\n20\n${hIn}\n30\n0.0\n11\n0.0\n21\n0.0\n31\n0.0\n`;

  dxf += '0\nENDSEC\n0\nEOF\n';
  return dxf;
}

// ─── Binary STL Export (3D solid of the carved wall) ─────────────
// Watertight solid: carved front surface, flat back, perimeter sides.
// Units: inches, origin at bottom-left-back corner of the wall.
// Fidelity note: the STL is a visualization/print model; the DXF is
// the dimensionally exact cut file.

const MAX_STL_TRIANGLES = 1_000_000; // ≈ 50 MB binary STL

export function buildSTL(
  edges: Edge[],
  wallW: number,
  wallH: number,
  bitRadiusFt: number,
  maxDepthFt: number,
  bitProfile: BitProfile,
  relief: ReliefField | null = null
): ArrayBuffer {
  // Sample density: budget-limited so front tris ≤ ~half the cap
  const budgetCells = MAX_STL_TRIANGLES / 2 / 2; // front quads
  let samplesPerFt = Math.sqrt(budgetCells / (wallW * wallH));
  samplesPerFt = Math.max(24, Math.min(160, samplesPerFt));

  const nx = Math.max(2, Math.round(wallW * samplesPerFt) + 1);
  const ny = Math.max(2, Math.round(wallH * samplesPerFt) + 1);

  // Height field at grid resolution (row 0 = top of wall, canvas convention)
  let hf = generateHeightField(edges, wallW, wallH, bitRadiusFt, maxDepthFt, bitProfile, nx, ny);
  if (relief) {
    const rf = generateReliefHeightField(relief, wallW, wallH, maxDepthFt, nx, ny);
    hf = edges.length > 0 ? combineHeightFields(hf, rf) : rf;
  }

  const T = PANEL_THICKNESS_IN; // slab thickness, inches
  const wIn = wallW * 12, hIn = wallH * 12;
  const dx = wIn / (nx - 1), dy = hIn / (ny - 1);

  // Front z per grid vertex, indexed with iy counting UP from wall bottom
  const zf = new Float32Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) {
    const imgRow = ny - 1 - iy; // flip: heightfield row 0 is the top
    for (let ix = 0; ix < nx; ix++) {
      zf[iy * nx + ix] = T - hf[imgRow * nx + ix] * 12; // ft → in
    }
  }

  const frontTris = 2 * (nx - 1) * (ny - 1);
  const sideTris = 4 * ((nx - 1) + (ny - 1));
  const backTris = 2 * (nx - 1 + ny - 1); // perimeter fan
  const totalTris = frontTris + sideTris + backTris;

  const buffer = new ArrayBuffer(84 + totalTris * 50);
  const view = new DataView(buffer);
  const headerText = 'M|R Walls MDF Linear Maker — units: inches';
  for (let i = 0; i < Math.min(80, headerText.length); i++) {
    view.setUint8(i, headerText.charCodeAt(i));
  }
  view.setUint32(80, totalTris, true);

  let off = 84;
  let written = 0;

  // Emits one triangle; flips winding if its normal disagrees with the outward hint.
  function tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number
  ): void {
    let ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nnx = uy * vz - uz * vy;
    let nny = uz * vx - ux * vz;
    let nnz = ux * vy - uy * vx;
    if (nnx * hx + nny * hy + nnz * hz < 0) {
      // swap b and c
      let t = bx; bx = cx; cx = t;
      t = by; by = cy; cy = t;
      t = bz; bz = cz; cz = t;
      nnx = -nnx; nny = -nny; nnz = -nnz;
    }
    const len = Math.sqrt(nnx * nnx + nny * nny + nnz * nnz) || 1;
    view.setFloat32(off, nnx / len, true);
    view.setFloat32(off + 4, nny / len, true);
    view.setFloat32(off + 8, nnz / len, true);
    view.setFloat32(off + 12, ax, true);
    view.setFloat32(off + 16, ay, true);
    view.setFloat32(off + 20, az, true);
    view.setFloat32(off + 24, bx, true);
    view.setFloat32(off + 28, by, true);
    view.setFloat32(off + 32, bz, true);
    view.setFloat32(off + 36, cx, true);
    view.setFloat32(off + 40, cy, true);
    view.setFloat32(off + 44, cz, true);
    view.setUint16(off + 48, 0, true);
    off += 50;
    written++;
  }

  // Front surface (+z)
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const x0 = ix * dx, x1 = (ix + 1) * dx;
      const y0 = iy * dy, y1 = (iy + 1) * dy;
      const zA = zf[iy * nx + ix];
      const zB = zf[iy * nx + ix + 1];
      const zC = zf[(iy + 1) * nx + ix];
      const zD = zf[(iy + 1) * nx + ix + 1];
      tri(x0, y0, zA, x1, y0, zB, x1, y1, zD, 0, 0, 1);
      tri(x0, y0, zA, x1, y1, zD, x0, y1, zC, 0, 0, 1);
    }
  }

  // Sides — each boundary segment connects front rim to back plane (z=0)
  // Bottom (y=0, outward -y)
  for (let ix = 0; ix < nx - 1; ix++) {
    const x0 = ix * dx, x1 = (ix + 1) * dx;
    const z0 = zf[ix], z1 = zf[ix + 1];
    tri(x0, 0, z0, x1, 0, z1, x1, 0, 0, 0, -1, 0);
    tri(x0, 0, z0, x1, 0, 0, x0, 0, 0, 0, -1, 0);
  }
  // Top (y=hIn, outward +y)
  for (let ix = 0; ix < nx - 1; ix++) {
    const x0 = ix * dx, x1 = (ix + 1) * dx;
    const z0 = zf[(ny - 1) * nx + ix], z1 = zf[(ny - 1) * nx + ix + 1];
    tri(x0, hIn, z0, x1, hIn, z1, x1, hIn, 0, 0, 1, 0);
    tri(x0, hIn, z0, x1, hIn, 0, x0, hIn, 0, 0, 1, 0);
  }
  // Left (x=0, outward -x)
  for (let iy = 0; iy < ny - 1; iy++) {
    const y0 = iy * dy, y1 = (iy + 1) * dy;
    const z0 = zf[iy * nx], z1 = zf[(iy + 1) * nx];
    tri(0, y0, z0, 0, y1, z1, 0, y1, 0, -1, 0, 0);
    tri(0, y0, z0, 0, y1, 0, 0, y0, 0, -1, 0, 0);
  }
  // Right (x=wIn, outward +x)
  for (let iy = 0; iy < ny - 1; iy++) {
    const y0 = iy * dy, y1 = (iy + 1) * dy;
    const z0 = zf[iy * nx + nx - 1], z1 = zf[(iy + 1) * nx + nx - 1];
    tri(wIn, y0, z0, wIn, y1, z1, wIn, y1, 0, 1, 0, 0);
    tri(wIn, y0, z0, wIn, y1, 0, wIn, y0, 0, 1, 0, 0);
  }

  // Back (z=0, outward -z) — fan from center to perimeter so side vertices stitch
  const cx = wIn / 2, cy = hIn / 2;
  // Perimeter walk (CCW viewed from front): bottom L→R, right B→T, top R→L, left T→B
  const perim: [number, number][] = [];
  for (let ix = 0; ix < nx - 1; ix++) perim.push([ix * dx, 0]);
  for (let iy = 0; iy < ny - 1; iy++) perim.push([wIn, iy * dy]);
  for (let ix = nx - 1; ix > 0; ix--) perim.push([ix * dx, hIn]);
  for (let iy = ny - 1; iy > 0; iy--) perim.push([0, iy * dy]);
  for (let i = 0; i < perim.length; i++) {
    const [px0, py0] = perim[i];
    const [px1, py1] = perim[(i + 1) % perim.length];
    tri(cx, cy, 0, px1, py1, 0, px0, py0, 0, 0, 0, -1);
  }

  if (written !== totalTris) {
    // Keep header honest if counts ever drift
    view.setUint32(80, written, true);
    return buffer.slice(0, 84 + written * 50);
  }
  return buffer;
}

// ─── Download helpers ─────────────────────────────────────────────
export function downloadBlob(data: BlobPart, filename: string, type: string): void {
  const blob = new Blob([data], { type });
  const link = document.createElement('a');
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}
