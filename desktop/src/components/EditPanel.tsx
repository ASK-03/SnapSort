import { useEffect, useState } from 'react';
import { Crop, RotateCcw, SlidersHorizontal, Undo2 } from 'lucide-react';
import { useAppStore } from '../store';

interface Adjustments { brightness: number; contrast: number; saturation: number; warmth: number }
const DEFAULT_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

const toCssFilter = (a: Adjustments) =>
  `brightness(${1 + a.brightness / 100}) contrast(${1 + a.contrast / 100}) saturate(${1 + a.saturation / 100}) sepia(${Math.max(0, a.warmth) / 200})`;

export const EditPanel = ({ open, onFilterChange }: { open: boolean; onFilterChange: (cssFilter: string) => void }) => {
  const setViewerPanel = useAppStore((s) => s.setViewerPanel);
  const [tool, setTool] = useState<'crop' | 'rotate' | 'adjust'>('adjust');
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);

  useEffect(() => {
    onFilterChange(tool === 'adjust' ? toCssFilter(adjustments) : toCssFilter(DEFAULT_ADJUSTMENTS));
  }, [adjustments, tool]);

  const set = (key: keyof Adjustments) => (v: number) =>
    setAdjustments((prev) => ({ ...prev, [key]: v }));

  const tools = [
    { id: 'crop' as const, icon: Crop, enabled: false },
    { id: 'rotate' as const, icon: RotateCcw, enabled: false },
    { id: 'adjust' as const, icon: SlidersHorizontal, enabled: true },
  ];

  const done = () => setViewerPanel('none');
  const cancel = () => { setAdjustments(DEFAULT_ADJUSTMENTS); setViewerPanel('none'); };

  const flyoutOpen = open && tool === 'adjust';
  const totalWidth = (open ? 64 : 0) + (flyoutOpen ? 224 : 0);

  return (
    <div
      className="h-full flex flex-shrink-0 overflow-hidden transition-[width] duration-320 ease-apple"
      style={{ width: totalWidth }}
    >
      <div className="w-16 flex-shrink-0 bg-[#141517] border-r border-white/10 flex flex-col items-center pt-[76px] gap-1.5">
        {tools.map((t) => (
          <button
            key={t.id}
            disabled={!t.enabled}
            title={t.enabled ? undefined : 'Coming soon'}
            onClick={() => t.enabled && setTool(t.id)}
            className={`w-10 h-10 rounded-[10px] flex items-center justify-center transition-colors duration-150 ${
              tool === t.id && t.enabled
                ? 'bg-accent/15 border border-accent/40 text-accent'
                : t.enabled ? 'text-white/60 hover:bg-white/5' : 'text-white/25 cursor-not-allowed'
            }`}
          >
            <t.icon size={17} />
          </button>
        ))}
        <button
          onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
          title="Revert"
          className="mt-auto mb-4 w-10 h-10 rounded-[10px] flex items-center justify-center text-white/40 hover:bg-white/5 transition-colors duration-150"
        >
          <Undo2 size={16} />
        </button>
      </div>

      <div className="w-[224px] flex-shrink-0 bg-[#1A1B1E] border-r border-white/10 pt-[76px] px-4 pb-4 flex flex-col gap-4 text-white">
        <span className="text-[10.5px] font-bold tracking-wide text-white/45">ADJUST</span>
        <Slider label="Brightness" value={adjustments.brightness} onChange={set('brightness')} />
        <Slider label="Contrast" value={adjustments.contrast} onChange={set('contrast')} />
        <Slider label="Saturation" value={adjustments.saturation} onChange={set('saturation')} />
        <Slider label="Warmth" value={adjustments.warmth} onChange={set('warmth')} />
        <div className="flex gap-2 mt-1">
          <button onClick={cancel} className="flex-1 py-1.5 rounded-lg border border-white/15 text-[12.5px] font-semibold text-white/80 hover:bg-white/5 transition-colors duration-150">
            Cancel
          </button>
          <button onClick={done} className="flex-1 py-1.5 rounded-lg bg-accent text-[12.5px] font-semibold text-[#141517] hover:brightness-110 transition-all duration-150">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const Slider = ({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex justify-between text-[12px] text-white/80">
      <span>{label}</span>
      <span className={value !== 0 ? 'text-accent font-semibold' : 'text-white/45 font-semibold'}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
    <input
      type="range"
      min={-50}
      max={50}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-accent cursor-pointer"
    />
  </div>
);
