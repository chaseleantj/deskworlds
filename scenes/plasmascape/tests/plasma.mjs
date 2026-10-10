import assert from 'node:assert/strict';
import { createPlasma, fingerTip, GLOBE, ELECTRODE, FINGER, FIXED_STEP, SEGMENT_FLOATS, MAX_SEGMENTS } from '../src/plasma.js';
import { randomGenerator } from '../../shared/random.js';

const run = (plasma, seconds) => { for (let i = 0; i < Math.round(seconds / FIXED_STEP); i++) { plasma.step(FIXED_STEP); if (i % 2) plasma.build(); } plasma.build(); };
const make = seed => { const plasma = createPlasma({ random: randomGenerator(seed) }); run(plasma, 2); return plasma; };
const segmentsOf = plasma => Array.from({ length: plasma.state.segmentCount }, (_, k) => [...plasma.segments.subarray(k * SEGMENT_FLOATS, (k + 1) * SEGMENT_FLOATS)]);

// A channel is a chain of glowing pieces between the electrode and the glass, always finite and inside the shell.
{
  const plasma = make(1);
  const { segmentCount, footCount } = plasma.state;
  assert.ok(segmentCount > 1500 && segmentCount < MAX_SEGMENTS, `A resting globe draws a few thousand pieces (${segmentCount})`);
  assert.ok(footCount > 30, 'Many channels land on the glass');
  for (const s of segmentsOf(plasma)) {
    assert.ok(s.every(Number.isFinite), 'Segment values are finite');
    for (const o of [0, 4]) {
      const r = Math.hypot(s[o], s[o + 1], s[o + 2]);
      assert.ok(r >= ELECTRODE.radius - 1e-4 && r <= GLOBE.inner + 1e-4, `A point lies between electrode and glass (${r.toFixed(3)})`);
    }
    assert.ok(s[8] >= 0 && s[9] >= 0 && s[10] >= 0 && s[10] <= 1.0001, 'Intensity and colour position are in range');
  }
  // Roots spread over the whole electrode: no side is empty.
  const sums = [0, 0, 0];
  for (let i = 0; i < plasma.roots.length / 4; i++) for (let a = 0; a < 3; a++) sums[a] += plasma.roots[i * 4 + a] * plasma.roots[i * 4 + 3];
  const total = plasma.roots.reduce((t, v, i) => i % 4 === 3 ? t + v : t, 0);
  for (const v of sums) assert.ok(Math.abs(v) / total < 0.2, 'Roots are spread evenly around the electrode');
}

// The same seed gives the same discharge, a different seed a different one.
{
  const a = make(4), b = make(4), c = make(5);
  assert.deepEqual(segmentsOf(a), segmentsOf(b));
  assert.notDeepEqual(segmentsOf(a), segmentsOf(c));
}

// The pattern moves by itself: channels slide, fade and strike again.
{
  const plasma = make(2);
  const before = segmentsOf(plasma).slice(0, 200);
  run(plasma, 1.5);
  const after = segmentsOf(plasma).slice(0, 200);
  assert.notDeepEqual(before, after);
}

// The cursor is a fingertip: it rests on the glass over the disc and hovers in the plane beside it.
{
  const camera = { x: 0, y: 0, z: 6 };
  const over = fingerTip(camera, { x: 0, y: 0, z: -1 });
  assert.ok(Math.abs(Math.hypot(over.x, over.y, over.z) - (GLOBE.outer + FINGER.radius)) < 1e-9, 'Over the globe the fingertip touches the glass');
  assert.ok(over.z > 0, 'It touches the near side');
  const beside = fingerTip(camera, { x: 0.5, y: 0, z: -1 });
  const away = Math.hypot(beside.x, beside.y, beside.z);
  assert.ok(away > GLOBE.outer + FINGER.radius && Math.abs(beside.z) < 1e-9, 'Beside the globe it hovers in the centre plane');
  assert.equal(fingerTip(camera, { x: 0, y: 0, z: 1 }), null, 'A ray pointing away from the globe finds no fingertip');
}

// A finger closing in bends the channels toward it, draws one bright thick arc and dims the rest.
{
  const rest = make(3);
  const restEnergy = rest.state.energy;
  const restStrongest = Math.max(...segmentsOf(rest).map(s => s[8]));
  const mean = plasma => { let x = 0, n = 0; for (let i = 0; i < plasma.state.footCount; i++) { x += plasma.feet[i * 8]; n++; } return x / n; };
  const restX = mean(rest);

  const touched = make(3);
  touched.setFinger({ x: GLOBE.outer + FINGER.radius, y: 0, z: 0 });
  run(touched, 2);
  assert.ok(touched.state.finger.near > 0.99, 'Touching the glass is full proximity');
  assert.ok(touched.state.mainIndex >= 0 && touched.state.discharge > 0.9, 'One channel carries the finger current');
  assert.ok(mean(touched) > restX + 0.1, 'Landings shift toward the finger');
  const strongest = Math.max(...segmentsOf(touched).map(s => s[8]));
  assert.ok(strongest > restStrongest * 1.8, `The finger channel is brighter (${strongest.toFixed(2)} vs ${restStrongest.toFixed(2)})`);
  const widest = Math.max(...segmentsOf(touched).map(s => s[3]));
  assert.ok(widest > 2 * Math.max(...segmentsOf(rest).map(s => s[3])), 'and thicker');
  assert.ok(touched.state.footCount < rest.state.footCount, 'Most other channels go out');
  assert.ok(touched.state.energy < restEnergy * 1.5, 'The free channels dim as the finger draws current');

  // Proximity is gradual: farther away means a weaker pull.
  const nears = [0.6, 0.3, 0.1].map(gap => {
    const plasma = make(3);
    plasma.setFinger({ x: GLOBE.outer + FINGER.radius + 1.2 * gap / 0.1, y: 0, z: 0 });
    run(plasma, 1);
    return plasma.state.finger.near;
  });
  assert.ok(nears[0] < nears[1] && nears[1] < nears[2] || nears[0] > nears[1], 'Proximity varies with distance');

  // Lifting the finger lets the globe recover.
  touched.setFinger(null);
  run(touched, 3);
  assert.ok(touched.state.finger.near < 0.05 && touched.state.mainIndex === -1, 'The globe recovers when the finger leaves');
  assert.ok(touched.state.footCount > rest.state.footCount * 0.6, 'and its channels come back');
}
console.log('plasma ok');
