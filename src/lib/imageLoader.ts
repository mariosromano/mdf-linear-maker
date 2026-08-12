import type { SourceImage } from '../engine/types';

const MAX_DIM = 1024;

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

function imageElementToSourceImage(img: HTMLImageElement): SourceImage {
  let cw = img.width, ch = img.height;
  let source: CanvasImageSource = img;
  // Step-halve until within 2x of target so large photos keep detail
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
  return canvasToSourceImage(canvas);
}

/** Load an uploaded file into a downscaled luminance image. */
export function fileToSourceImage(file: File): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(imageElementToSourceImage(img));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}

/** Load a same-origin image URL (library presets) into a luminance image. */
export function urlToSourceImage(url: string): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(imageElementToSourceImage(img));
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

// ─── Built-in image library ──────────────────────────────────────
// Curated artwork shared with the Textured Panel Maker — real grayscale
// images proven to drive carved surfaces well. Files live in
// public/preset-images (full ~1024px JPEG + small thumbnails).

export interface ImagePreset {
  id: string;
  name: string;
  full: string;
  thumb: string;
}

function preset(id: string, name: string): ImagePreset {
  return {
    id,
    name,
    full: `/preset-images/${id}.jpg`,
    thumb: `/preset-images/thumbs/${id}-tn.jpg`,
  };
}

export const IMAGE_PRESETS: ImagePreset[] = [
  preset('topography', 'Topography'),
  preset('mountain_ridges', 'Mountain Ridges'),
  preset('desert_dunes', 'Desert Dunes'),
  preset('ocean_ripples', 'Ocean Ripples'),
  preset('silk_waves', 'Silk Waves'),
  preset('underwater', 'Underwater'),
  preset('chevron_flow', 'Chevron Flow'),
  preset('cellular', 'Cellular'),
  preset('woodgrain', 'Woodgrain'),
  preset('woodgrain2', 'Woodgrain 2'),
  preset('oak_tree', 'Oak Tree'),
  preset('fern', 'Fern'),
  preset('lotus', 'Lotus Bloom'),
  preset('dolphin', 'Dolphin'),
  preset('radiating_starburst_light_rays', 'Starburst'),
  preset('guadalupe_face_dotted_pattern', 'Guadalupe Dotted'),
];

export function presetToSourceImage(id: string): Promise<SourceImage> {
  const p = IMAGE_PRESETS.find((x) => x.id === id);
  if (!p) return Promise.reject(new Error(`Unknown preset: ${id}`));
  return urlToSourceImage(p.full);
}
