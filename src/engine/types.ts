export type PatternType =
  | 'Parallel'
  | 'Crosshatch'
  | 'Chevron'
  | 'Waves'
  | 'Fan'
  | 'Image Lines'
  | 'Image Relief';
export type DepthMode = 'Uniform' | 'Alternating' | 'Gradient' | 'Random';
export type BitSize = '1/4"' | '1/2"';
export type BitProfile = 'Ball-end' | 'Flat-end';
export type CarveDepth = '1/8"' | '1/4"' | '3/8"';
export type LightingPreset = 'studio' | 'gallery' | 'raking';

export interface LinearParams {
  wallWidth: number;    // feet, 2ft increments
  wallHeight: number;   // feet, 2ft increments
  pattern: PatternType;
  angle: number;        // degrees, primary line direction (Parallel/Crosshatch)
  crossAngle: number;   // degrees between families (Crosshatch)
  spacing: number;      // inches between lines
  jitter: number;       // 0..1 random offset of each line as fraction of spacing
  waveAmplitude: number; // inches (Chevron/Waves)
  wavePeriod: number;    // inches (Chevron/Waves)
  depthMode: DepthMode;
  imageInvert: boolean;  // false: dark areas carve deepest; true: light areas
  imageSmooth: number;   // 0..10 blur radius (source pixels) before depth mapping
  imageGamma: number;    // 0.4..2.5 depth curve — <1 broadens carving, >1 focuses on darkest areas
  bitSize: BitSize;
  bitProfile: BitProfile;
  carveDepth: CarveDepth; // maximum carve depth — depthMode scales per line
  material: string;
  seed: number;
}

/** One physical panel in the wall tiling. gx/gy are 2-ft grid coords; w/h in feet. */
export interface Panel {
  gx: number;
  gy: number;
  w: number;
  h: number;
}

/**
 * A carved segment in wall space (feet, centered at origin).
 * `d` is the depth factor 0..1 — multiplied by the max carve depth.
 */
export interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  d: number;
}

export interface MaterialDef {
  color: string;
  roughness: number;
  metalness: number;
}

// Calibrated for ACES tone mapping at exposure 1.0.
export const MATERIALS: Record<string, MaterialDef> = {
  // Board / wood
  MDF:            { color: '#c9ab7f', roughness: 0.8,  metalness: 0.0 },
  Maple:          { color: '#e3cfa9', roughness: 0.6,  metalness: 0.0 },
  'White Oak':    { color: '#cdb391', roughness: 0.55, metalness: 0.0 },
  Walnut:         { color: '#6b4a2e', roughness: 0.55, metalness: 0.0 },
  // Painted
  White:          { color: '#f2f0eb', roughness: 0.4,  metalness: 0.0 },
  'Warm Gray':    { color: '#a49a8c', roughness: 0.42, metalness: 0.0 },
  Sage:           { color: '#8a9a7b', roughness: 0.42, metalness: 0.0 },
  Terracotta:     { color: '#c4674a', roughness: 0.45, metalness: 0.0 },
  Navy:           { color: '#24344f', roughness: 0.4,  metalness: 0.0 },
  Charcoal:       { color: '#3c3c3c', roughness: 0.42, metalness: 0.0 },
  Black:          { color: '#232323', roughness: 0.45, metalness: 0.0 },
  // Industrial
  'Raw Aluminum': { color: '#b8bcc2', roughness: 0.3,  metalness: 0.9 },
};

export const PATTERNS: PatternType[] = [
  'Parallel',
  'Crosshatch',
  'Chevron',
  'Waves',
  'Fan',
  'Image Lines',
  'Image Relief',
];

/** Uploaded (or default) source image as luminance 0..1, row-major. */
export interface SourceImage {
  lum: Float32Array;
  w: number;
  h: number;
}

/** Processed relief: per-pixel depth factor 0..1 (1 = full carve depth). */
export interface ReliefField {
  data: Float32Array;
  w: number;
  h: number;
}

/** Depth quantization steps for Image Lines (bounds DXF layer count). */
export const IMAGE_DEPTH_LEVELS = 12;
export const DEPTH_MODES: DepthMode[] = ['Uniform', 'Alternating', 'Gradient', 'Random'];
export const BIT_SIZES: BitSize[] = ['1/4"', '1/2"'];
export const BIT_PROFILES: BitProfile[] = ['Ball-end', 'Flat-end'];
export const CARVE_DEPTHS: CarveDepth[] = ['1/8"', '1/4"', '3/8"'];

export const CARVE_DEPTH_IN: Record<CarveDepth, number> = { '1/8"': 0.125, '1/4"': 0.25, '3/8"': 0.375 };
export const BIT_SIZE_IN: Record<BitSize, number> = { '1/4"': 0.25, '1/2"': 0.5 };

/** Shallowest line as a fraction of max depth when depthMode varies depth. */
export const MIN_DEPTH_FACTOR = 0.35;

/** Panel slab thickness in inches — used for the STL solid and 3D backing. */
export const PANEL_THICKNESS_IN = 0.75;

export const DEFAULT_PARAMS: LinearParams = {
  wallWidth: 12,
  wallHeight: 8,
  pattern: 'Crosshatch',
  angle: 45,
  crossAngle: 90,
  spacing: 4,
  jitter: 0,
  waveAmplitude: 3,
  wavePeriod: 16,
  depthMode: 'Alternating',
  imageInvert: false,
  imageSmooth: 2,
  imageGamma: 1.0,
  bitSize: '1/2"',
  bitProfile: 'Ball-end',
  carveDepth: '1/4"',
  material: 'MDF',
  seed: 42,
};
