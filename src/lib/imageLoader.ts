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

/** Load an uploaded file into a downscaled luminance image. */
export function fileToSourceImage(file: File): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvasToSourceImage(canvas));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}

/** Built-in demo image — soft "M|R" lettering so image modes aren't blank. */
export function defaultSourceImage(): SourceImage {
  const w = 900, h = 600;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // Soft radial backdrop so the relief has gentle large-scale form
  const grad = ctx.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, w * 0.65);
  grad.addColorStop(0, '#e8e8e8');
  grad.addColorStop(1, '#ffffff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#141414';
  ctx.font = '700 300px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M|R', w / 2, h / 2 + 10);
  return canvasToSourceImage(canvas);
}
