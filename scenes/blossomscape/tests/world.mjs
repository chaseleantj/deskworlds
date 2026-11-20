import assert from 'node:assert/strict';
import { createWorld, gustEnvelope, FIXED_STEP, GUST, WIND, AIR, AIR_FLOATS, AFLOAT, AFLOAT_FLOATS, FALLEN, FALLEN_FLOATS, RIPPLE_FLOATS } from '../src/world.js';
import { createLight } from '../src/light.js';
import { growTree } from '../src/tree.js';
import { createTerrain, onRock, TREE, CAMERA } from '../src/site.js';
import { randomGenerator } from '../../shared/random.js';

const light = createLight(), tree = growTree(light), terrain = createTerrain();
light.bake();
const world = (seed) => createWorld({ random: randomGenerator(seed), sources: tree.sources, terrain, light });
const run = (w, seconds, each = () => {}) => { for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) { w.step(FIXED_STEP); each(); w.clearRipples(); } };
const afloat = (w) => Array.from({ length: AFLOAT }, (_, i) => w.afloat.subarray(i * AFLOAT_FLOATS, (i + 1) * AFLOAT_FLOATS)).filter((petal) => petal[4] > 0);

// A gust rises as its front arrives and dies away after; it is nothing before.
{
  assert.equal(gustEnvelope(-1), 0, 'Nothing before the front');
  assert.ok(Math.abs(gustEnvelope(GUST.rise) - 1) < 1e-9, 'Full strength once it has risen');
  assert.ok(gustEnvelope(GUST.rise / 2) > 0.3 && gustEnvelope(GUST.rise / 2) < 0.7 && gustEnvelope(GUST.rise + 3 * GUST.fall) < 0.06, 'It rises, then fades');
  assert.ok(Math.abs(Math.hypot(WIND.x, WIND.z) - 1) < 1e-3, 'The wind has a direction');
}

// The evening as it is found: petals on the grass and a raft of them on the water, each
// where it could have come to rest.
for (const seed of [1, 2, 3]) {
  const w = world(seed);
  run(w, 2);
  const raft = afloat(w);
  assert.ok(raft.length > 900, `Petals on the lake (${raft.length})`);
  for (const petal of raft) assert.ok(terrain.heightAt(petal[0], petal[1]) < 0, 'Every drifting petal is on water');
  let lying = 0;
  for (let i = 0; i < FALLEN; i++) {
    const [x, y, z, , , , , , alpha] = w.fallen.subarray(i * FALLEN_FLOATS, (i + 1) * FALLEN_FLOATS);
    if (alpha <= 0) continue;
    lying++;
    assert.ok(terrain.heightAt(x, z) > 0 && y > terrain.heightAt(x, z) && !onRock(x, z), 'Every fallen petal lies on the ground');
  }
  assert.ok(lying > FALLEN * 0.9, 'The rock under the tree is strewn with them');
  // The current gathers them into one line that runs out from the islet and round to the
  // viewer: most of the petals lie between the two.
  const between = raft.filter((petal) => petal[1] > 2 && petal[1] < CAMERA.z + 2 && petal[0] > 0 && petal[0] < 9).length;
  assert.ok(between > 0.6 * raft.length, `The petals lie along the current (${between} of ${raft.length})`);
  const near = raft.filter((petal) => Math.hypot(petal[0] - CAMERA.x, petal[1] - (CAMERA.z - 2)) < 1.5).length;
  assert.ok(near > 15, `And the line comes right up to the viewer (${near} petals within reach)`);
}

// Petals fall slowly, one after another, and each that reaches the lake makes a ring there.
{
  const w = world(4), again = world(4);
  // Twenty seconds: before the first gust of the evening can come and hurry them.
  let rings = 0, fastest = 0, most = 0;
  run(w, 20, () => {
    for (let r = 0; r < w.state.rippleCount; r++) {
      const [x, z, radius, strength] = w.ripples.subarray(r * RIPPLE_FLOATS, (r + 1) * RIPPLE_FLOATS);
      assert.ok(terrain.heightAt(x, z) < 0 && radius > 0 && strength > 0, 'A ring is made on water');
      rings++;
    }
    most = Math.max(most, w.state.airborne);
  });
  run(again, 20);
  assert.deepEqual([...w.air.subarray(0, 200)], [...again.air.subarray(0, 200)], 'Deterministic for a seed');
  assert.ok(w.state.wetted > 10 && w.state.landed > 1, 'Petals come down on the water and on the rock');
  assert.equal(rings, w.state.wetted, 'One ring for each petal that lands on the lake');
  assert.ok(most > 10 && most < 150, `A few petals in the air at a time when it is calm (${most})`);
  // Sample falling speeds: none drops like a stone.
  const before = Float32Array.from(w.air);
  w.step(FIXED_STEP);
  for (let i = 0; i < AIR; i++) if (before[i * AIR_FLOATS + 6] > 0 && w.air[i * AIR_FLOATS + 6] > 0)
    fastest = Math.max(fastest, Math.hypot(w.air[i * AIR_FLOATS] - before[i * AIR_FLOATS], w.air[i * AIR_FLOATS + 1] - before[i * AIR_FLOATS + 1], w.air[i * AIR_FLOATS + 2] - before[i * AIR_FLOATS + 2]) / FIXED_STEP);
  assert.ok(fastest > 0.2 && fastest < 1.6, `Petals drift down, they do not drop (${fastest.toFixed(2)} m/s)`);
}

// Gravity: a petal falls. Calm or windy, each one that stays in the air for two seconds is
// lower at the end of them, and none is ever carried up and away.
for (const windy of [false, true]) {
  const w = world(8);
  run(w, 10);
  if (windy) w.gust(1);
  run(w, 1);
  const heights = new Map();
  for (let i = 0; i < AIR; i++) if (w.air[i * AIR_FLOATS + 6] > 0) heights.set(i, w.air[i * AIR_FLOATS + 1]);
  let highest = 0, fell = 0, kept = 0;
  run(w, 2, () => { for (const [i, start] of heights) if (w.air[i * AIR_FLOATS + 6] > 0) highest = Math.max(highest, w.air[i * AIR_FLOATS + 1] - start); else heights.delete(i); });
  for (const [i, start] of heights) { kept++; if (w.air[i * AIR_FLOATS + 1] < start - 0.5) fell++; }
  assert.ok(kept > 10 && fell === kept, `Every petal ${windy ? 'in the wind' : 'in still air'} has fallen at least half a metre in two seconds (${fell} of ${kept})`);
  assert.ok(highest < 0.25, `None is lifted more than a hand's breadth on the way (${highest.toFixed(2)} m)`);
}

// The button's gust: it is on the tree at once, petals come away in a flurry that never
// outruns what can be drawn and are carried right up to the viewer, and afterwards it is
// calm again.
{
  const w = world(5);
  run(w, 20);
  const calm = w.state.airborne;
  w.gust(1);
  w.step(FIXED_STEP);
  assert.ok(w.gustAt(TREE.x, TREE.z) > 0.95, 'It is on the tree at once');
  let flurry = 0, close = 0;
  run(w, 12, () => {
    flurry = Math.max(flurry, w.state.airborne);
    for (let i = 0; i < AIR; i++) if (w.air[i * AIR_FLOATS + 6] > 0 && Math.hypot(w.air[i * AIR_FLOATS] - CAMERA.x, w.air[i * AIR_FLOATS + 2] - CAMERA.z) < 3 && w.air[i * AIR_FLOATS + 1] < 3.5) close++;
  });
  assert.ok(close > 0, 'It carries petals right up to the viewer');
  assert.ok(flurry > 4 * calm && flurry <= AIR, `A flurry of petals (${calm} then ${flurry})`);
  run(w, 60);
  assert.ok(w.gustAt(0, 0) < 0.4 && w.state.airborne < flurry / 2, 'And it passes');
  assert.ok(w.state.drifting <= AFLOAT, 'The petals on the lake never outgrow their buffer');
}

// Moving the cursor is wind, at once and for as long as it keeps moving: harder the faster
// it goes, and dying away when it stops. A cursor that only arrives, or sits still, is none.
{
  const eye = [CAMERA.x, CAMERA.height, CAMERA.z];
  const towards = (x, y, z) => { const d = [x - eye[0], y - eye[1], z - eye[2]], l = Math.hypot(...d); return d.map((v) => v / l); };
  const w = world(6);
  run(w, 5);
  w.point(towards(TREE.x - 4, 5, TREE.z));
  run(w, 1);
  assert.equal(w.state.stir, 0, 'A cursor that arrives and sits still is no wind');
  // Back and forth across the crown for four seconds, at `pace` metres a second where the tree stands.
  const wave = (pace, seconds, each = () => {}) => { for (let t = 0; t < seconds; t += FIXED_STEP) { w.point(towards(TREE.x + 4 * Math.sin(t * pace / 4), 5, TREE.z)); w.step(FIXED_STEP); w.clearRipples(); each(t); } };
  let soon = 0, least = 9;
  wave(40, 4, (t) => { if (t > 0.3 && t < 0.35) soon = w.gustAt(TREE.x, TREE.z); if (t > 1) least = Math.min(least, w.state.stir); });
  assert.ok(soon > 0.5, `It is blowing on the tree within a third of a second (${soon.toFixed(2)})`);
  assert.ok(least > 0.5, `And keeps blowing for as long as the cursor keeps moving (never under ${least.toFixed(2)})`);
  run(w, 6);
  assert.ok(w.state.stir < 0.05, 'When the cursor stops, the wind dies away');
  let gentle = 0;
  wave(6, 4, () => { gentle = Math.max(gentle, w.state.stir); });
  assert.ok(gentle > 0.05 && gentle < 0.5, `A slow cursor is a light wind (${gentle.toFixed(2)})`);
  w.point(null);
  // A click: a pebble where the line of sight meets open water, a gust anywhere else.
  w.clearRipples();
  w.tap(towards(2, 0, 9));
  assert.equal(w.state.rippleCount, 1, 'A click on the lake drops a pebble');
  w.tap(towards(TREE.x - 1, 5, TREE.z));
  assert.equal(w.state.rippleCount, 1, 'A click on the tree does not');
  w.step(FIXED_STEP);
  assert.ok(w.gustAt(0, 0) > 0.9, 'It sends a gust instead');
}
console.log('PASS: petals fall under gravity, drift and settle; the wind comes at once and lasts while the cursor moves');
