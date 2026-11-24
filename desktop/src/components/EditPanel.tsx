import {
  Crop,
  FlipHorizontal,
  FlipVertical,
  RotateCcw,
  RotateCw,
  Sparkles,
  Sun,
} from 'lucide-react';
import {
  CROP_ASPECTS,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP,
  FILTER_PRESETS,
  computeCropForAspect,
  isEditDirty,
  type CropAspect,
  type EditAdjustments,
  type EditState,
} from '../lib/editor';

interface EditPanelProps {
  open: boolean;
  state: EditState;
  saveMode: 'copy' | 'replace';
  imageAspect: number;
  isSaving: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  onChange: (updater: (prev: EditState) => EditState) => void;
  onResetAll: () => void;
  onCancel: () => void;
}

const TOOL_TITLES: Record<EditState['tool'], string> = {
  crop: 'Crop',
  adjust: 'Adjust',
  filters: 'Filters',
  rotate: 'Rotate',
};

const ADJUST_ROWS: { key: keyof EditAdjustments; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'warmth', label: 'Warmth' },
];

export const EditPanel = ({
  open,
  state,
  saveMode,
  imageAspect,
  isSaving,
  statusMessage,
  errorMessage,
  onChange,
  onResetAll,
  onCancel,
}: EditPanelProps) => {
  const dirty = isEditDirty(state);

  const setAspect = (aspect: CropAspect) => {
    const nextCrop = computeCropForAspect(aspect, imageAspect);
    onChange((prev) => ({ ...prev, aspect, crop: nextCrop }));
  };

  const resetActiveTool = () => {
    onChange((prev) => {
      if (prev.tool === 'crop') return { ...prev, aspect: 'free', crop: { ...DEFAULT_CROP } };
      if (prev.tool === 'adjust') return { ...prev, adjustments: { ...DEFAULT_ADJUSTMENTS } };
      if (prev.tool === 'filters') return { ...prev, filterPreset: 'original' };
      return { ...prev, rotateDeg: 0, flipH: false, flipV: false, straightenDeg: 0 };
    });
  };

  return (
    <aside
      aria-label="Photo editor"
      aria-hidden={!open}
      inert={!open}
      className={`absolute inset-y-0 right-0 z-10 w-80 bg-viewer-panel border-l border-border flex flex-col justify-between overflow-y-auto overscroll-contain transition-[transform,opacity] ease-drawer motion-reduce:transition-none ${
        open ? 'translate-x-0 opacity-100 duration-240' : 'translate-x-full opacity-0 pointer-events-none duration-150'
      }`}
    >
      <div className="p-5 flex flex-col gap-5 text-text">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {state.tool === 'crop' && <Crop size={15} className="text-text-dim" aria-hidden="true" />}
            {state.tool === 'adjust' && <Sun size={15} className="text-text-dim" aria-hidden="true" />}
            {state.tool === 'filters' && <Sparkles size={15} className="text-text-dim" aria-hidden="true" />}
            {state.tool === 'rotate' && <RotateCw size={15} className="text-text-dim" aria-hidden="true" />}
            <span className="text-sm font-semibold text-text">{TOOL_TITLES[state.tool]}</span>
          </div>

          <button
            type="button"
            onClick={resetActiveTool}
            title={`Reset ${TOOL_TITLES[state.tool].toLowerCase()}`}
            aria-label={`Reset ${TOOL_TITLES[state.tool].toLowerCase()}`}
            className="pressable w-7 h-7 rounded-md grid place-items-center text-text-mute hover:text-text hover:bg-surface-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw size={13} />
          </button>
        </div>

        {state.tool === 'adjust' && (
          <div className="space-y-4">
            {ADJUST_ROWS.map((row) => (
              <CenteredSlider
                key={row.key}
                label={row.label}
                value={state.adjustments[row.key]}
                min={-50}
                max={50}
                onChange={(val) =>
                  onChange((prev) => ({
                    ...prev,
                    adjustments: { ...prev.adjustments, [row.key]: val },
                  }))
                }
              />
            ))}
          </div>
        )}

        {state.tool === 'crop' && (
          <div className="space-y-4">
            <div>
              <span className="block text-xs font-medium text-text-mute mb-2">Aspect ratio</span>
              <div className="grid grid-cols-5 gap-1.5">
                {CROP_ASPECTS.map((item) => {
                  const active = state.aspect === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setAspect(item.id)}
                      aria-pressed={active}
                      className={`pressable py-1.5 rounded-lg text-xs font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        active
                          ? 'bg-accent text-on-accent border-accent'
                          : 'bg-surface border-border text-text-dim hover:text-text hover:bg-surface-hi'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl bg-surface border border-border p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-mute">Selection</span>
                <span className="text-text font-medium tabular-nums">
                  {Math.round(state.crop.w * 100)}% x {Math.round(state.crop.h * 100)}%
                </span>
              </div>
              <p className="text-xs text-text-mute leading-relaxed">
                Drag any corner or frame edge on the photo to trim the composition.
              </p>
            </div>
          </div>
        )}

        {state.tool === 'filters' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {FILTER_PRESETS.map((preset) => {
                const active = state.filterPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onChange((prev) => ({ ...prev, filterPreset: preset.id }))}
                    aria-pressed={active}
                    className={`pressable px-3 py-2 rounded-lg text-left text-xs font-medium border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active
                        ? 'bg-accent-soft text-accent border-accent'
                        : 'bg-surface border-border text-text-dim hover:text-text hover:bg-surface-hi'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-text-mute leading-relaxed">
              Use the thumbnail strip under the photo or switch to Adjust to fine-tune lighting and color.
            </p>
          </div>
        )}

        {state.tool === 'rotate' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChange((prev) => ({ ...prev, rotateDeg: (prev.rotateDeg + 270) % 360 }))}
                className="pressable flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-surface hover:bg-surface-hi border border-border text-xs font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RotateCcw size={14} />
                90 deg Left
              </button>
              <button
                type="button"
                onClick={() => onChange((prev) => ({ ...prev, rotateDeg: (prev.rotateDeg + 90) % 360 }))}
                className="pressable flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-surface hover:bg-surface-hi border border-border text-xs font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RotateCw size={14} />
                90 deg Right
              </button>
              <button
                type="button"
                aria-pressed={state.flipH}
                onClick={() => onChange((prev) => ({ ...prev, flipH: !prev.flipH }))}
                className={`pressable flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  state.flipH
                    ? 'bg-accent-soft text-accent border-accent'
                    : 'bg-surface hover:bg-surface-hi border-border text-text'
                }`}
              >
                <FlipHorizontal size={14} />
                Flip Horiz
              </button>
              <button
                type="button"
                aria-pressed={state.flipV}
                onClick={() => onChange((prev) => ({ ...prev, flipV: !prev.flipV }))}
                className={`pressable flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  state.flipV
                    ? 'bg-accent-soft text-accent border-accent'
                    : 'bg-surface hover:bg-surface-hi border-border text-text'
                }`}
              >
                <FlipVertical size={14} />
                Flip Vert
              </button>
            </div>

            <CenteredSlider
              label="Straighten"
              value={state.straightenDeg}
              min={-45}
              max={45}
              suffix="deg"
              onChange={(val) => onChange((prev) => ({ ...prev, straightenDeg: val }))}
            />
          </div>
        )}
      </div>

      <div className="p-5 border-t border-border space-y-3">
        <div className="rounded-xl bg-surface border border-border px-3.5 py-3 text-xs leading-relaxed text-text-dim">
          {saveMode === 'replace'
            ? 'Replace Original updates the indexed photo file in place while preserving EXIF details.'
            : 'Saved next to the original, keeping its date and camera details.'}
        </div>

        {statusMessage && (
          <p className="text-xs font-medium text-success" role="status">
            {statusMessage}
          </p>
        )}
        {errorMessage && (
          <p className="text-xs font-medium text-danger" role="alert">
            {errorMessage}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onResetAll}
            disabled={isSaving || !dirty}
            className="pressable flex-1 py-2 rounded-lg text-xs font-medium bg-surface hover:bg-surface-hi border border-border text-text disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Reset edits
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="pressable flex-1 py-2 rounded-lg text-xs font-medium bg-surface-hi hover:bg-bg border border-border text-text disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
        </div>
      </div>
    </aside>
  );
};

const CenteredSlider = ({
  label,
  value,
  min,
  max,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (val: number) => void;
}) => {
  const display = value > 0 ? `+${value}${suffix}` : `${value}${suffix}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text font-medium">{label}</span>
        <span className="text-text-dim font-medium tabular-nums">{display}</span>
      </div>
      <div className="relative flex items-center h-5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 w-[1.5px] h-2.5 bg-viewer-tick rounded-full"
        />
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative z-10 w-full h-1 bg-viewer-track rounded-full appearance-none cursor-pointer accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
    </div>
  );
};
