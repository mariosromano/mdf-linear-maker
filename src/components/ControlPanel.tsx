import { useState } from 'react';
import type { LinearParams, LightingPreset } from '../engine/types';
import {
  MATERIALS,
  PATTERNS,
  DEPTH_MODES,
  BIT_SIZES,
  BIT_PROFILES,
  CARVE_DEPTHS,
} from '../engine/types';

interface ControlPanelProps {
  params: LinearParams;
  onParamsChange: React.Dispatch<React.SetStateAction<LinearParams>>;
  onRandomize: () => void;
  imageName: string | null;
  onImageUpload: (file: File) => void;
  lightingPreset: LightingPreset;
  onLightingPresetChange: (preset: LightingPreset) => void;
  bgColor: string;
  onBgColorChange: (color: string) => void;
  floorEnabled: boolean;
  onFloorEnabledChange: (enabled: boolean) => void;
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] mb-2.5 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left group"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[10.5px] font-semibold text-[var(--ink-muted)] uppercase tracking-[0.14em] group-hover:text-[var(--ink-soft)] transition-colors">
          {title}
        </span>
        <svg
          className={`text-[var(--ink-faint)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 pt-0.5">{children}</div>}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  info,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  info?: string;
}) {
  return (
    <div className="mb-3.5 last:mb-0">
      <label className="flex justify-between mb-1.5 text-[12px] text-[var(--ink-soft)]">
        <span className="truncate mr-2">{label}</span>
        <span className="text-[var(--gold-bright)] font-semibold font-mono shrink-0 tabular-nums">
          {format ? format(value) : value}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {info && <p className="text-[10.5px] text-[var(--ink-faint)] mt-1.5 leading-relaxed">{info}</p>}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="text-[12px] text-[var(--ink-soft)] mb-1.5">{label}</div>
      <div className="flex rounded-lg bg-[var(--surface-1)] border border-[var(--line)] p-0.5 gap-0.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`flex-1 py-1.5 px-1 rounded-md text-[11px] font-medium transition-colors ${
              opt === value
                ? 'bg-[var(--gold)] text-[#1a1a14]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-soft)] hover:bg-[var(--surface-3)]'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ControlPanel({
  params,
  onParamsChange,
  onRandomize,
  imageName,
  onImageUpload,
  lightingPreset,
  onLightingPresetChange,
  bgColor,
  onBgColorChange,
  floorEnabled,
  onFloorEnabledChange,
}: ControlPanelProps) {
  const set = <K extends keyof LinearParams>(key: K, value: LinearParams[K]) =>
    onParamsChange((p) => ({ ...p, [key]: value }));

  const isImage = params.pattern === 'Image Lines' || params.pattern === 'Image Relief';
  const isAngled =
    params.pattern === 'Parallel' || params.pattern === 'Crosshatch' || params.pattern === 'Image Lines';
  const isWavy = params.pattern === 'Chevron' || params.pattern === 'Waves';
  const hasSpacing = params.pattern !== 'Image Relief';
  const hasJitter = params.pattern !== 'Image Relief';

  return (
    <>
      <Section title="Wall Size">
        <Slider
          label="Width"
          value={params.wallWidth}
          min={4} max={30} step={2}
          format={(v) => `${v}′`}
          onChange={(v) => set('wallWidth', v)}
        />
        <Slider
          label="Height"
          value={params.wallHeight}
          min={4} max={24} step={2}
          format={(v) => `${v}′`}
          onChange={(v) => set('wallHeight', v)}
        />
      </Section>

      <Section title="Pattern">
        <div className="grid grid-cols-3 gap-1.5 mb-3.5">
          {PATTERNS.map((p) => (
            <button
              key={p}
              onClick={() => set('pattern', p)}
              className={`py-2 px-1 rounded-lg border text-[11px] font-medium transition-colors ${
                params.pattern === p
                  ? 'border-[var(--gold)] bg-[var(--surface-3)] text-[var(--ink)]'
                  : 'border-[var(--line)] bg-[var(--surface-1)] text-[var(--ink-muted)] hover:text-[var(--ink-soft)] hover:border-[var(--line-strong)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {isImage && (
          <div className="mb-3.5">
            <div className="text-[12px] text-[var(--ink-soft)] mb-1.5">Image</div>
            <label className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-1)] text-[12px] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:border-[var(--gold-deep)] cursor-pointer transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              {imageName ? 'Replace image' : 'Upload image'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImageUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="text-[10.5px] text-[var(--ink-faint)] mt-1.5 leading-relaxed truncate">
              {imageName ? `Loaded: ${imageName}` : 'Using the built-in M|R demo image.'}
              {' '}Dark areas carve deepest.
            </p>
            <div className="flex items-center justify-between mt-2.5 mb-3">
              <label className="text-[12px] text-[var(--ink-soft)]">Invert (carve light areas)</label>
              <label className="relative w-10 h-[22px] cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={params.imageInvert}
                  onChange={(e) => set('imageInvert', e.target.checked)}
                />
                <div className="w-10 h-[22px] bg-[var(--surface-4)] rounded-full peer-checked:bg-[var(--gold)] transition-colors" />
                <div className="absolute left-[3px] bottom-[3px] w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-[18px] shadow-sm" />
              </label>
            </div>
            <Slider
              label="Smoothing"
              value={params.imageSmooth}
              min={0} max={10} step={1}
              format={(v) => `${v}px`}
              onChange={(v) => set('imageSmooth', v)}
              info="Blurs the image before depth mapping — higher is softer relief."
            />
          </div>
        )}

        {hasSpacing && (
        <Slider
          label="Line Spacing"
          value={params.spacing}
          min={1} max={24} step={0.5}
          format={(v) => `${v}″`}
          onChange={(v) => set('spacing', v)}
        />
        )}

        {isAngled && (
          <Slider
            label="Angle"
            value={params.angle}
            min={0} max={180} step={5}
            format={(v) => `${v}°`}
            onChange={(v) => set('angle', v)}
          />
        )}

        {params.pattern === 'Crosshatch' && (
          <Slider
            label="Cross Angle"
            value={params.crossAngle}
            min={15} max={165} step={5}
            format={(v) => `${v}°`}
            onChange={(v) => set('crossAngle', v)}
            info="Angle between the two line families."
          />
        )}

        {isWavy && (
          <>
            <Slider
              label={params.pattern === 'Chevron' ? 'Peak Height' : 'Wave Height'}
              value={params.waveAmplitude}
              min={0.5} max={12} step={0.5}
              format={(v) => `${v}″`}
              onChange={(v) => set('waveAmplitude', v)}
            />
            <Slider
              label={params.pattern === 'Chevron' ? 'Peak Width' : 'Wave Length'}
              value={params.wavePeriod}
              min={4} max={48} step={1}
              format={(v) => `${v}″`}
              onChange={(v) => set('wavePeriod', v)}
            />
          </>
        )}

        {hasJitter && (
        <Slider
          label="Jitter"
          value={params.jitter}
          min={0} max={1} step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set('jitter', v)}
          info="Random offset per line — 0% is perfectly regular."
        />
        )}

        <button
          onClick={onRandomize}
          className="w-full py-2.5 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface-4)] border border-[var(--line-strong)] text-[var(--ink-soft)] hover:text-[var(--ink)] text-[12px] font-medium transition-colors"
        >
          ↻ Reshuffle Jitter &amp; Depths
        </button>
      </Section>

      <Section title="CNC Carving">
        <Segmented label="Bit Size" value={params.bitSize} options={BIT_SIZES} onChange={(v) => set('bitSize', v)} />
        <Segmented label="Bit Profile" value={params.bitProfile} options={BIT_PROFILES} onChange={(v) => set('bitProfile', v)} />
        <Segmented label="Max Carve Depth" value={params.carveDepth} options={CARVE_DEPTHS} onChange={(v) => set('carveDepth', v)} />
        {!isImage && (
          <>
            <Segmented label="Depth Variation" value={params.depthMode} options={DEPTH_MODES} onChange={(v) => set('depthMode', v)} />
            <p className="text-[10.5px] text-[var(--ink-faint)] mt-1.5 leading-relaxed">
              Depth variation carves each line at a different depth — Alternating
              pairs deep and shallow lines, Gradient ramps across the wall.
            </p>
          </>
        )}
        {isImage && (
          <p className="text-[10.5px] text-[var(--ink-faint)] mt-1.5 leading-relaxed">
            Carve depth follows the image — Max Carve Depth sets the darkest
            (deepest) point.
          </p>
        )}
      </Section>

      <Section title="Material">
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(MATERIALS).map(([name, def]) => (
            <button
              key={name}
              onClick={() => set('material', name)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-[11px] font-medium transition-colors text-left ${
                params.material === name
                  ? 'border-[var(--gold)] bg-[var(--surface-3)] text-[var(--ink)]'
                  : 'border-[var(--line)] bg-[var(--surface-1)] text-[var(--ink-muted)] hover:text-[var(--ink-soft)] hover:border-[var(--line-strong)]'
              }`}
            >
              <span
                className="w-4 h-4 rounded-full shrink-0 border border-black/20"
                style={{ background: def.color }}
              />
              <span className="truncate">{name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Scene" defaultOpen={false}>
        <Segmented
          label="Lighting"
          value={lightingPreset}
          options={['studio', 'gallery', 'raking'] as const}
          onChange={onLightingPresetChange}
        />
        <div className="flex items-center justify-between mb-3">
          <label className="text-[12px] text-[var(--ink-soft)]">Background</label>
          <input
            type="color"
            value={bgColor}
            onChange={(e) => onBgColorChange(e.target.value)}
            className="w-12 h-7"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="text-[12px] text-[var(--ink-soft)]">Floor shadow</label>
          <label className="relative w-10 h-[22px] cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={floorEnabled}
              onChange={(e) => onFloorEnabledChange(e.target.checked)}
            />
            <div className="w-10 h-[22px] bg-[var(--surface-4)] rounded-full peer-checked:bg-[var(--gold)] transition-colors" />
            <div className="absolute left-[3px] bottom-[3px] w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-[18px] shadow-sm" />
          </label>
        </div>
      </Section>
    </>
  );
}
