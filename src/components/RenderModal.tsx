import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { reportRender } from '../lib/bridge';

interface RenderModalProps {
  open: boolean;
  onClose: () => void;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
}

// Context presets for architectural scenes
const RENDER_PRESETS = [
  {
    label: 'Hotel Lobby',
    prompt:
      'Luxury hotel lobby interior with marble floors, designer furniture, recessed lighting, and a decorative CNC-carved linear grooved wall panel with crisp parallel line texture as the focal feature. Architectural photography, Canon EOS 5D Mark IV, 24mm lens, shallow depth of field, hyperrealistic, warm ambient lighting, 8k resolution.',
  },
  {
    label: 'Restaurant',
    prompt:
      'Upscale restaurant interior with warm moody lighting, elegant dining tables and chairs, and a decorative CNC-carved linear grooved wall panel with crisp parallel line texture behind the seating area. Architectural photography, Canon EOS 5D Mark IV, 35mm lens, shallow depth of field, hyperrealistic, golden hour light, 8k resolution.',
  },
  {
    label: 'Corporate Office',
    prompt:
      'Modern corporate headquarters reception area with polished stone floors, minimalist furniture, and a decorative CNC-carved linear grooved wall panel with crisp parallel line texture as the feature wall behind the reception desk. Architectural photography, Canon EOS 5D Mark IV, 24mm lens, shallow depth of field, hyperrealistic, natural daylight, 8k resolution.',
  },
  {
    label: 'Residential',
    prompt:
      'Contemporary living room interior with floor-to-ceiling windows, modern sofa, designer coffee table, and a decorative CNC-carved linear grooved wall panel with crisp parallel line texture as the accent wall. Architectural photography, Canon EOS 5D Mark IV, 28mm lens, shallow depth of field, hyperrealistic, soft afternoon light, 8k resolution.',
  },
  {
    label: 'Museum Gallery',
    prompt:
      'Museum gallery space with polished concrete floor, diffused overhead lighting, minimalist benches, and a decorative CNC-carved linear grooved wall panel with crisp parallel line texture as an art installation piece. Architectural photography, Canon EOS 5D Mark IV, 24mm lens, shallow depth of field, hyperrealistic, even gallery lighting, 8k resolution.',
  },
  {
    label: 'Spa & Wellness',
    prompt:
      'Serene wellness center interior with zen atmosphere, natural stone and wood materials, soft indirect lighting, indoor plants, and a decorative CNC-carved linear grooved wall panel with crisp parallel line texture creating a calming textured backdrop. Architectural photography, Canon EOS 5D Mark IV, 35mm lens, shallow depth of field, hyperrealistic, warm spa lighting, 8k resolution.',
  },
];

export default function RenderModal({
  open,
  onClose,
  rendererRef,
  sceneRef,
  cameraRef,
}: RenderModalProps) {
  const [captured, setCaptured] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(RENDER_PRESETS[0].prompt);
  const [activePreset, setActivePreset] = useState<string | null>(RENDER_PRESETS[0].label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [serverHasKey, setServerHasKey] = useState<boolean | null>(null);
  const [userKey, setUserKey] = useState(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('linear_fal_key') || '';
  });
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Capture the current 3D view when the modal opens
  useEffect(() => {
    if (!open) return;
    setResultUrl(null);
    setError(null);
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    const canvas = renderer.domElement;
    const maxDim = 1536;
    const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    if (scale === 1) {
      setCaptured(canvas.toDataURL('image/jpeg', 0.85));
    } else {
      const off = document.createElement('canvas');
      off.width = Math.round(canvas.width * scale);
      off.height = Math.round(canvas.height * scale);
      off.getContext('2d')!.drawImage(canvas, 0, 0, off.width, off.height);
      setCaptured(off.toDataURL('image/jpeg', 0.85));
    }
  }, [open, rendererRef, sceneRef, cameraRef]);

  // Does the server hold a FAL key? (env var on Vercel)
  useEffect(() => {
    if (!open || serverHasKey !== null) return;
    fetch('/api/config')
      .then((r) => r.json())
      .then((cfg) => setServerHasKey(!!cfg.hasFalKey))
      .catch(() => setServerHasKey(false));
  }, [open, serverHasKey]);

  // Asymptotic progress while waiting on FAL
  useEffect(() => {
    if (busy) {
      const start = Date.now();
      setProgress(0);
      progressTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        setProgress(92 * (1 - Math.exp(-elapsed / 8)));
      }, 100);
    } else if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [busy]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleGenerate = useCallback(async () => {
    if (!captured) {
      setError('No captured view. Close and reopen AI Render.');
      return;
    }
    if (!prompt.trim()) {
      setError('Select a context or write a prompt first.');
      return;
    }
    if (!serverHasKey && !userKey.trim()) {
      setError('No render key is configured. Enter a FAL API key below.');
      return;
    }
    setBusy(true);
    setError(null);
    setResultUrl(null);
    try {
      if (userKey.trim()) localStorage.setItem('linear_fal_key', userKey.trim());
      const base64 = captured.replace(/^data:image\/[a-z]+;base64,/, '');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!serverHasKey && userKey.trim()) headers['x-fal-key'] = userKey.trim();
      const res = await fetch('/api/render', {
        method: 'POST',
        headers,
        body: JSON.stringify({ image: base64, prompt: prompt.trim() }),
      });
      const text = await res.text();
      let data: { imageUrl?: string; error?: string; message?: string };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server error (${res.status})`);
      }
      if (!res.ok) throw new Error(data.message || data.error || 'Render failed');
      if (!data.imageUrl) throw new Error('No image returned');
      setResultUrl(data.imageUrl);
      reportRender();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [captured, prompt, serverHasKey, userKey]);

  const handleDownload = useCallback(async () => {
    if (!resultUrl) return;
    try {
      const res = await fetch(resultUrl);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mr-linear-render.png';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError('Failed to download image.');
    }
  }, [resultUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex flex-col animate-fade-in-up">
      <div className="flex flex-col flex-1 m-4 md:m-8 rounded-2xl overflow-hidden bg-[var(--surface-1)] border border-[var(--line-strong)] shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line)] shrink-0">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-semibold text-[var(--ink)]">✦ AI Render</span>
            <span className="text-[11px] text-[var(--ink-muted)]">
              Place your wall in a photoreal scene
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[var(--line-strong)] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--surface-3)] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left — controls */}
          <div className="w-[320px] shrink-0 p-5 overflow-y-auto border-r border-[var(--line)] flex flex-col gap-4">
            <div>
              <div className="text-[10.5px] font-semibold text-[var(--ink-muted)] uppercase tracking-[0.14em] mb-2">
                Context
              </div>
              <div className="flex flex-col gap-1.5">
                {RENDER_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setPrompt(p.prompt);
                      setActivePreset(p.label);
                    }}
                    className={`px-3 py-2 rounded-lg border text-[12px] text-left transition-colors ${
                      activePreset === p.label
                        ? 'border-[var(--gold)] bg-[var(--surface-3)] text-[var(--ink)]'
                        : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-muted)] hover:text-[var(--ink-soft)] hover:border-[var(--line-strong)]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-[120px]">
              <div className="text-[10.5px] font-semibold text-[var(--ink-muted)] uppercase tracking-[0.14em] mb-2">
                Prompt
              </div>
              <textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setActivePreset(null);
                }}
                placeholder="Describe the scene for your wall…"
                className="flex-1 min-h-[100px] p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line-strong)] text-[12px] text-[var(--ink)] leading-relaxed resize-none outline-none focus:border-[var(--gold-deep)]"
              />
            </div>

            {serverHasKey === false && (
              <div>
                <div className="text-[10.5px] font-semibold text-[var(--ink-muted)] uppercase tracking-[0.14em] mb-2">
                  FAL API Key
                </div>
                <input
                  type="password"
                  value={userKey}
                  onChange={(e) => setUserKey(e.target.value)}
                  placeholder="Only needed if no server key is set"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--line-strong)] text-[12px] text-[var(--ink)] outline-none focus:border-[var(--gold-deep)]"
                />
                <p className="text-[10px] text-[var(--ink-faint)] mt-1.5 leading-relaxed">
                  Stored only in this browser. On the live site, renders use a
                  server-side key — no key ever ships in the page.
                </p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={busy}
              className="py-3 rounded-lg text-[13px] font-semibold text-[#1a1a14] bg-gradient-to-br from-[var(--gold-bright)] to-[var(--gold)] shadow-[0_2px_14px_rgba(201,169,106,0.28)] hover:brightness-105 transition-all disabled:opacity-60 disabled:cursor-wait shrink-0"
            >
              {busy ? `Generating… ${Math.round(progress)}%` : 'Generate Render'}
            </button>
          </div>

          {/* Right — preview / result */}
          <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
            {busy ? (
              <>
                <div className="w-10 h-10 rounded-full border-[3px] border-[var(--surface-4)] border-t-[var(--gold)] animate-spin-slow" />
                <div className="mt-4 text-[13px] text-[var(--ink-muted)]">
                  Rendering your wall… usually 15–30 seconds
                </div>
                <div className="mt-3 w-56 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--gold)] transition-all duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            ) : resultUrl ? (
              <>
                <img
                  src={resultUrl}
                  alt="AI render"
                  className="max-w-full max-h-[calc(100%-60px)] rounded-xl object-contain shadow-[0_12px_48px_rgba(0,0,0,0.5)]"
                />
                <button
                  onClick={handleDownload}
                  className="mt-4 px-8 py-2.5 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface-4)] border border-[var(--line-strong)] text-[var(--ink)] text-[13px] font-medium transition-colors"
                >
                  Download PNG
                </button>
              </>
            ) : (
              <>
                {captured && (
                  <img
                    src={captured}
                    alt="Captured view"
                    className="max-w-full max-h-[calc(100%-40px)] rounded-xl object-contain opacity-50"
                  />
                )}
                <div className="mt-3 text-[12px] text-[var(--ink-faint)]">
                  Captured view — pick a context and generate
                </div>
              </>
            )}
            {error && (
              <div className="mt-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-[12.5px] max-w-[420px] text-center leading-relaxed">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
