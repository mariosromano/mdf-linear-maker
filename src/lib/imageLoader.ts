import type { SourceImage } from '../engine/types';

const MAX_DIM = 1024;
const PRESET_SIZE = 512;

function canvasToSourceImage(canvas: HTMLCanvasElement): SourceImage {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    // Rec. 709 luma, alpha-composited over white
    const a = data[off + 3] / 255;
    const r = data[off] * a + 255 * (1 - a);
    const g = data[off + 1] * a + 255 * (1 - a);
    const b = data[off + 2] * a + 255 * (1 - a);
    lum[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return { lum, w, h };
}

/**
 * Load an uploaded file into a downscaled luminance image.
 * Downscales in halving steps so large photos keep detail instead of aliasing.
 */
export function fileToSourceImage(file: File): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let cw = img.width, ch = img.height;
      let source: CanvasImageSource = img;
      // Step-halve until within 2× of target, then final resize
      while (Math.max(cw, ch) > MAX_DIM * 2) {
        const half = document.createElement('canvas');
        half.width = Math.max(1, Math.round(cw / 2));
        half.height = Math.max(1, Math.round(ch / 2));
        half.getContext('2d')!.drawImage(source, 0, 0, half.width, half.height);
        source = half;
        cw = half.width;
        ch = half.height;
      }
      const scale = Math.min(1, MAX_DIM / Math.max(cw, ch));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(cw * scale));
      canvas.height = Math.max(1, Math.round(ch * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      resolve(canvasToSourceImage(canvas));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}

// ─── Built-in image library ──────────────────────────────────────
// Procedural grayscale designs chosen to carve well: smooth gradients,
// bold shapes, no fine noise. Dark = deep under the default polarity.

type FieldFn = (x: number, y: number) => number; // unit coords → luminance 0..1

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise with fBm — the backbone of the organic presets. */
function makeNoise(seed: number, cells: number): FieldFn {
  const rng = mulberry32(seed);
  const g = cells + 1;
  const grid = new Float32Array(g * g);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const fx = Math.min(0.9999, Math.max(0, x)) * cells;
    const fy = Math.min(0.9999, Math.max(0, y)) * cells;
    const x0 = fx | 0, y0 = fy | 0;
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const a = grid[y0 * g + x0], b = grid[y0 * g + x0 + 1];
    const c = grid[(y0 + 1) * g + x0], d = grid[(y0 + 1) * g + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

function fbm(seed: number, octaves: number, baseCells: number): FieldFn {
  const layers: { fn: FieldFn; amp: number }[] = [];
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ fn: makeNoise(seed + o * 101, baseCells << o), amp });
    total += amp;
    amp *= 0.5;
  }
  return (x, y) => {
    let v = 0;
    for (const l of layers) v += l.fn(x, y) * l.amp;
    return v / total;
  };
}

export interface ImagePreset {
  id: string;
  name: string;
  field: FieldFn;
}

const topo = fbm(7, 4, 3);
const boulders = fbm(23, 2, 4);

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: 'topography',
    name: 'Topography',
    // Rolling terrain — the classic CNC relief demo
    field: (x, y) => 0.15 + 0.75 * topo(x, y),
  },
  {
    id: 'ripples',
    name: 'Ripples',
    field: (x, y) => {
      const dx = x - 0.5, dy = y - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      const wave = 0.5 + 0.5 * Math.cos(r * 46);
      const fade = Math.exp(-r * 2.2);
      return 1 - wave * fade * 0.9;
    },
  },
  {
    id: 'dunes',
    name: 'Dunes',
    field: (x, y) => {
      const t = (x * 0.8 + y * 0.6) * 22;
      const ridge = 1 - Math.abs(Math.sin(t)); // sharp crests, soft troughs
      const drift = 0.15 * Math.sin(y * 9 + x * 3);
      return 0.12 + 0.75 * (1 - ridge) + drift * ridge;
    },
  },
  {
    id: 'orb',
    name: 'Orb',
    field: (x, y) => {
      const dx = (x - 0.5) / 0.38, dy = (y - 0.5) / 0.38;
      const rr = dx * dx + dy * dy;
      if (rr >= 1) return 0.97;
      return 0.97 - 0.85 * Math.sqrt(1 - rr); // spherical dome
    },
  },
  {
    id: 'flow',
    name: 'Flow',
    field: (x, y) => {
      const v = Math.sin(x * 14 + 2.2 * Math.sin(y * 5.5)) * Math.cos(y * 4 + 1.4 * Math.sin(x * 4.4));
      return 0.5 + 0.42 * v;
    },
  },
  {
    id: 'boulders',
    name: 'Boulders',
    field: (x, y) => {
      const v = boulders(x, y);
      const stepped = Math.round(v * 5) / 5; // terraced contours
      return 0.15 + 0.7 * (0.35 * v + 0.65 * stepped);
    },
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    field: (x, y) => {
      const dx = x - 0.5, dy = y - 0.5;
      const theta = Math.atan2(dy, dx);
      const r = Math.sqrt(dx * dx + dy * dy);
      const rays = 0.5 + 0.5 * Math.sin(theta * 18);
      const fade = Math.min(1, r * 2.6);
      return 1 - rays * fade * 0.8 - (1 - fade) * 0.55;
    },
  },
  {
    id: 'lattice',
    name: 'Lattice',
    field: (x, y) => {
      const tri = (t: number) => Math.abs(((t % 1) + 1) % 1 - 0.5) * 2;
      const a = tri(x * 4 + y * 4);
      const b = tri(x * 4 - y * 4);
      return 0.15 + 0.75 * Math.min(a, b);
    },
  },
];

function renderField(field: FieldFn, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let v = field((px + 0.5) / size, (py + 0.5) / size);
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      const val = (v * 255 + 0.5) | 0;
      const off = (py * size + px) * 4;
      d[off] = val;
      d[off + 1] = val;
      d[off + 2] = val;
      d[off + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function presetToSourceImage(id: string): SourceImage | null {
  const preset = IMAGE_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  return canvasToSourceImage(renderField(preset.field, PRESET_SIZE));
}

/** Small dataURL thumbnails for the library grid (computed once, cached). */
let thumbCache: Record<string, string> | null = null;
export function presetThumbnails(): Record<string, string> {
  if (thumbCache) return thumbCache;
  thumbCache = {};
  for (const p of IMAGE_PRESETS) {
    thumbCache[p.id] = renderField(p.field, 96).toDataURL('image/png');
  }
  return thumbCache;
}
