import assert from 'node:assert/strict';
import { createPond, fishCount, FIXED_STEP, PELLET } from '../src/pond.js';
import { randomGenerator } from '../../shared/random.js';

// A 3440 x 1440 frame: the pond shows 1.1 m from the middle to the top edge.
const halfH = 1.1, halfW = halfH * 3440 / 1440;
const pond = (seed, aspect = halfW / halfH) => createPond({ random: randomGenerator(seed), count: fishCount(aspect), halfW: halfH * aspect, halfH });
const run = (p, seconds, each = () => {}) => {
  for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) { each(i * FIXED_STEP); p.step(FIXED_STEP); p.impulses.length = 0; }
};
const angleSpread = (angles) => 1 - Math.hypot(angles.reduce((s, a) => s + Math.cos(a), 0), angles.reduce((s, a) => s + Math.sin(a), 0)) / angles.length;

// The cast: seven to ten fish on an ultrawide, fewer on a narrower screen, and the same seed
// always makes the same pond.
{
  assert.ok(fishCount(3440 / 1440) >= 7 && fishCount(3440 / 1440) <= 10, 'An ultrawide holds seven to ten koi');
  assert.ok(fishCount(16 / 9) <= fishCount(3440 / 1440), 'A narrower screen holds no more');
  const a = pond(4), b = pond(4);
  run(a, 20); run(b, 20);
  assert.deepEqual(a.fish.map((f) => [f.x, f.z, f.heading]), b.fish.map((f) => [f.x, f.z, f.heading]), 'Deterministic for a seed');
  assert.ok(new Set(a.fish.map((f) => f.variety)).size >= 6, 'A mix of varieties');
}

// Cruising: unhurried, in the pond, at a spread of depths, and never a synchronised school.
for (const seed of [1, 2, 3, 4, 5]) {
  const p = pond(seed);
  let maxSpeed = 0, outside = 0, samples = 0, spread = 0;
  run(p, 240, (t) => {
    for (const f of p.fish) {
      maxSpeed = Math.max(maxSpeed, f.speed);
      if (Math.abs(f.x) > halfW + 0.35 || Math.abs(f.z) > halfH + 0.3) outside++;
    }
    if (t > 20 && Math.round(t / FIXED_STEP) % 120 === 0) { spread += angleSpread(p.fish.map((f) => f.heading)); samples++; }
  });
  assert.ok(p.diagnostics().finite, 'State stays finite');
  assert.ok(maxSpeed < 0.45, `Cruising stays unhurried (${maxSpeed.toFixed(2)} m/s)`);
  assert.equal(outside, 0, 'Fish stay in the pond');
  assert.ok(spread / samples > 0.35, `Headings stay varied, not schooled (${(spread / samples).toFixed(2)})`);
  const depths = p.fish.map((f) => f.depth);
  assert.ok(Math.max(...depths) - Math.min(...depths) > 0.15, 'Some fish swim deeper than others');
}

// Pads keep to the edges and corners, clear of the middle of the frame and the icon band on the right.
for (const seed of [1, 2, 3, 4, 5, 6]) {
  const p = pond(seed);
  assert.ok(p.pads.length >= 12, 'Several clusters of pads');
  for (const pad of p.pads) {
    assert.ok(!(Math.abs(pad.x) < halfW * 0.45 && Math.abs(pad.z) < halfH * 0.5), 'No pad in the middle');
    assert.ok(pad.x < halfW * 0.7, 'No pad under the desktop icons');
    assert.ok(pad.z > -halfH * 0.75, 'No pad under the menu bar');
  }
  assert.ok(p.flowers.length >= 1 && p.flowers.length <= 2, 'One or two flowers');
}

// Feeding: a pinch lands with rings, the koi come up for it and eat every pellet with a gulp at the surface.
for (const seed of [1, 2, 3, 4]) {
  const p = pond(seed);
  run(p, 10);
  p.pinch();
  let rings = 0, gulpDepth = Infinity;
  for (let i = 0; i < Math.round(40 / FIXED_STEP) && p.pellets.length; i++) {
    const before = p.stats.gulps;
    p.step(FIXED_STEP);
    rings += p.impulses.length / 4;
    p.impulses.length = 0;
    if (p.stats.gulps > before) gulpDepth = Math.min(gulpDepth, ...p.fish.filter((f) => f.gulp > 0.9).map((f) => f.depth));
  }
  assert.equal(p.pellets.length, 0, `All ${PELLET.pinch} pellets eaten (seed ${seed})`);
  assert.ok(p.stats.eaten === PELLET.pinch, 'Each pellet counted once');
  assert.ok(rings >= PELLET.pinch * 2, 'Pellets landing and mouths breaking the surface make rings');
  assert.ok(gulpDepth < 0.15, 'Fish rise to the surface to eat');
  run(p, 30);
  assert.ok(p.fish.every((f) => f.mode === 'cruise'), 'They drift off again afterwards');
}

// A resting cursor draws a curious fish or two over; a fast pass sends the nearest moving off,
// and they settle again.
for (const seed of [1, 2, 3]) {
  const p = pond(seed);
  run(p, 15);
  const at = { x: p.fish[0].x + 0.3, z: p.fish[0].z };
  let closest = Infinity, curious = 0;
  run(p, 30, () => {
    p.point(at.x, at.z);
    curious = Math.max(curious, p.fish.filter((f) => f.mode === 'curious').length);
    for (const f of p.fish) closest = Math.min(closest, Math.hypot(f.x + Math.cos(f.heading) * f.len * 0.3 - at.x, f.z + Math.sin(f.heading) * f.len * 0.3 - at.z));
  });
  assert.ok(curious >= 1 && curious <= 3, `One to three fish come to look (${curious})`);
  assert.ok(closest < 0.3, `A curious fish comes up close (${closest.toFixed(2)} m)`);

  // Sweep the cursor fast straight through the nearest fish.
  const f = p.fish.find((g) => g.mode === 'curious') || p.fish[0];
  const x0 = f.x - 0.8, z0 = f.z;
  const before = p.stats.startles;
  for (let i = 0; i <= 24; i++) { p.point(x0 + i * 0.066, z0); p.step(FIXED_STEP); p.impulses.length = 0; }
  assert.ok(p.stats.startles > before, 'A fast pass startles');
  const startled = p.fish.filter((g) => g.mode === 'startle');
  assert.ok(startled.length >= 1, 'Someone darts');
  assert.ok(Math.max(...startled.map((g) => g.speed)) > 0.25, 'It moves off briskly');
  p.point(null);
  run(p, 6);
  assert.ok(p.fish.every((g) => g.mode !== 'startle'), 'And they settle again');
}

// Cursor motion leaves ripples; a cursor resting on the water does not.
{
  const p = pond(9);
  // Count only the rings made where the cursor is, not the fish's wakes or drips elsewhere.
  const at = (x, z) => { let n = 0; for (let i = 0; i < p.impulses.length; i += 4) if (Math.hypot(p.impulses[i] - x, p.impulses[i + 1] - z) < 0.02) n++; return n; };
  let moving = 0, resting = 0;
  for (let i = 0; i < 120; i++) { const x = -1 + i * 0.01; p.point(x, 0.2); p.step(FIXED_STEP); moving += at(x, 0.2); p.impulses.length = 0; }
  for (let i = 0; i < 120; i++) { p.point(0.2, 0.2); p.step(FIXED_STEP); resting += at(0.2, 0.2); p.impulses.length = 0; }
  assert.ok(moving >= 10, `A moving cursor rings the water (${moving})`);
  assert.ok(resting <= 2, `A resting cursor leaves it still (${resting})`);
}

console.log('koiscape behaviour: ok');
