import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';
import type { LinearParams, LightingPreset } from './engine/types';
import { computePattern, panelBreakdown } from './engine/geometry';
import { calculatePricing, fmtPrice, PRICE_PER_SQFT } from './engine/pricing';
import { readBridgeFlags, readInitialParams, reportDesign } from './lib/bridge';
import { fileToSourceImage, presetToSourceImage } from './lib/imageLoader';
import type { SourceImage } from './engine/types';
import Viewport3D from './components/Viewport3D';
import ControlPanel from './components/ControlPanel';
import ExportBar from './components/ExportBar';
import RenderModal from './components/RenderModal';

const FLAGS = readBridgeFlags();

export default function App() {
  const [params, setParams] = useState<LinearParams>(() => readInitialParams());
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('studio');
  const [bgColor, setBgColor] = useState(FLAGS.makerealTheme ? '#f5f1e8' : '#141413');
  const [floorEnabled, setFloorEnabled] = useState(true);
  const [trueDepth, setTrueDepth] = useState(false);
  const [scaleFigureEnabled, setScaleFigureEnabled] = useState(true);
  const [renderOpen, setRenderOpen] = useState(false);
  const [image, setImage] = useState<SourceImage | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>('topography');
  const [presentationMode, setPresentationMode] = useState(false);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Debounce the expensive pattern rebuild while sliders drag
  const [debouncedParams, setDebouncedParams] = useState(params);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedParams(params), 120);
    return () => clearTimeout(t);
  }, [params]);

  // Default library image so image modes have something to carve immediately
  useEffect(() => {
    presetToSourceImage('topography')
      .then((src) => setImage((img) => img ?? src))
      .catch(() => {});
  }, []);

  const handleImageUpload = useCallback((file: File) => {
    fileToSourceImage(file)
      .then((src) => {
        setImage(src);
        setImageName(file.name);
        setSelectedPresetId(null);
      })
      .catch(() => {});
  }, []);

  const handleSelectPreset = useCallback((id: string) => {
    presetToSourceImage(id)
      .then((src) => {
        setImage(src);
        setImageName(null);
        setSelectedPresetId(id);
      })
      .catch(() => {});
  }, []);

  const pattern = useMemo(
    () => computePattern(debouncedParams, image),
    [debouncedParams, image]
  );

  // Maker Contract: report design changes to the MakeReal platform
  useEffect(() => {
    reportDesign(debouncedParams);
  }, [debouncedParams]);

  const handleRandomize = useCallback(() => {
    setParams((p) => ({ ...p, seed: Math.floor(Math.random() * 100000) }));
  }, []);

  // Exit presentation mode on Escape
  useEffect(() => {
    if (!presentationMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresentationMode(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [presentationMode]);

  // Resizable panel — drag the left-edge handle, 280..480px
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 340;
    const saved = parseInt(localStorage.getItem('linear_panel_width') || '', 10);
    return Number.isFinite(saved) && saved >= 280 && saved <= 480 ? saved : 340;
  });
  useEffect(() => {
    localStorage.setItem('linear_panel_width', String(panelWidth));
  }, [panelWidth]);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;
      const onMove = (ev: MouseEvent) => {
        const dx = startX - ev.clientX; // dragging left widens
        setPanelWidth(Math.max(280, Math.min(480, startWidth + dx)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [panelWidth]
  );

  const pricing = calculatePricing(debouncedParams.wallWidth, debouncedParams.wallHeight);

  return (
    <div className="flex w-screen h-screen">
      <Viewport3D
        params={debouncedParams}
        pattern={pattern}
        lightingPreset={lightingPreset}
        bgColor={bgColor}
        trueDepth={trueDepth}
        floorEnabled={floorEnabled}
        scaleFigureEnabled={scaleFigureEnabled}
        rendererRef={rendererRef}
        sceneRef={sceneRef}
        cameraRef={cameraRef}
      />

      {presentationMode && (
        <button
          onClick={() => setPresentationMode(false)}
          className="fixed top-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--surface-1)]/90 backdrop-blur border border-[var(--line-strong)] text-[var(--ink-soft)] text-[12px] font-medium hover:text-[var(--ink)] hover:border-[var(--gold-deep)] transition-all shadow-[0_4px_20px_rgba(0,0,0,0.4)] animate-fade-in-up"
          title="Exit presentation (Esc)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
          Exit Presentation
        </button>
      )}

      {!presentationMode && (
        <div
          onMouseDown={handleResizeStart}
          className="w-1 hover:w-1.5 hover:bg-[var(--gold)] cursor-ew-resize transition-all shrink-0"
          title="Drag to resize"
        />
      )}

      {!presentationMode && (
        <div
          className="bg-[var(--surface-1)] h-screen overflow-y-auto py-5 px-5 flex flex-col border-l border-[var(--line)]"
          style={{ width: panelWidth, minWidth: panelWidth }}
        >
          <div className="flex-1">
            {/* Brand — dropped under the MakeReal house theme (platform bar names the tool) */}
            {!FLAGS.makerealTheme && (
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <div className="text-[19px] font-semibold tracking-tight leading-none text-[var(--ink)]">
                    M<span className="text-[var(--gold)]">|</span>R Walls
                  </div>
                  <div className="text-[10px] font-medium text-[var(--ink-muted)] font-mono tracking-[0.2em] uppercase">
                    MDF Linear Maker
                  </div>
                </div>
                <button
                  onClick={() => setPresentationMode(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[var(--ink-muted)] hover:text-[var(--gold-bright)] hover:bg-[var(--surface-2)] transition-colors text-[10.5px] font-medium"
                  title="Presentation mode — full-screen preview"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  Present
                </button>
              </div>
            )}

            {/* Quick summary — at-a-glance spec + price */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 mb-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-[var(--ink-muted)] mb-1 uppercase tracking-wider">Wall</div>
                  <div className="text-[var(--ink)] font-semibold text-[15px]">
                    {debouncedParams.wallWidth}′×{debouncedParams.wallHeight}′
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--ink-muted)] mb-1 uppercase tracking-wider">Lines</div>
                  <div className="text-[var(--ink)] font-semibold text-[15px]">{pattern.lineCount}</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--ink-muted)] mb-1 uppercase tracking-wider">Panels</div>
                  <div className="text-[var(--ink)] font-semibold text-[15px]">{pattern.panels.length}</div>
                </div>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-[var(--line)] text-center text-[10.5px] text-[var(--ink-muted)]">
                {panelBreakdown(pattern.panels)}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--line)]">
                {/* Platform owns pricing when embedded */}
                {!FLAGS.embedded ? (
                  <div>
                    <span className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider">
                      Est. Investment
                    </span>
                    <div className="text-[20px] font-semibold text-[var(--ink)] font-mono leading-tight mt-0.5">
                      {fmtPrice(pricing.totalPrice)}
                    </div>
                    <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">
                      {pricing.areaSqft} sqft @ ${PRICE_PER_SQFT}/sqft
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-[var(--ink-muted)]">
                    Pricing in Spec + Budget
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--ink-muted)]">Scale figure</span>
                  <label className="relative w-10 h-[22px] cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={scaleFigureEnabled}
                      onChange={(e) => setScaleFigureEnabled(e.target.checked)}
                    />
                    <div className="w-10 h-[22px] bg-[var(--surface-4)] rounded-full peer-checked:bg-[var(--gold)] transition-colors" />
                    <div className="absolute left-[3px] bottom-[3px] w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-[18px] shadow-sm" />
                  </label>
                </div>
              </div>
            </div>

            <ControlPanel
              params={params}
              onParamsChange={setParams}
              onRandomize={handleRandomize}
              imageName={imageName}
              selectedPresetId={selectedPresetId}
              onImageUpload={handleImageUpload}
              onSelectPreset={handleSelectPreset}
              lightingPreset={lightingPreset}
              onLightingPresetChange={setLightingPreset}
              bgColor={bgColor}
              onBgColorChange={setBgColor}
              floorEnabled={floorEnabled}
              onFloorEnabledChange={setFloorEnabled}
              trueDepth={trueDepth}
              onTrueDepthChange={setTrueDepth}
            />

            <ExportBar
              params={debouncedParams}
              pattern={pattern}
              rendererRef={rendererRef}
              sceneRef={sceneRef}
              cameraRef={cameraRef}
              onOpenRender={() => setRenderOpen(true)}
            />

            {/* Studio CTA */}
            <div className="mt-4 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]">
              <div className="text-[12.5px] font-semibold text-[var(--ink)] mb-1.5">
                Need something bespoke?
              </div>
              <p className="text-[11.5px] text-[var(--ink-muted)] leading-relaxed mb-3">
                Our studio handles custom shapes, oversized installs, and full design collaboration.
              </p>
              <a
                href="mailto:orders@marioromano.com?subject=Custom%20Linear%20Panel%20Project%20Inquiry&body=Hi%20M%7CR%20Studio%2C%0A%0AI%27m%20working%20on%20a%20project%20that%20goes%20beyond%20the%20standard%20configurator.%20Here%27s%20what%20I%27m%20trying%20to%20achieve%3A%0A%0A%5BDescribe%20your%20project%5D%0A%0AThanks%2C"
                className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-center text-[12px] font-semibold text-[var(--gold-bright)] border border-[var(--gold-deep)]/40 hover:bg-[var(--gold)]/10 transition-colors"
              >
                Talk to M|R Studio
                <span className="text-[13px]">→</span>
              </a>
            </div>

            {/* Footer — legal */}
            <div className="mt-3.5 text-[10px] text-[var(--ink-faint)] text-center">
              <a
                href="https://mrwalls.io/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--ink-muted)] transition-colors"
              >
                Privacy Policy
              </a>
              <span className="mx-1.5">·</span>
              <span>© M|R Walls</span>
            </div>
          </div>
        </div>
      )}

      <RenderModal
        open={renderOpen}
        onClose={() => setRenderOpen(false)}
        rendererRef={rendererRef}
        sceneRef={sceneRef}
        cameraRef={cameraRef}
      />
    </div>
  );
}
