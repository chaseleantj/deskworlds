import assert from 'node:assert/strict';
import { createFire, FIXED_STEP, SPARKS, SPARK_FLOATS } from '../src/fire.js';
import { randomGenerator } from '../../shared/random.js';

const run = (seed, seconds, setup = () => {}) => {
  const fire = createFire({ random: randomGenerator(seed) });
  setup(fire);
  for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) fire.step(FIXED_STEP);
  return fire;
};
const live = fire => { let n = 0; for (let i = 0; i < SPARKS; i++) if (fire.sparks[i * SPARK_FLOATS + 8] > 0) n++; return n; };

{
  // The same seed gives the same fire, so captures are repeatable.
  const a = run(3, 4), b = run(3, 4);
  assert.deepEqual(a.sparks, b.sparks, 'a seed must replay exactly');
  assert(a.sparks.every(Number.isFinite), 'spark state stays finite');
}
{
  // A steady fire keeps a few hundred sparks in the air, well inside the pool.
  const fire = run(1, 6);
  const n = live(fire);
  assert(n > 150 && n < SPARKS * 0.5, `steady spark count ${n}`);
  assert.equal(n, fire.state.live, 'reported count matches the pool');
  // Sparks rise from the fire and drift, never sink far below the ground.
  for (let i = 0; i < SPARKS; i++) {
    const o = i * SPARK_FLOATS;
    if (fire.sparks[o + 8] > 0) assert(fire.sparks[o + 1] > -0.2, 'sparks stay above the ground');
  }
}
{
  // Stirring flares the fire and throws a burst of sparks, then it settles again.
  const calm = run(2, 4);
  const stirred = run(2, 4);
  stirred.stir(1);
  for (let i = 0; i < Math.round(0.5 / FIXED_STEP); i++) { calm.step(FIXED_STEP); stirred.step(FIXED_STEP); }
  assert(live(stirred) > live(calm) * 1.5, 'a stir throws many more sparks');
  assert(stirred.state.energy > calm.state.energy, 'a stir makes the fire burn harder');
  for (let i = 0; i < Math.round(4 / FIXED_STEP); i++) stirred.step(FIXED_STEP);
  assert.equal(stirred.state.flare, 0, 'the flare dies away');
}
{
  // Air pushed from the cursor leans the sparks away from it.
  const still = run(5, 5);
  const pushed = run(5, 5, fire => fire.setCursor([1, 0]));
  const meanX = fire => { let x = 0, n = 0; for (let i = 0; i < SPARKS; i++) { const o = i * SPARK_FLOATS; if (fire.sparks[o + 8] > 0) { x += fire.sparks[o]; n++; } } return x / n; };
  assert(meanX(pushed) > meanX(still) + 0.1, 'sparks drift downwind');
}
{
  // Left alone, the fire holds for a while, then sinks to embers; fanning brings it back.
  const fire = run(6, 30);
  assert(fire.state.vigor > 0.95, 'a fresh fire burns at full strength for its first minute');
  for (let i = 0; i < Math.round(300 / FIXED_STEP); i++) fire.step(FIXED_STEP);
  assert(fire.state.vigor < 0.05 && fire.state.energy < 0.3, 'after a few minutes only embers are left');
  const embers = live(fire);
  assert(fire.state.glow > 0.7, 'embers still glow');
  for (let i = 0; i < Math.round(3 / FIXED_STEP); i++) { if (i % 4 === 0) fire.fan(0.01); fire.step(FIXED_STEP); }
  for (let i = 0; i < Math.round(4 / FIXED_STEP); i++) fire.step(FIXED_STEP);
  assert(fire.state.vigor > 0.6, `a few seconds of fanning revives it (${fire.state.vigor.toFixed(2)})`);
  assert(live(fire) > embers * 3, 'a revived fire throws sparks again');
}
console.log('bonfire fire: ok');
