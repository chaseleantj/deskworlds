import { QUALITY_PRESETS, activeQuality, renderScale } from '../../shared/render-policy.js';
// Rendering budgets, kept separate from animation and scene behaviour. The reference
// profile reproduces the uploaded rendering/density settings for local A/B checks.
export const PROFILES = Object.freeze({
  balanced: Object.freeze({
    name: 'balanced',
    shadowSize: 2048,
    // Every frame: at 20-30 fps a slower shadow refresh makes moving shadows step visibly.
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 8,
    backgroundDensity: 0.7,
    backgroundRows: 20,
    backgroundCols: 2,
    powerPreference: 'low-power',
  }),
  reference: Object.freeze({
    name: 'reference',
    shadowSize: 4096,
    shadowHz: Infinity,
    batteryShadowHz: Infinity,
    aoSamples: 12,
    backgroundDensity: 1,
    backgroundRows: 30,
    backgroundCols: 6,
    powerPreference: 'high-performance',
  }),
});

export function renderSettings({
  profile = 'balanced', wallpaper = false, pixelRatio = 1, onBattery = false,
} = {}) {
  const budget = PROFILES[profile] || PROFILES.balanced;
  const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const referenceResolution = wallpaper ? Math.min(2, Math.max(1.5, dpr)) : 1.5;
  return {
    ...budget,
    // Do not make Retina resolution a multiplier of an already supersampled target.
    resolution: budget.name === 'reference' ? referenceResolution :
      renderScale(profile, pixelRatio, onBattery),
    maxPixels: budget.name === 'reference' ? Infinity : QUALITY_PRESETS[activeQuality(profile, onBattery)].pixels,
    referenceResolution,
    shadowHz: onBattery ? budget.batteryShadowHz : budget.shadowHz,
    // The leaf shader uses quarter-sample coverage for translucent tissue. Keep 4x
    // MSAA and the HDR format: changing either would be a much larger visual change.
    samples: 4,
  };
}

export { framebufferSize } from '../../shared/render-policy.js';
