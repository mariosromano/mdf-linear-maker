// MakeReal platform bridge — implements the Maker Contract v1.
// 1. ?settings={...}  → prefill params
// 2. postMessage design/render events to the parent frame
// 3. ?embedded=1      → hide dollar figures (platform owns pricing)
// 4. ?theme=makereal  → house theme (ivory + terracotta), no brand header

import type { LinearParams } from '../engine/types';
import {
  DEFAULT_PARAMS,
  MATERIALS,
  PATTERNS,
  DEPTH_MODES,
  BIT_SIZES,
  BIT_PROFILES,
  CARVE_DEPTHS,
} from '../engine/types';

export interface BridgeFlags {
  embedded: boolean;
  makerealTheme: boolean;
}

export function readBridgeFlags(): BridgeFlags {
  const q = new URLSearchParams(window.location.search);
  return {
    embedded: q.get('embedded') === '1',
    makerealTheme: q.get('theme') === 'makereal',
  };
}

function even(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n / 2) * 2));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Merge ?settings= JSON into defaults. Unknown keys ignored; values clamped. */
export function readInitialParams(): LinearParams {
  const params = { ...DEFAULT_PARAMS };
  try {
    const raw = new URLSearchParams(window.location.search).get('settings');
    if (!raw) return params;
    const s = JSON.parse(raw) as Record<string, unknown>;
    if (typeof s.widthFt === 'number') params.wallWidth = even(s.widthFt, 4, 30);
    if (typeof s.heightFt === 'number') params.wallHeight = even(s.heightFt, 4, 24);
    if (typeof s.pattern === 'string' && (PATTERNS as string[]).includes(s.pattern)) {
      params.pattern = s.pattern as LinearParams['pattern'];
    }
    if (typeof s.angle === 'number') params.angle = clamp(s.angle, 0, 180);
    if (typeof s.crossAngle === 'number') params.crossAngle = clamp(s.crossAngle, 15, 165);
    if (typeof s.spacing === 'number') params.spacing = clamp(s.spacing, 1, 24);
    if (typeof s.jitter === 'number') params.jitter = clamp(s.jitter, 0, 1);
    if (typeof s.waveAmplitude === 'number') params.waveAmplitude = clamp(s.waveAmplitude, 0.5, 12);
    if (typeof s.wavePeriod === 'number') params.wavePeriod = clamp(s.wavePeriod, 4, 48);
    if (typeof s.seed === 'number') params.seed = Math.floor(s.seed);
    if (typeof s.depthMode === 'string' && (DEPTH_MODES as string[]).includes(s.depthMode)) {
      params.depthMode = s.depthMode as LinearParams['depthMode'];
    }
    if (typeof s.bitSize === 'string' && (BIT_SIZES as string[]).includes(s.bitSize)) {
      params.bitSize = s.bitSize as LinearParams['bitSize'];
    }
    if (typeof s.bitProfile === 'string' && (BIT_PROFILES as string[]).includes(s.bitProfile)) {
      params.bitProfile = s.bitProfile as LinearParams['bitProfile'];
    }
    if (typeof s.carveDepth === 'string' && (CARVE_DEPTHS as string[]).includes(s.carveDepth)) {
      params.carveDepth = s.carveDepth as LinearParams['carveDepth'];
    }
    if (typeof s.material === 'string' && MATERIALS[s.material]) params.material = s.material;
  } catch {
    // Malformed settings param — fall back to defaults
  }
  return params;
}

function post(message: Record<string, unknown>): void {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*');
  }
}

let designTimer: ReturnType<typeof setTimeout> | null = null;

/** Report a design change to the platform (debounced). */
export function reportDesign(params: LinearParams): void {
  if (designTimer) clearTimeout(designTimer);
  designTimer = setTimeout(() => {
    post({
      type: 'makereal:design',
      widthFt: params.wallWidth,
      heightFt: params.wallHeight,
      params,
    });
  }, 400);
}

/** Report a completed AI render to the platform. */
export function reportRender(): void {
  post({ type: 'makereal:render' });
}
