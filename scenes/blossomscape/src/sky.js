import { POLE_STAR } from './site.js';

// The night sky as a long exposure sees it: every star drawn out into an arc about the pole
// star, all of them turning together. It is kept as a map of the sky round the pole: across
// is the way round (one turn), up is how far out from the pole (as a share of SKY.reach).
const unit = ([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// `reach` is how far from the pole the map goes, in radians: past the furthest corner of
// the widest screen. `exposure` is the length of each star's arc, in turns, and `turn` how
// long the sky takes to go once round, in seconds: slow enough to be calm, fast enough to see.
export const SKY = Object.freeze({ reach: 1.26, exposure: 0.022, turn: 420, width: 4096, height: 2048 });
// Two directions square to the pole and to each other, to measure the way round from.
const east = unit(cross([0, 1, 0], POLE_STAR));
export const POLE = Object.freeze({ east, north: cross(POLE_STAR, east) });

export const TRAIL_FLOATS = 7; // the way round (turns), how far out (share of the reach), length (turns), brightness, colour
export const TRAIL_COUNT = 36000;
// From blue-white through white to a pale rose: the stars keep to the colours of the rest
// of the picture, and most are near white.
const TINTS = [[0.72, 0.84, 1.0], [0.84, 0.92, 1.0], [1.0, 1.0, 1.0], [1.0, 0.95, 0.93], [1.0, 0.86, 0.86], [1.0, 0.76, 0.78]];

export function buildTrails(random) {
  const trails = new Float32Array(TRAIL_COUNT * TRAIL_FLOATS), edge = Math.cos(SKY.reach);
  for (let i = 0; i < TRAIL_COUNT; i++) {
    // Evenly over the sky: as many stars in each patch of it, near the pole or far.
    const out = Math.acos(1 - random() * (1 - edge)) / SKY.reach;
    // Many faint stars for each bright one, as in the real sky.
    const brightness = Math.min(60, 0.04 * random() ** -1.25);
    const tint = TINTS[Math.min(TINTS.length - 1, Math.floor(random() ** 1.6 * TINTS.length * (random() < 0.5 ? 0.6 : 1)))];
    trails.set([random(), out, SKY.exposure * (0.8 + 0.4 * random()), brightness, ...tint], i * TRAIL_FLOATS);
  }
  return trails;
}

// Motes: specks of light adrift in the sky, nearer than the stars. They are carried round
// the pole the same way, each at its own pace (a whole number of turns for each turn of
// MOTES.turn seconds, so they can go on for ever without a jump), wandering in and out a
// little as they go.
export const MOTES = Object.freeze({ count: 2600, turn: 900 });
export const MOTE_FLOATS = 11; // the way round (turns), how far out (share of the reach), pace, wander, brightness, twinkle phase and rate, a spare, colour

export function buildMotes(random) {
  const motes = new Float32Array(MOTES.count * MOTE_FLOATS), edge = Math.cos(SKY.reach);
  for (let i = 0; i < MOTES.count; i++) {
    const out = Math.acos(1 - random() * (1 - edge)) / SKY.reach, tint = TINTS[Math.floor(random() * TINTS.length)];
    // Twinkle rates are whole hundredths, so the shader's wrapped clock never jumps.
    motes.set([random(), out, 1 + Math.floor(random() * 4), 0.006 + 0.02 * random(), Math.min(1.5, 0.07 * random() ** -0.8), random() * Math.PI * 2, 0.6 + Math.round(random() * 180) / 100, 0, ...tint], i * MOTE_FLOATS);
  }
  return motes;
}
