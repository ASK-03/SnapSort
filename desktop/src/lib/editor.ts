import type { FilterPreset } from '../api';

export type EditTool = 'crop' | 'adjust' | 'filters' | 'rotate';
export type CropAspect = 'free' | '1:1' | '4:3' | '16:9' | '3:2';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditAdjustments {
  light: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

export interface EditState {
  tool: EditTool;
  aspect: CropAspect;
  crop: CropRect;
  adjustments: EditAdjustments;
  filterPreset: FilterPreset;
  rotateDeg: number;
  flipH: boolean;
  flipV: boolean;
  straightenDeg: number;
}

export const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export const DEFAULT_ADJUSTMENTS: EditAdjustments = {
  light: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
};

export const createDefaultEditState = (): EditState => ({
  tool: 'adjust',
  aspect: 'free',
  crop: { ...DEFAULT_CROP },
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  filterPreset: 'original',
  rotateDeg: 0,
  flipH: false,
  flipV: false,
  straightenDeg: 0,
});

export interface FilterPresetMeta {
  id: FilterPreset;
  label: string;
  light?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
  mono?: boolean;
}

export const FILTER_PRESETS: FilterPresetMeta[] = [
  { id: 'original', label: 'Original' },
  { id: 'vivid', label: 'Vivid', contrast: 15, saturation: 35 },
  { id: 'warm', label: 'Warm', warmth: 35, saturation: 10 },
  { id: 'cool', label: 'Cool', warmth: -35, contrast: 8 },
  { id: 'mono', label: 'Mono', mono: true, contrast: 8 },
  { id: 'noir', label: 'Noir', mono: true, contrast: 35, light: -8 },
];

export const CROP_ASPECTS: { id: CropAspect; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
];

export function hasCustomCrop(crop: CropRect): boolean {
  return crop.x > 0.002 || crop.y > 0.002 || crop.w < 0.998 || crop.h < 0.998;
}

export function isEditDirty(state: EditState): boolean {
  return (
    hasCustomCrop(state.crop) ||
    state.filterPreset !== 'original' ||
    state.rotateDeg % 360 !== 0 ||
    state.flipH ||
    state.flipV ||
    Math.abs(state.straightenDeg) > 0.05 ||
    state.adjustments.light !== 0 ||
    state.adjustments.contrast !== 0 ||
    state.adjustments.saturation !== 0 ||
    state.adjustments.warmth !== 0
  );
}

export function computeCssFilter(presetId: FilterPreset, adj: EditAdjustments): string {
  const meta = FILTER_PRESETS.find((p) => p.id === presetId) ?? FILTER_PRESETS[0];
  const light = Math.max(-100, Math.min(100, adj.light + (meta.light ?? 0)));
  const contrast = Math.max(-100, Math.min(100, adj.contrast + (meta.contrast ?? 0)));
  const saturation = Math.max(-100, Math.min(100, adj.saturation + (meta.saturation ?? 0)));
  const warmth = Math.max(-100, Math.min(100, adj.warmth + (meta.warmth ?? 0)));

  const brightnessVal = +(1 + light / 100).toFixed(3);
  const contrastVal = +(1 + contrast / 100).toFixed(3);
  const parts = [`brightness(${brightnessVal})`, `contrast(${contrastVal})`];

  if (meta.mono) {
    parts.push('grayscale(1)');
  } else {
    parts.push(`saturate(${+Math.max(0, 1 + saturation / 100).toFixed(3)})`);
    if (warmth > 0) {
      parts.push(`sepia(${+(warmth / 160).toFixed(3)})`);
    } else if (warmth < 0) {
      parts.push(`hue-rotate(${+(warmth * 0.25).toFixed(1)}deg)`);
    }
  }
  return parts.join(' ');
}

export function computeCssTransform(state: EditState): string | undefined {
  const angle = state.rotateDeg + state.straightenDeg;
  const parts: string[] = [];
  if (Math.abs(angle) > 0.01) parts.push(`rotate(${angle}deg)`);
  if (state.flipH) parts.push('scaleX(-1)');
  if (state.flipV) parts.push('scaleY(-1)');
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function computeCropForAspect(aspect: CropAspect, imageAspect: number): CropRect {
  const found = CROP_ASPECTS.find((a) => a.id === aspect);
  if (!found || !found.ratio || !imageAspect || !Number.isFinite(imageAspect)) {
    return { ...DEFAULT_CROP };
  }
  const targetNormRatio = found.ratio / imageAspect;
  let w = 0.86;
  let h = w / targetNormRatio;
  if (h > 0.86) {
    h = 0.86;
    w = h * targetNormRatio;
  }
  w = Math.max(0.15, Math.min(1, +w.toFixed(4)));
  h = Math.max(0.15, Math.min(1, +h.toFixed(4)));
  return {
    x: +((1 - w) / 2).toFixed(4),
    y: +((1 - h) / 2).toFixed(4),
    w,
    h,
  };
}
