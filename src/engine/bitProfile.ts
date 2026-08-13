// Groove cross-section math for a single CNC pass — the same formulas the
// height-field renderer uses, exposed for the in-panel diagram.

import type { BitProfile } from './types';

/** Groove half-width at the surface, in inches. */
export function grooveHalfWidthIn(bitRadiusIn: number, depthIn: number, profile: BitProfile): number {
  if (profile === 'Flat-end') return bitRadiusIn;
  return depthIn <= bitRadiusIn
    ? Math.sqrt(2 * bitRadiusIn * depthIn - depthIn * depthIn)
    : bitRadiusIn;
}

/** Cut depth at horizontal offset `dIn` from the groove centerline, inches. */
export function grooveDepthAtIn(
  dIn: number,
  bitRadiusIn: number,
  depthIn: number,
  profile: BitProfile
): number {
  const a = Math.abs(dIn);
  if (a >= bitRadiusIn) return 0;
  if (profile === 'Flat-end') return depthIn;
  const depth = depthIn - bitRadiusIn + Math.sqrt(bitRadiusIn * bitRadiusIn - a * a);
  return depth > 0 ? depth : 0;
}

/**
 * Sampled cross-section polyline for the diagram: pairs of [xIn, depthIn]
 * spanning the full groove width, ready to scale into SVG space.
 */
export function grooveProfilePoints(
  bitRadiusIn: number,
  depthIn: number,
  profile: BitProfile,
  samples: number = 48
): [number, number][] {
  const hw = grooveHalfWidthIn(bitRadiusIn, depthIn, profile);
  const pts: [number, number][] = [];
  if (profile === 'Flat-end') {
    // Square channel: sharp walls
    pts.push([-hw, 0], [-hw, depthIn], [hw, depthIn], [hw, 0]);
    return pts;
  }
  for (let i = 0; i <= samples; i++) {
    const x = -hw + (2 * hw * i) / samples;
    pts.push([x, grooveDepthAtIn(x, bitRadiusIn, depthIn, profile)]);
  }
  return pts;
}
