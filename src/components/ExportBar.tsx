import { useCallback, useState } from 'react';
import * as THREE from 'three';
import type { LinearParams } from '../engine/types';
import { BIT_SIZE_IN, CARVE_DEPTH_IN } from '../engine/types';
import type { LinearPattern } from '../engine/geometry';
import { buildDXF, buildSTL, downloadBlob } from '../engine/exporters';

interface ExportBarProps {
  params: LinearParams;
  pattern: LinearPattern;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  onOpenRender: () => void;
}

export default function ExportBar({
  params,
  pattern,
  rendererRef,
  sceneRef,
  cameraRef,
  onOpenRender,
}: ExportBarProps) {
  const [stlBusy, setStlBusy] = useState(false);

  const handleExportPNG = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.download = 'mr-linear-wall.png';
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
  }, [rendererRef, sceneRef, cameraRef]);

  const handleExportDXF = useCallback(() => {
    if (pattern.edges.length === 0) return;
    const dxf = buildDXF(
      pattern.edges,
      pattern.panels,
      pattern.wallW,
      pattern.wallH,
      CARVE_DEPTH_IN[params.carveDepth]
    );
    downloadBlob(dxf, 'mr-linear-wall.dxf', 'application/dxf');
  }, [pattern, params.carveDepth]);

  const handleExportSTL = useCallback(() => {
    if (pattern.edges.length === 0 || stlBusy) return;
    setStlBusy(true);
    // Yield a frame so the busy state paints before the heavy mesh build
    setTimeout(() => {
      try {
        const bitRadiusFt = BIT_SIZE_IN[params.bitSize] / 12 / 2;
        const carveDepthFt = CARVE_DEPTH_IN[params.carveDepth] / 12;
        const stl = buildSTL(
          pattern.edges,
          pattern.wallW,
          pattern.wallH,
          bitRadiusFt,
          carveDepthFt,
          params.bitProfile
        );
        downloadBlob(stl, 'mr-linear-wall.stl', 'model/stl');
      } finally {
        setStlBusy(false);
      }
    }, 30);
  }, [pattern, params.bitSize, params.carveDepth, params.bitProfile, stlBusy]);

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 mb-2.5">
      <div className="text-[10.5px] font-semibold text-[var(--ink-muted)] uppercase tracking-[0.14em] mb-3">
        Export
      </div>
      <div className="space-y-1.5">
        <button
          onClick={onOpenRender}
          className="w-full py-2.5 rounded-lg text-[12px] font-semibold text-[#1a1a14] bg-gradient-to-br from-[var(--gold-bright)] to-[var(--gold)] shadow-[0_2px_14px_rgba(201,169,106,0.28)] hover:brightness-105 transition-all"
        >
          ✦ AI Render
        </button>
        <button
          onClick={handleExportPNG}
          className="w-full py-2.5 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface-4)] border border-[var(--line-strong)] text-[var(--ink-soft)] hover:text-[var(--ink)] text-[12px] font-medium transition-colors"
        >
          Download Image (PNG)
        </button>
        <button
          onClick={handleExportDXF}
          className="w-full py-2.5 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface-4)] border border-[var(--line-strong)] text-[var(--ink-soft)] hover:text-[var(--ink)] text-[12px] font-medium transition-colors"
        >
          Cut File (DXF)
        </button>
        <button
          onClick={handleExportSTL}
          disabled={stlBusy}
          className="w-full py-2.5 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface-4)] border border-[var(--line-strong)] text-[var(--ink-soft)] hover:text-[var(--ink)] text-[12px] font-medium transition-colors disabled:opacity-60"
        >
          {stlBusy ? 'Building 3D model…' : '3D Model (STL)'}
        </button>
      </div>
      <p className="text-[10px] text-[var(--ink-faint)] mt-2.5 leading-relaxed">
        DXF is the exact cut file with one layer per carve depth. STL is a
        watertight 3D solid for visualization and printing.
      </p>
    </div>
  );
}
